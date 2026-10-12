import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  AppDescriptorSchema,
  AppIdSchema,
  InstallationRecordSchema,
  compareVersions,
  isValidVersion,
  type AppDescriptor,
  type InstallationRecord,
} from '@auram/app-manifest';
import { isNotFound, isWithin, readJsonFile } from './fs-utils';

export const DESCRIPTOR_FILE = 'auram-app.json';
export const CURRENT_FILE = 'current.json';
export const VERSIONS_DIR = 'versions';

export interface AppLayout {
  appDir: string;
  versionsDir: string;
  currentFile: string;
  versionDir(version: string): string;
}

/** Directory layout of one application under the apps directory. */
export function appLayout(appsDir: string, appId: string): AppLayout {
  // Ids are validated so they can never contain path separators.
  const id = AppIdSchema.parse(appId);
  const appDir = path.join(appsDir, id);
  const versionsDir = path.join(appDir, VERSIONS_DIR);
  return {
    appDir,
    versionsDir,
    currentFile: path.join(appDir, CURRENT_FILE),
    versionDir: (version: string) => {
      if (!isValidVersion(version)) throw new Error(`Invalid version: ${version}`);
      return path.join(versionsDir, version);
    },
  };
}

export interface InstalledApp {
  id: string;
  version: string;
  versionDir: string;
  record: InstallationRecord | null;
  descriptor: AppDescriptor | null;
  /** Absolute path of the executable for this platform, when launchable. */
  executablePath: string | null;
  problem: string | null;
}

export type DescriptorCheck =
  | { ok: true; descriptor: AppDescriptor; executablePath: string | null; problem: string | null }
  | { ok: false; problem: string };

/** Reads and validates `auram-app.json` in a version directory. */
export async function inspectVersionDir(
  versionDir: string,
  expected: { id: string; version: string },
  platform: NodeJS.Platform,
): Promise<DescriptorCheck> {
  const read = await readJsonFile(path.join(versionDir, DESCRIPTOR_FILE), 256 * 1024);
  if (read.kind === 'missing') return { ok: false, problem: `${DESCRIPTOR_FILE} is missing.` };
  if (read.kind === 'invalid')
    return { ok: false, problem: `${DESCRIPTOR_FILE} is not valid JSON.` };
  const parsed = AppDescriptorSchema.safeParse(read.value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      problem: `${DESCRIPTOR_FILE} is invalid: ${issue?.path.join('.')} ${issue?.message}`,
    };
  }
  const descriptor = parsed.data;
  if (descriptor.id !== expected.id) {
    return {
      ok: false,
      problem: `${DESCRIPTOR_FILE} belongs to ${descriptor.id}, expected ${expected.id}.`,
    };
  }
  if (descriptor.version !== expected.version) {
    return {
      ok: false,
      problem: `${DESCRIPTOR_FILE} declares version ${descriptor.version}, expected ${expected.version}.`,
    };
  }

  const relative = descriptor.executable[platform as 'win32' | 'darwin' | 'linux'];
  if (!relative) {
    return {
      ok: true,
      descriptor,
      executablePath: null,
      problem: 'This version does not support this operating system.',
    };
  }
  const executablePath = path.resolve(versionDir, ...relative.split('/'));
  if (!isWithin(versionDir, executablePath)) {
    return { ok: false, problem: 'The executable path points outside the installation.' };
  }
  try {
    const info = await stat(executablePath);
    if (!info.isFile())
      return { ok: true, descriptor, executablePath: null, problem: 'The executable is missing.' };
  } catch (error) {
    if (!isNotFound(error)) throw error;
    return { ok: true, descriptor, executablePath: null, problem: 'The executable is missing.' };
  }
  return { ok: true, descriptor, executablePath, problem: null };
}

async function listVersionDirs(versionsDir: string): Promise<string[]> {
  try {
    const entries = await readdir(versionsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && isValidVersion(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => compareVersions(b, a));
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
}

/**
 * Finds the active installation of an application.
 *
 * `current.json` (written by the launcher after a verified install) selects the
 * active version. Without it, the newest version directory with a valid
 * descriptor is used and reported as a manual installation, which lets
 * developers drop a local build into place. See docs/app-integration.md.
 */
export async function discoverInstalledApp(
  appsDir: string,
  appId: string,
  platform: NodeJS.Platform,
): Promise<InstalledApp | null> {
  const layout = appLayout(appsDir, appId);
  const current = await readJsonFile(layout.currentFile, 64 * 1024);

  if (current.kind === 'ok') {
    const record = InstallationRecordSchema.safeParse(current.value);
    if (record.success && record.data.id === appId) {
      const versionDir = layout.versionDir(record.data.version);
      const check = await inspectVersionDir(
        versionDir,
        { id: appId, version: record.data.version },
        platform,
      );
      return {
        id: appId,
        version: record.data.version,
        versionDir,
        record: record.data,
        descriptor: check.ok ? check.descriptor : null,
        executablePath: check.ok ? check.executablePath : null,
        problem: check.ok ? check.problem : check.problem,
      };
    }
  }

  for (const version of await listVersionDirs(layout.versionsDir)) {
    const versionDir = layout.versionDir(version);
    const check = await inspectVersionDir(versionDir, { id: appId, version }, platform);
    if (check.ok) {
      return {
        id: appId,
        version,
        versionDir,
        record: null,
        descriptor: check.descriptor,
        executablePath: check.executablePath,
        problem:
          current.kind === 'missing'
            ? check.problem
            : (check.problem ?? 'current.json is invalid; using the newest valid version.'),
      };
    }
  }
  return null;
}
