import { fsp } from './fs';
import path from 'node:path';
import {
  MAX_PROJECT_MANIFEST_BYTES,
  MAX_PROJECT_THUMBNAIL_BYTES,
  PROJECT_MANIFEST_ENTRY,
  PROJECT_THUMBNAIL_ENTRIES,
  isProjectFileName,
  parseProjectManifest,
  type ThumbnailEntry,
} from '@auram/project-format';
import { z } from 'zod';
import type { ProjectView, ProjectsSnapshot } from '../../shared/ipc';
import { LauncherError, errorMessage } from './errors';
import { isNotFound, readJsonFile, writeJsonAtomic } from './fs-utils';
import type { Logger } from './logger';
import { readZipEntries } from './zip';

const { readdir, stat } = fsp;

const MAX_RECENT = 30;
const MAX_DIRECTORY_PROJECTS = 300;

const RecentFileSchema = z.object({
  schemaVersion: z.literal(1),
  items: z.array(
    z.object({ path: z.string().min(1).max(4096), lastOpenedAt: z.iso.datetime({ offset: true }) }),
  ),
});
type RecentItem = z.infer<typeof RecentFileSchema>['items'][number];

interface ProjectDetails {
  name: string | null;
  appId: string | null;
  modifiedAt: string | null;
  fileModifiedAt: string | null;
  thumbnail: string | null;
  status: ProjectView['status'];
  problem: string | null;
}

/** Normalises a path for comparisons; Windows paths are case-insensitive. */
function pathKey(target: string, platform: NodeJS.Platform): string {
  const resolved = path.resolve(target);
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * Reads project metadata from `.cproj` containers. All metadata shown in the UI
 * comes from the file itself or the filesystem; nothing is inferred or invented.
 */
export async function readProjectDetails(file: string): Promise<ProjectDetails> {
  let mtime: Date;
  try {
    const info = await stat(file);
    if (!info.isFile()) {
      return {
        name: null,
        appId: null,
        modifiedAt: null,
        fileModifiedAt: null,
        thumbnail: null,
        status: 'invalid',
        problem: 'Not a file.',
      };
    }
    mtime = info.mtime;
  } catch (error) {
    if (!isNotFound(error)) throw error;
    return {
      name: null,
      appId: null,
      modifiedAt: null,
      fileModifiedAt: null,
      thumbnail: null,
      status: 'missing',
      problem: 'The file no longer exists.',
    };
  }
  const fileModifiedAt = mtime.toISOString();

  let entries: Map<string, Buffer>;
  try {
    entries = await readZipEntries(file, {
      [PROJECT_MANIFEST_ENTRY]: MAX_PROJECT_MANIFEST_BYTES,
      ...Object.fromEntries(
        Object.keys(PROJECT_THUMBNAIL_ENTRIES).map((name) => [name, MAX_PROJECT_THUMBNAIL_BYTES]),
      ),
    });
  } catch (error) {
    return {
      name: null,
      appId: null,
      modifiedAt: null,
      fileModifiedAt,
      thumbnail: null,
      status: 'invalid',
      problem: errorMessage(error),
    };
  }

  const manifestBytes = entries.get(PROJECT_MANIFEST_ENTRY);
  if (!manifestBytes) {
    return {
      name: null,
      appId: null,
      modifiedAt: null,
      fileModifiedAt,
      thumbnail: null,
      status: 'invalid',
      problem: 'The project has no manifest.json.',
    };
  }
  const parsed = parseProjectManifest(manifestBytes.toString('utf8'));
  if (!parsed.ok) {
    return {
      name: null,
      appId: null,
      modifiedAt: null,
      fileModifiedAt,
      thumbnail: null,
      status: 'invalid',
      problem: parsed.error,
    };
  }

  let thumbnail: string | null = null;
  for (const [entry, mime] of Object.entries(PROJECT_THUMBNAIL_ENTRIES) as Array<
    [ThumbnailEntry, string]
  >) {
    const bytes = entries.get(entry);
    if (bytes && bytes.length > 0) {
      thumbnail = `data:${mime};base64,${bytes.toString('base64')}`;
      break;
    }
  }

  return {
    name: parsed.manifest.name,
    appId: parsed.manifest.appId,
    modifiedAt: parsed.manifest.modifiedAt,
    fileModifiedAt,
    thumbnail,
    status: 'ok',
    problem: null,
  };
}

export class ProjectsService {
  private recent: RecentItem[] = [];
  private readonly cache = new Map<
    string,
    { mtimeMs: number; size: number; details: ProjectDetails }
  >();

  constructor(
    private readonly deps: {
      recentFile: string;
      getProjectsDir: () => string;
      platform: NodeJS.Platform;
      logger: Logger;
    },
  ) {}

  async init(): Promise<void> {
    const read = await readJsonFile(this.deps.recentFile);
    if (read.kind === 'ok') {
      const parsed = RecentFileSchema.safeParse(read.value);
      if (parsed.success)
        this.recent = parsed.data.items.filter((item) => path.isAbsolute(item.path));
      else
        this.deps.logger.warn(
          'projects',
          'Recent projects file is invalid; starting with an empty list',
        );
    } else if (read.kind === 'invalid') {
      this.deps.logger.warn(
        'projects',
        'Recent projects file is unreadable; starting with an empty list',
        read.error,
      );
    }
  }

  private async details(file: string): Promise<ProjectDetails> {
    const key = pathKey(file, this.deps.platform);
    try {
      const info = await stat(file);
      const cached = this.cache.get(key);
      if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size)
        return cached.details;
      const details = await readProjectDetails(file);
      this.cache.set(key, { mtimeMs: info.mtimeMs, size: info.size, details });
      return details;
    } catch (error) {
      if (!isNotFound(error))
        this.deps.logger.warn('projects', `Cannot read ${file}`, errorMessage(error));
      this.cache.delete(key);
      return readProjectDetails(file);
    }
  }

  private async toView(file: string, lastOpenedAt: string | null): Promise<ProjectView> {
    return {
      path: file,
      fileName: path.basename(file),
      lastOpenedAt,
      ...(await this.details(file)),
    };
  }

  private async scanDirectory(): Promise<ProjectsSnapshot['directory']> {
    const dir = this.deps.getProjectsDir();
    const files: string[] = [];
    let truncated = false;
    try {
      const top = await readdir(dir, { withFileTypes: true });
      // Projects directly in the folder, plus one level of subfolders.
      for (const entry of top) {
        if (entry.isFile() && isProjectFileName(entry.name)) files.push(path.join(dir, entry.name));
      }
      for (const entry of top) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        try {
          for (const child of await readdir(path.join(dir, entry.name), { withFileTypes: true })) {
            if (child.isFile() && isProjectFileName(child.name))
              files.push(path.join(dir, entry.name, child.name));
          }
        } catch (error) {
          this.deps.logger.debug(
            'projects',
            `Skipping unreadable folder ${entry.name}`,
            errorMessage(error),
          );
        }
      }
    } catch (error) {
      if (isNotFound(error))
        return { path: dir, exists: false, projects: [], truncated: false, error: null };
      return {
        path: dir,
        exists: true,
        projects: [],
        truncated: false,
        error: errorMessage(error),
      };
    }

    if (files.length > MAX_DIRECTORY_PROJECTS) {
      truncated = true;
      files.length = MAX_DIRECTORY_PROJECTS;
    }
    const recentByKey = new Map(
      this.recent.map((item) => [pathKey(item.path, this.deps.platform), item.lastOpenedAt]),
    );
    const projects = await Promise.all(
      files.map((file) =>
        this.toView(file, recentByKey.get(pathKey(file, this.deps.platform)) ?? null),
      ),
    );
    const sortKey = (view: ProjectView) => view.modifiedAt ?? view.fileModifiedAt ?? '';
    projects.sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
    return { path: dir, exists: true, projects, truncated, error: null };
  }

  async snapshot(): Promise<ProjectsSnapshot> {
    const [recent, directory] = await Promise.all([
      Promise.all(this.recent.map((item) => this.toView(item.path, item.lastOpenedAt))),
      this.scanDirectory(),
    ]);
    return { recent, directory };
  }

  /** Validates a renderer-supplied project path before any privileged use. */
  async assertProjectFile(file: string): Promise<string> {
    if (
      typeof file !== 'string' ||
      !path.isAbsolute(file) ||
      !isProjectFileName(path.basename(file))
    ) {
      throw new LauncherError('invalid-input', 'Not an Auram project file.');
    }
    const resolved = path.resolve(file);
    try {
      const info = await stat(resolved);
      if (!info.isFile()) throw new LauncherError('invalid-input', 'Not an Auram project file.');
    } catch (error) {
      if (isNotFound(error))
        throw new LauncherError('not-found', 'The project file no longer exists.');
      throw error;
    }
    return resolved;
  }

  async projectAppId(file: string): Promise<string> {
    const details = await this.details(file);
    if (details.status !== 'ok' || !details.appId) {
      throw new LauncherError(
        'invalid-package',
        details.problem ?? 'The project file could not be read.',
      );
    }
    return details.appId;
  }

  async addRecent(file: string): Promise<void> {
    const key = pathKey(file, this.deps.platform);
    this.recent = [
      { path: file, lastOpenedAt: new Date().toISOString() },
      ...this.recent.filter((item) => pathKey(item.path, this.deps.platform) !== key),
    ].slice(0, MAX_RECENT);
    await this.saveRecent();
  }

  async removeRecent(file: string): Promise<void> {
    const key = pathKey(file, this.deps.platform);
    this.recent = this.recent.filter((item) => pathKey(item.path, this.deps.platform) !== key);
    await this.saveRecent();
  }

  private async saveRecent(): Promise<void> {
    await writeJsonAtomic(this.deps.recentFile, { schemaVersion: 1, items: this.recent });
  }
}
