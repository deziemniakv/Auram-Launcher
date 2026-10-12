import path from 'node:path';

export interface AuramPaths {
  /** Root of all launcher-managed, machine-local data. */
  dataRoot: string;
  /** Launcher state: settings, recent projects, logs, cache. */
  launcherDir: string;
  settingsFile: string;
  recentProjectsFile: string;
  logsDir: string;
  cacheDir: string;
  /** Chromium profile data used by Electron itself. */
  electronDataDir: string;
  /** Default location of installed applications (overridable in settings). */
  defaultAppsDir: string;
  /** Temporary artifact downloads. Safe to clear when no operation is running. */
  downloadsDir: string;
  /** User-facing creative content. Never deleted by the launcher. */
  userContentRoot: string;
  defaultProjectsDir: string;
}

export interface ResolvePathsInput {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  homeDir: string;
  documentsDir: string;
}

/**
 * Resolves the launcher's directory layout. Pure, so it can be tested for every
 * platform from any platform.
 *
 * Windows:  %LOCALAPPDATA%\Auram\...           and  %USERPROFILE%\Documents\Auram\...
 * macOS:    ~/Library/Application Support/Auram and ~/Documents/Auram
 * Linux:    $XDG_DATA_HOME/Auram (~/.local/share) and ~/Documents/Auram
 *
 * AURAM_DATA_DIR and AURAM_DOCUMENTS_DIR override both roots; they exist for
 * development and automated tests so a run never touches real user data.
 */
export function resolveAuramPaths({
  platform,
  env,
  homeDir,
  documentsDir,
}: ResolvePathsInput): AuramPaths {
  const p = platform === 'win32' ? path.win32 : path.posix;

  let dataRoot: string;
  if (env.AURAM_DATA_DIR) {
    dataRoot = env.AURAM_DATA_DIR;
  } else if (platform === 'win32') {
    dataRoot = p.join(env.LOCALAPPDATA || p.join(homeDir, 'AppData', 'Local'), 'Auram');
  } else if (platform === 'darwin') {
    dataRoot = p.join(homeDir, 'Library', 'Application Support', 'Auram');
  } else {
    dataRoot = p.join(env.XDG_DATA_HOME || p.join(homeDir, '.local', 'share'), 'Auram');
  }

  const userContentRoot = p.join(env.AURAM_DOCUMENTS_DIR || documentsDir, 'Auram');
  const launcherDir = p.join(dataRoot, 'Launcher');

  return {
    dataRoot,
    launcherDir,
    settingsFile: p.join(launcherDir, 'settings.json'),
    recentProjectsFile: p.join(launcherDir, 'recent-projects.json'),
    logsDir: p.join(launcherDir, 'logs'),
    cacheDir: p.join(launcherDir, 'cache'),
    electronDataDir: p.join(launcherDir, 'cache', 'electron'),
    defaultAppsDir: p.join(dataRoot, 'Apps'),
    downloadsDir: p.join(dataRoot, 'Downloads'),
    userContentRoot,
    defaultProjectsDir: p.join(userContentRoot, 'Projects'),
  };
}
