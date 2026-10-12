import path from 'node:path';
import {
  ReleaseManifestSchema,
  resolveUpdate,
  selectArtifact,
  type Arch,
  type Catalog,
  type CatalogEntry,
  type Platform,
  type ReleaseManifest,
} from '@auram/app-manifest';
import { z } from 'zod';
import type { AppExitNotice, AppView, OperationState, ReleaseStatus } from '../../shared/ipc';
import { LauncherError, errorMessage, toIpcError } from './errors';
import { readJsonFile, writeJsonAtomic } from './fs-utils';
import { discoverInstalledApp, type InstalledApp } from './installed-apps';
import { installVersion, uninstallApp, type InstallPhase } from './installer';
import type { Logger } from './logger';
import type { FetchLike, TrustPolicy } from './net';
import { launchInstalledApp } from './process-launcher';
import { lookupLatestRelease } from './releases';

export interface AppManagerDeps {
  catalog: Catalog;
  getAppsDir: () => string;
  downloadsDir: string;
  releaseCacheFile: string;
  platform: NodeJS.Platform;
  arch: string;
  launcherVersion: string;
  userAgent: string;
  fetch: FetchLike;
  trust: TrustPolicy;
  logger: Logger;
  getIncludePrerelease: () => boolean;
  /** Exits sooner than this with a failure status are reported to the user. */
  earlyExitWindowMs?: number;
}

interface ReleaseRecord {
  checkedAt: string;
  manifest: ReleaseManifest | null;
  releasePageUrl: string | null;
}

const ReleaseCacheSchema = z.object({
  schemaVersion: z.literal(1),
  entries: z.record(
    z.string(),
    z.object({
      checkedAt: z.string(),
      manifest: z.unknown().nullable(),
      releasePageUrl: z.string().nullable(),
    }),
  ),
});

type Listener<T> = (value: T) => void;

/**
 * Coordinates everything the launcher knows about applications: the catalog,
 * installations on disk, published releases, running operations and launched
 * processes. All state shown in the UI is derived from here.
 */
export class AppManager {
  private readonly installed = new Map<string, InstalledApp | null>();
  private readonly releases = new Map<string, ReleaseRecord>();
  private readonly releaseErrors = new Map<string, { checkedAt: string; message: string }>();
  private readonly checking = new Set<string>();
  private readonly operations = new Map<string, OperationState>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly running = new Map<string, Set<number>>();
  private readonly changeListeners = new Set<Listener<AppView[]>>();
  private readonly exitListeners = new Set<Listener<AppExitNotice>>();
  private emitTimer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: AppManagerDeps) {}

  private get platform(): Platform | null {
    const p = this.deps.platform;
    return p === 'win32' || p === 'darwin' || p === 'linux' ? p : null;
  }

  private get arch(): Arch | null {
    return this.deps.arch === 'x64' || this.deps.arch === 'arm64' ? this.deps.arch : null;
  }

  entry(appId: string): CatalogEntry {
    const entry = this.deps.catalog.apps.find((app) => app.id === appId);
    if (!entry) throw new LauncherError('not-found', `Unknown application ${appId}.`);
    return entry;
  }

  async init(): Promise<void> {
    await this.loadReleaseCache();
    await this.refreshInstalled();
  }

  /* ------------------------------ events ------------------------------- */

  onChanged(listener: Listener<AppView[]>): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  onExited(listener: Listener<AppExitNotice>): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  /** Coalesces bursts (e.g. download progress) into at most one event per 100 ms. */
  private emitChanged(immediate = false): void {
    if (immediate) {
      if (this.emitTimer) clearTimeout(this.emitTimer);
      this.emitTimer = null;
      const apps = this.list();
      for (const listener of this.changeListeners) listener(apps);
      return;
    }
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => this.emitChanged(true), 100);
  }

  dispose(): void {
    if (this.emitTimer) clearTimeout(this.emitTimer);
    for (const controller of this.controllers.values()) controller.abort();
  }

  /* ------------------------------ queries ------------------------------ */

  async refreshInstalled(appId?: string): Promise<void> {
    const targets = appId ? [this.entry(appId)] : this.deps.catalog.apps;
    await Promise.all(
      targets.map(async (entry) => {
        try {
          this.installed.set(
            entry.id,
            await discoverInstalledApp(this.deps.getAppsDir(), entry.id, this.deps.platform),
          );
        } catch (error) {
          this.deps.logger.error('apps', `Failed to inspect installation of ${entry.id}`, error);
          this.installed.set(entry.id, null);
        }
      }),
    );
  }

  list(): AppView[] {
    return this.deps.catalog.apps.map((entry) => this.view(entry));
  }

  private view(entry: CatalogEntry): AppView {
    const installed = this.installed.get(entry.id) ?? null;
    return {
      id: entry.id,
      name: entry.name,
      description: entry.description,
      descriptionTranslations: entry.descriptionTranslations,
      category: entry.category,
      availability: entry.availability,
      homepage: entry.homepage ?? null,
      projectExtensions: entry.projectExtensions,
      installed: installed && {
        version: installed.version,
        installedAt: installed.record?.installedAt ?? null,
        source: installed.record?.source ?? 'manual',
        launchable: installed.executablePath !== null,
        problem: installed.problem,
      },
      release: this.releaseStatus(entry, installed),
      operation: this.operations.get(entry.id) ?? null,
      running: (this.running.get(entry.id)?.size ?? 0) > 0,
    };
  }

  private releaseStatus(entry: CatalogEntry, installed: InstalledApp | null): ReleaseStatus {
    if (!entry.releaseSource) return { state: 'no-source' };
    if (this.checking.has(entry.id)) return { state: 'checking' };
    const error = this.releaseErrors.get(entry.id);
    if (error) return { state: 'error', ...error };
    const record = this.releases.get(entry.id);
    if (!record) return { state: 'not-checked' };
    if (!record.manifest) return { state: 'no-release', checkedAt: record.checkedAt };

    const manifest = record.manifest;
    const platform = this.platform;
    const arch = this.arch;
    const resolution =
      platform && arch
        ? resolveUpdate({
            manifest,
            installedVersion: installed?.version ?? null,
            launcherVersion: this.deps.launcherVersion,
            platform,
            arch,
            includePrerelease: this.deps.getIncludePrerelease(),
          })
        : ({ kind: 'no-compatible-artifact' } as const);
    const artifact = platform && arch ? selectArtifact(manifest, platform, arch) : undefined;

    return {
      state: 'resolved',
      checkedAt: record.checkedAt,
      version: manifest.version,
      channel: manifest.channel,
      releasedAt: manifest.releasedAt,
      notes: {
        summary: manifest.releaseNotes.summary ?? null,
        body: manifest.releaseNotes.body ?? null,
        url: manifest.releaseNotes.url ?? record.releasePageUrl,
      },
      downloadSize: artifact?.size ?? null,
      resolution: resolution.kind,
      minLauncherVersion: manifest.minLauncherVersion,
    };
  }

  /* --------------------------- release checks -------------------------- */

  async checkReleases(appId?: string): Promise<void> {
    const targets = (appId ? [this.entry(appId)] : this.deps.catalog.apps).filter(
      (entry) => entry.releaseSource && !this.checking.has(entry.id),
    );
    if (targets.length === 0) return;
    for (const entry of targets) this.checking.add(entry.id);
    this.emitChanged(true);

    await Promise.all(
      targets.map(async (entry) => {
        const checkedAt = new Date().toISOString();
        try {
          const result = await lookupLatestRelease(this.deps, entry, {
            includePrerelease: this.deps.getIncludePrerelease(),
          });
          this.releaseErrors.delete(entry.id);
          this.releases.set(entry.id, {
            checkedAt,
            manifest: result.kind === 'found' ? result.manifest : null,
            releasePageUrl: result.kind === 'found' ? result.releasePageUrl : null,
          });
          this.deps.logger.info(
            'releases',
            `Checked ${entry.id}: ${result.kind === 'found' ? result.manifest.version : result.kind}`,
          );
        } catch (error) {
          this.releaseErrors.set(entry.id, { checkedAt, message: toIpcError(error).message });
          this.deps.logger.warn(
            'releases',
            `Release check failed for ${entry.id}`,
            errorMessage(error),
          );
        } finally {
          this.checking.delete(entry.id);
        }
      }),
    );
    await this.saveReleaseCache();
    this.emitChanged(true);
  }

  private async loadReleaseCache(): Promise<void> {
    try {
      const read = await readJsonFile(this.deps.releaseCacheFile, 4 * 1024 * 1024);
      if (read.kind !== 'ok') return;
      const cache = ReleaseCacheSchema.safeParse(read.value);
      if (!cache.success) return;
      for (const [appId, record] of Object.entries(cache.data.entries)) {
        if (!this.deps.catalog.apps.some((app) => app.id === appId)) continue;
        const manifest =
          record.manifest === null ? null : ReleaseManifestSchema.safeParse(record.manifest);
        if (manifest && !manifest.success) continue;
        this.releases.set(appId, {
          checkedAt: record.checkedAt,
          manifest: manifest ? manifest.data : null,
          releasePageUrl: record.releasePageUrl,
        });
      }
    } catch (error) {
      this.deps.logger.warn('releases', 'Ignoring unreadable release cache', error);
    }
  }

  private async saveReleaseCache(): Promise<void> {
    try {
      await writeJsonAtomic(this.deps.releaseCacheFile, {
        schemaVersion: 1,
        entries: Object.fromEntries(this.releases),
      });
    } catch (error) {
      this.deps.logger.warn('releases', 'Could not write release cache', error);
    }
  }

  /* ---------------------------- operations ----------------------------- */

  private assertIdle(appId: string): void {
    const op = this.operations.get(appId);
    if (op && op.phase !== 'failed') {
      throw new LauncherError('busy', 'Another operation is already running for this application.');
    }
  }

  /**
   * Starts installing (or updating to) the resolved release. Returns once the
   * operation has started; progress and the outcome are delivered as events.
   */
  async install(appId: string): Promise<void> {
    const entry = this.entry(appId);
    this.assertIdle(appId);
    await this.refreshInstalled(appId);
    const installed = this.installed.get(appId) ?? null;
    const record = this.releases.get(appId);
    const status = this.releaseStatus(entry, installed);

    if (status.state !== 'resolved' || !record?.manifest) {
      throw new LauncherError(
        'not-found',
        'No verified release information is available. Check for updates first.',
      );
    }
    if (status.resolution === 'requires-newer-launcher') {
      throw new LauncherError(
        'incompatible',
        `This release requires Auram Launcher ${status.minLauncherVersion} or newer.`,
      );
    }
    if (
      status.resolution !== 'not-installed-available' &&
      status.resolution !== 'update-available'
    ) {
      throw new LauncherError('incompatible', 'There is no installable release for this system.');
    }
    if (this.running.get(appId)?.size) {
      throw new LauncherError('busy', `Close ${entry.name} before updating it.`);
    }
    const artifact = selectArtifact(record.manifest, this.platform!, this.arch!);
    if (!artifact) throw new LauncherError('incompatible', 'There is no package for this system.');

    const version = record.manifest.version;
    const kind = installed ? 'update' : 'install';
    const controller = new AbortController();
    this.controllers.set(appId, controller);
    this.operations.set(appId, {
      phase: 'downloading',
      kind,
      version,
      receivedBytes: 0,
      totalBytes: artifact.size,
    });
    this.emitChanged(true);

    const onPhase = (phase: InstallPhase) => {
      this.operations.set(appId, { ...phase, kind, version });
      this.emitChanged(phase.phase !== 'downloading');
    };

    void installVersion(this.deps, {
      appId,
      version,
      artifact,
      appsDir: this.deps.getAppsDir(),
      downloadsDir: this.deps.downloadsDir,
      platform: this.deps.platform,
      signal: controller.signal,
      onPhase,
    })
      .then(() => {
        this.operations.delete(appId);
      })
      .catch((error: unknown) => {
        const ipcError = toIpcError(error);
        if (ipcError.code === 'cancelled') this.operations.delete(appId);
        else {
          this.operations.set(appId, {
            phase: 'failed',
            kind,
            version,
            code: ipcError.code,
            message: ipcError.message,
            at: new Date().toISOString(),
          });
        }
      })
      .finally(async () => {
        this.controllers.delete(appId);
        await this.refreshInstalled(appId);
        this.emitChanged(true);
      });
  }

  cancel(appId: string): void {
    this.controllers.get(appId)?.abort();
  }

  dismissError(appId: string): void {
    if (this.operations.get(appId)?.phase === 'failed') {
      this.operations.delete(appId);
      this.emitChanged(true);
    }
  }

  async uninstall(appId: string): Promise<void> {
    const entry = this.entry(appId);
    this.assertIdle(appId);
    if (this.running.get(appId)?.size)
      throw new LauncherError('busy', `Close ${entry.name} before removing it.`);
    this.operations.set(appId, { phase: 'uninstalling' });
    this.emitChanged(true);
    try {
      await uninstallApp(this.deps.getAppsDir(), appId, this.deps.logger);
      this.operations.delete(appId);
    } catch (error) {
      const ipcError = toIpcError(error);
      this.operations.set(appId, {
        phase: 'failed',
        kind: 'uninstall',
        version: null,
        code: ipcError.code,
        message: ipcError.message,
        at: new Date().toISOString(),
      });
      throw error;
    } finally {
      await this.refreshInstalled(appId);
      this.emitChanged(true);
    }
  }

  /* ------------------------------ launching ---------------------------- */

  async launch(appId: string, projectPath?: string): Promise<void> {
    const entry = this.entry(appId);
    const op = this.operations.get(appId);
    if (op && op.phase !== 'failed')
      throw new LauncherError('busy', `${entry.name} is being installed or updated.`);
    await this.refreshInstalled(appId);
    const installed = this.installed.get(appId);
    if (!installed) throw new LauncherError('not-installed', `${entry.name} is not installed.`);

    this.deps.logger.info(
      'launch',
      `Starting ${appId} ${installed.version}`,
      projectPath ? { project: path.basename(projectPath) } : undefined,
    );
    const child = await launchInstalledApp(installed, {
      projectPath,
      launcherVersion: this.deps.launcherVersion,
    });
    const pid = child.pid ?? -1;
    const pids = this.running.get(appId) ?? new Set<number>();
    pids.add(pid);
    this.running.set(appId, pids);
    this.emitChanged(true);

    void child.exited.then(({ code, signal, uptimeMs }) => {
      pids.delete(pid);
      this.deps.logger.info('launch', `${appId} exited`, { code, signal, uptimeMs });
      const failed = (code !== null && code !== 0) || signal !== null;
      if (failed && uptimeMs < (this.deps.earlyExitWindowMs ?? 15_000)) {
        for (const listener of this.exitListeners) {
          listener({ appId, appName: entry.name, exitCode: code, signal });
        }
      }
      this.emitChanged(true);
    });
  }
}
