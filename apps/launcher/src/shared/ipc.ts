import type { AppAvailability, AppCategory } from '@auram/app-manifest';
import type { Settings, SettingsPatch } from './settings';

/* -------------------------------------------------------------------------- */
/* Result envelope. Handlers never throw across the IPC boundary.              */
/* -------------------------------------------------------------------------- */

export type ErrorCode =
  | 'invalid-input'
  | 'forbidden'
  | 'not-found'
  | 'not-installed'
  | 'busy'
  | 'network'
  | 'integrity'
  | 'invalid-package'
  | 'incompatible'
  | 'launch-failed'
  | 'cancelled'
  | 'io'
  | 'unknown';

export interface IpcError {
  code: ErrorCode;
  message: string;
}

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: IpcError };

/* -------------------------------------------------------------------------- */
/* Launcher                                                                     */
/* -------------------------------------------------------------------------- */

export interface LauncherInfo {
  name: string;
  version: string;
  platform: string;
  arch: string;
  isPackaged: boolean;
  versions: { electron: string; chrome: string; node: string };
  paths: { dataRoot: string; logs: string; apps: string; projects: string; downloads: string };
  repositoryUrl: string;
  /** Whether "open at login" is supported on this platform. */
  supportsOpenAtLogin: boolean;
}

export type LauncherUpdateStatus =
  | { state: 'not-checked' }
  | { state: 'checking' }
  | { state: 'up-to-date'; checkedAt: string; latestVersion: string | null }
  | { state: 'available'; checkedAt: string; latestVersion: string; releaseUrl: string }
  | { state: 'error'; checkedAt: string; message: string };

export interface SettingsSnapshot {
  settings: Settings;
  /** Resolved directories, with defaults applied. */
  resolved: { projects: string; apps: string };
  defaults: { projects: string; apps: string };
  /** Problems found while loading, e.g. a corrupted settings file that was backed up. */
  warnings: string[];
}

/* -------------------------------------------------------------------------- */
/* Applications                                                                 */
/* -------------------------------------------------------------------------- */

export interface InstalledAppView {
  version: string;
  installedAt: string | null;
  source: 'release' | 'manual';
  /** False when the installation is present but cannot be launched on this OS. */
  launchable: boolean;
  problem: string | null;
}

export interface ReleaseNotesView {
  summary: string | null;
  body: string | null;
  url: string | null;
}

export type ReleaseStatus =
  | { state: 'not-checked' }
  | { state: 'checking' }
  /** The catalog has no release source for this application. */
  | { state: 'no-source' }
  /** The release source exists but has not published a usable release. */
  | { state: 'no-release'; checkedAt: string }
  | { state: 'error'; checkedAt: string; message: string }
  | {
      state: 'resolved';
      checkedAt: string;
      version: string;
      channel: 'stable' | 'prerelease';
      releasedAt: string;
      notes: ReleaseNotesView;
      downloadSize: number | null;
      resolution:
        | 'not-installed-available'
        | 'update-available'
        | 'up-to-date'
        | 'prerelease-skipped'
        | 'requires-newer-launcher'
        | 'no-compatible-artifact';
      minLauncherVersion: string;
    };

export type OperationState =
  | {
      phase: 'downloading';
      kind: 'install' | 'update';
      version: string;
      receivedBytes: number;
      totalBytes: number;
    }
  | { phase: 'verifying'; kind: 'install' | 'update'; version: string }
  | { phase: 'installing'; kind: 'install' | 'update'; version: string }
  | { phase: 'uninstalling' }
  | {
      phase: 'failed';
      kind: 'install' | 'update' | 'uninstall';
      version: string | null;
      code: ErrorCode;
      message: string;
      at: string;
    };

export interface AppView {
  id: string;
  name: string;
  description: string;
  descriptionTranslations: Record<string, string>;
  category: AppCategory;
  availability: AppAvailability;
  homepage: string | null;
  projectExtensions: string[];
  installed: InstalledAppView | null;
  release: ReleaseStatus;
  operation: OperationState | null;
  running: boolean;
}

export interface AppExitNotice {
  appId: string;
  appName: string;
  exitCode: number | null;
  signal: string | null;
}

/* -------------------------------------------------------------------------- */
/* Projects                                                                     */
/* -------------------------------------------------------------------------- */

export interface ProjectView {
  path: string;
  fileName: string;
  /** From the project manifest; null when the file could not be read. */
  name: string | null;
  appId: string | null;
  /** `modifiedAt` recorded by the application inside the project. */
  modifiedAt: string | null;
  /** Filesystem modification time. */
  fileModifiedAt: string | null;
  thumbnail: string | null;
  status: 'ok' | 'missing' | 'invalid';
  problem: string | null;
  lastOpenedAt: string | null;
}

export interface ProjectsSnapshot {
  recent: ProjectView[];
  directory: {
    path: string;
    exists: boolean;
    projects: ProjectView[];
    truncated: boolean;
    error: string | null;
  };
}

/* -------------------------------------------------------------------------- */
/* Channels                                                                     */
/* -------------------------------------------------------------------------- */

export const IPC = {
  launcherInfo: 'auram:launcher:info',
  launcherCheckUpdate: 'auram:launcher:check-update',
  launcherUpdateStatus: 'auram:launcher:update-status',
  settingsGet: 'auram:settings:get',
  settingsUpdate: 'auram:settings:update',
  settingsChooseDirectory: 'auram:settings:choose-directory',
  settingsResetDirectory: 'auram:settings:reset-directory',
  appsList: 'auram:apps:list',
  appsRefresh: 'auram:apps:refresh',
  appsCheckReleases: 'auram:apps:check-releases',
  appsLaunch: 'auram:apps:launch',
  appsInstall: 'auram:apps:install',
  appsCancel: 'auram:apps:cancel',
  appsUninstall: 'auram:apps:uninstall',
  appsDismissError: 'auram:apps:dismiss-error',
  projectsList: 'auram:projects:list',
  projectsOpen: 'auram:projects:open',
  projectsReveal: 'auram:projects:reveal',
  projectsAddExisting: 'auram:projects:add-existing',
  projectsChooseAndOpen: 'auram:projects:choose-and-open',
  projectsRemoveRecent: 'auram:projects:remove-recent',
  systemOpenFolder: 'auram:system:open-folder',
  systemOpenExternal: 'auram:system:open-external',
} as const;

/** Events pushed from the main process to the renderer. */
export const IPC_EVENTS = {
  appsChanged: 'auram:event:apps-changed',
  appExited: 'auram:event:app-exited',
  launcherUpdate: 'auram:event:launcher-update',
} as const;

export type FolderKind = 'logs' | 'data' | 'apps' | 'projects';
export type DirectoryKind = 'projects' | 'apps';

/** The API exposed to the renderer as `window.auram`. */
export interface AuramApi {
  launcher: {
    info(): Promise<IpcResult<LauncherInfo>>;
    updateStatus(): Promise<IpcResult<LauncherUpdateStatus>>;
    checkForUpdate(): Promise<IpcResult<LauncherUpdateStatus>>;
    onUpdateStatus(listener: (status: LauncherUpdateStatus) => void): () => void;
  };
  settings: {
    get(): Promise<IpcResult<SettingsSnapshot>>;
    update(patch: SettingsPatch): Promise<IpcResult<SettingsSnapshot>>;
    chooseDirectory(kind: DirectoryKind): Promise<IpcResult<SettingsSnapshot | null>>;
    resetDirectory(kind: DirectoryKind): Promise<IpcResult<SettingsSnapshot>>;
  };
  apps: {
    list(): Promise<IpcResult<AppView[]>>;
    refresh(): Promise<IpcResult<AppView[]>>;
    checkReleases(appId?: string): Promise<IpcResult<AppView[]>>;
    launch(appId: string): Promise<IpcResult<null>>;
    install(appId: string): Promise<IpcResult<null>>;
    cancel(appId: string): Promise<IpcResult<null>>;
    uninstall(appId: string): Promise<IpcResult<null>>;
    dismissError(appId: string): Promise<IpcResult<null>>;
    onChanged(listener: (apps: AppView[]) => void): () => void;
    onExited(listener: (notice: AppExitNotice) => void): () => void;
  };
  projects: {
    list(): Promise<IpcResult<ProjectsSnapshot>>;
    open(path: string): Promise<IpcResult<null>>;
    reveal(path: string): Promise<IpcResult<null>>;
    addExisting(): Promise<IpcResult<ProjectsSnapshot | null>>;
    /** Lets the user pick one project file, remembers it and opens it. */
    chooseAndOpen(): Promise<IpcResult<null>>;
    removeRecent(path: string): Promise<IpcResult<ProjectsSnapshot>>;
  };
  system: {
    openFolder(kind: FolderKind): Promise<IpcResult<null>>;
    openExternal(url: string): Promise<IpcResult<null>>;
  };
}
