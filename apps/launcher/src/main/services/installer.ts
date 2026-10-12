import { createHash, randomUUID } from 'node:crypto';
import { fsp } from './fs';
import path from 'node:path';
import type { Artifact, InstallationRecord } from '@auram/app-manifest';
import { compareVersions, isValidVersion } from '@auram/app-manifest';
import { LauncherError, errorMessage } from './errors';
import { isNotFound, pathExists, renameWithRetry, writeJsonAtomic } from './fs-utils';
import { appLayout, inspectVersionDir } from './installed-apps';
import type { Logger } from './logger';
import { trustedFetch, type FetchLike, type TrustPolicy } from './net';
import { extractZip } from './zip';

const { mkdir, open, readdir, rm } = fsp;

export type InstallPhase =
  | { phase: 'downloading'; receivedBytes: number; totalBytes: number }
  | { phase: 'verifying' }
  | { phase: 'installing' };

export interface InstallRequest {
  appId: string;
  version: string;
  artifact: Artifact;
  appsDir: string;
  downloadsDir: string;
  platform: NodeJS.Platform;
  signal?: AbortSignal;
  onPhase?: (phase: InstallPhase) => void;
}

export interface InstallerDeps {
  fetch: FetchLike;
  trust: TrustPolicy;
  logger: Logger;
  /** Number of previous versions kept for manual rollback. */
  keepPreviousVersions?: number;
  extractLimits?: { maxEntries: number; maxTotalBytes: number };
}

const DEFAULT_EXTRACT_LIMITS = { maxEntries: 200_000, maxTotalBytes: 16 * 1024 ** 3 };

/**
 * Downloads an artifact into `downloadsDir`, hashing while streaming. The file is
 * only accepted when its size and SHA-256 match the release manifest exactly.
 */
export async function downloadArtifact(
  deps: Pick<InstallerDeps, 'fetch' | 'trust'>,
  artifact: Artifact,
  destination: string,
  options: { signal?: AbortSignal; onProgress?: (received: number, total: number) => void } = {},
): Promise<void> {
  const response = await trustedFetch(deps.fetch, artifact.url, deps.trust, {
    signal: options.signal,
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new LauncherError('network', `Download failed with HTTP ${response.status}.`);
  }

  await mkdir(path.dirname(destination), { recursive: true });
  const hash = createHash('sha256');
  const file = await open(destination, 'w');
  let received = 0;
  try {
    const reader = response.body.getReader();
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (options.signal?.aborted)
          throw new LauncherError('cancelled', 'The download was cancelled.');
        throw new LauncherError('network', `The download was interrupted: ${errorMessage(error)}`, {
          cause: error,
        });
      }
      if (chunk.done) break;
      received += chunk.value.byteLength;
      if (received > artifact.size) {
        await reader.cancel().catch(() => {});
        throw new LauncherError(
          'integrity',
          'The download is larger than the size declared in the release manifest.',
        );
      }
      hash.update(chunk.value);
      await file.write(chunk.value);
      options.onProgress?.(received, artifact.size);
    }
    await file.sync();
  } finally {
    await file.close();
  }

  if (received !== artifact.size) {
    throw new LauncherError(
      'integrity',
      `The download is incomplete (${received} of ${artifact.size} bytes). Check your connection and retry.`,
    );
  }
  const digest = hash.digest('hex');
  if (digest !== artifact.sha256) {
    throw new LauncherError(
      'integrity',
      'The downloaded file failed verification: its SHA-256 checksum does not match the release manifest.',
    );
  }
}

/**
 * Installs one version of an application.
 *
 * 1. Download to `Downloads/` and verify size + SHA-256.
 * 2. Extract into a hidden staging directory next to the installed versions.
 * 3. Validate the package's `auram-app.json` and executable.
 * 4. Move the staged directory to `versions/<version>`.
 * 5. Atomically rewrite `current.json` — the single switch-over point.
 *
 * Until step 5 completes the previously installed version stays active and
 * untouched. Any failure removes the staged files and the partial download.
 * Nothing from the package is executed during installation.
 */
export async function installVersion(
  deps: InstallerDeps,
  request: InstallRequest,
): Promise<InstallationRecord> {
  const { appId, version, artifact, platform, signal } = request;
  if (!isValidVersion(version))
    throw new LauncherError('invalid-package', `Invalid version ${version}.`);
  if (artifact.format !== 'zip')
    throw new LauncherError('invalid-package', `Unsupported artifact format ${artifact.format}.`);

  const layout = appLayout(request.appsDir, appId);
  const token = randomUUID().slice(0, 8);
  const download = path.join(request.downloadsDir, `${appId}-${version}-${token}.zip.partial`);
  const staging = path.join(layout.versionsDir, `.staging-${version}-${token}`);
  const finalDir = layout.versionDir(version);
  let displaced: string | null = null;

  await removeLeftovers(layout.versionsDir, deps.logger);

  const throwIfAborted = () => {
    if (signal?.aborted) throw new LauncherError('cancelled', 'The installation was cancelled.');
  };

  try {
    deps.logger.info('installer', `Downloading ${appId} ${version}`, {
      url: artifact.url,
      size: artifact.size,
    });
    request.onPhase?.({ phase: 'downloading', receivedBytes: 0, totalBytes: artifact.size });
    await downloadArtifact(deps, artifact, download, {
      signal,
      onProgress: (receivedBytes, totalBytes) =>
        request.onPhase?.({ phase: 'downloading', receivedBytes, totalBytes }),
    });
    throwIfAborted();

    // The checksum is verified during download; this phase covers package validation.
    request.onPhase?.({ phase: 'verifying' });
    await mkdir(layout.versionsDir, { recursive: true });
    await extractZip(download, staging, {
      ...(deps.extractLimits ?? DEFAULT_EXTRACT_LIMITS),
      signal,
    });
    const check = await inspectVersionDir(staging, { id: appId, version }, platform);
    if (!check.ok)
      throw new LauncherError('invalid-package', `The package is invalid: ${check.problem}`);
    if (!check.executablePath) {
      throw new LauncherError(
        'invalid-package',
        `The package cannot run here: ${check.problem ?? 'no executable'}`,
      );
    }
    throwIfAborted();

    request.onPhase?.({ phase: 'installing' });
    if (await pathExists(finalDir)) {
      // Re-installing the same version (e.g. repairing a damaged install): move the
      // old copy aside first so it can be restored if the swap fails.
      displaced = path.join(layout.versionsDir, `.replaced-${version}-${token}`);
      await renameWithRetry(finalDir, displaced);
    }
    try {
      await renameWithRetry(staging, finalDir);
    } catch (error) {
      if (displaced) await renameWithRetry(displaced, finalDir).catch(() => {});
      displaced = null;
      throw new LauncherError(
        'io',
        `Could not move the new version into place: ${errorMessage(error)}`,
        { cause: error },
      );
    }

    const record: InstallationRecord = {
      schemaVersion: 1,
      id: appId,
      version,
      installedAt: new Date().toISOString(),
      source: 'release',
    };
    await writeJsonAtomic(layout.currentFile, record);
    deps.logger.info('installer', `Installed ${appId} ${version}`);

    if (displaced) await rm(displaced, { recursive: true, force: true }).catch(() => {});
    await pruneOldVersions(
      layout.versionsDir,
      version,
      deps.keepPreviousVersions ?? 1,
      deps.logger,
    );
    return record;
  } catch (error) {
    deps.logger.error('installer', `Installation of ${appId} ${version} failed`, error);
    throw error instanceof LauncherError
      ? error
      : new LauncherError('io', errorMessage(error), { cause: error });
  } finally {
    await rm(download, { force: true }).catch(() => {});
    await rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Removes staging folders left behind by an interrupted or failed install (for
 * example after a crash). They are never active installations.
 */
async function removeLeftovers(versionsDir: string, logger: Logger): Promise<void> {
  let names: string[];
  try {
    names = (await readdir(versionsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('.staging-'))
      .map((entry) => entry.name);
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }
  for (const name of names) {
    await rm(path.join(versionsDir, name), { recursive: true, force: true }).then(
      () => logger.info('installer', `Removed leftover ${name}`),
      (error: unknown) => logger.warn('installer', `Could not remove leftover ${name}`, error),
    );
  }
}

/** Removes versions older than the active one, keeping `keep` previous versions. */
async function pruneOldVersions(
  versionsDir: string,
  active: string,
  keep: number,
  logger: Logger,
): Promise<void> {
  let names: string[];
  try {
    names = (await readdir(versionsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && isValidVersion(entry.name) && entry.name !== active)
      .map((entry) => entry.name)
      .sort((a, b) => compareVersions(b, a));
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }
  for (const name of names.slice(keep)) {
    try {
      await rm(path.join(versionsDir, name), { recursive: true, force: true });
      logger.info('installer', `Removed old version ${name}`);
    } catch (error) {
      // A file may still be in use; it will be retried after the next update.
      logger.warn('installer', `Could not remove old version ${name}`, error);
    }
  }
}

/**
 * Removes an application's binaries. Projects live elsewhere and are never touched.
 * The directory is first renamed, which fails cleanly on Windows when files are
 * in use, so a running application is never left half-deleted.
 */
export async function uninstallApp(appsDir: string, appId: string, logger: Logger): Promise<void> {
  const layout = appLayout(appsDir, appId);
  if (!(await pathExists(layout.appDir))) return;
  const trash = path.join(appsDir, `.removing-${appId}-${randomUUID().slice(0, 8)}`);
  try {
    await renameWithRetry(layout.appDir, trash);
  } catch (error) {
    throw new LauncherError(
      'busy',
      `The application could not be removed. Close it and try again. (${errorMessage(error)})`,
      { cause: error },
    );
  }
  await rm(trash, { recursive: true, force: true }).catch((error: unknown) => {
    logger.warn('installer', `Leftover files could not be removed: ${trash}`, error);
  });
  logger.info('installer', `Uninstalled ${appId}`);
}
