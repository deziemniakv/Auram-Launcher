import { Menu, app, net, type BrowserWindow } from 'electron';
import path from 'node:path';
import { compareVersions } from '@auram/app-manifest';
import { IPC_EVENTS, type LauncherInfo, type LauncherUpdateStatus } from '../shared/ipc';
import type { Settings } from '../shared/settings';
import { loadBundledCatalog } from './catalog';
import { registerIpcHandlers } from './ipc/register';
import { applySecurityPolicies } from './security';
import { AppManager } from './services/app-manager';
import { errorMessage, toIpcError } from './services/errors';
import { createFileLogger } from './services/logger';
import { githubTrustPolicy } from './services/net';
import { resolveAuramPaths } from './services/paths';
import { ProjectsService } from './services/projects-service';
import { lookupLatestLauncherRelease } from './services/releases';
import { SettingsService, loadSettings } from './services/settings-service';
import { createMainWindow } from './window';

const REPOSITORY = { owner: 'deziemniakv', repo: 'Auram-Launcher' };
const REPOSITORY_URL = `https://github.com/${REPOSITORY.owner}/${REPOSITORY.repo}`;

const paths = resolveAuramPaths({
  platform: process.platform,
  env: process.env,
  homeDir: app.getPath('home'),
  documentsDir: app.getPath('documents'),
});

// Keep Chromium's profile inside the launcher's own data folder instead of %APPDATA%.
app.setPath('userData', paths.electronDataDir);
app.setPath('sessionData', paths.electronDataDir);
app.setAppUserModelId('com.auram.launcher');

const logger = createFileLogger({ dir: paths.logsDir, console: !app.isPackaged });

process.on('uncaughtException', (error) => logger.error('process', 'Uncaught exception', error));
process.on('unhandledRejection', (reason) =>
  logger.error('process', 'Unhandled rejection', reason),
);

let mainWindow: BrowserWindow | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(start, async (error: unknown) => {
    logger.error('startup', 'Electron failed to initialise', error);
    await logger.flush();
    app.exit(1);
  });
}

async function start(): Promise<void> {
  logger.info('startup', `Auram Launcher ${app.getVersion()} starting`, {
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    packaged: app.isPackaged,
  });

  // Packaged builds have no menu: no reload or developer-tools shortcuts.
  if (app.isPackaged) Menu.setApplicationMenu(null);

  const loaded = await loadSettings(paths.settingsFile, app.getLocale(), logger);
  const settings = new SettingsService(paths.settingsFile, loaded, logger);
  await settings
    .save()
    .catch((error: unknown) => logger.error('startup', 'Could not write settings', error));
  logger.setLevel(settings.get().diagnostics.logLevel);

  const resolvedDirectories = () => {
    const { directories } = settings.get();
    return {
      projects: directories.projects ?? paths.defaultProjectsDir,
      apps: directories.apps ?? paths.defaultAppsDir,
    };
  };

  const catalog = loadBundledCatalog();
  const externalHosts = new Set(
    catalog.apps.flatMap((entry) => (entry.homepage ? [new URL(entry.homepage).hostname] : [])),
  );
  applySecurityPolicies(logger, () => externalHosts);

  const userAgent = `AuramLauncher/${app.getVersion()} (+${REPOSITORY_URL})`;
  const fetchImpl = (input: string, init?: RequestInit) => net.fetch(input, init);

  const apps = new AppManager({
    catalog,
    getAppsDir: () => resolvedDirectories().apps,
    downloadsDir: paths.downloadsDir,
    releaseCacheFile: path.join(paths.cacheDir, 'releases.json'),
    platform: process.platform,
    arch: process.arch,
    launcherVersion: app.getVersion(),
    userAgent,
    fetch: fetchImpl,
    trust: githubTrustPolicy,
    logger,
    getIncludePrerelease: () => settings.get().updates.includePrerelease,
  });
  await apps.init();

  const projects = new ProjectsService({
    recentFile: paths.recentProjectsFile,
    getProjectsDir: () => resolvedDirectories().projects,
    platform: process.platform,
    logger,
  });
  await projects.init();

  /* Launcher self-update discovery (informational; installs happen via the installer). */
  let launcherUpdate: LauncherUpdateStatus = { state: 'not-checked' };
  const broadcastLauncherUpdate = () =>
    mainWindow?.webContents.send(IPC_EVENTS.launcherUpdate, launcherUpdate);
  const checkLauncherUpdate = async (): Promise<LauncherUpdateStatus> => {
    if (launcherUpdate.state === 'checking') return launcherUpdate;
    launcherUpdate = { state: 'checking' };
    broadcastLauncherUpdate();
    const checkedAt = new Date().toISOString();
    try {
      const latest = await lookupLatestLauncherRelease(
        { fetch: fetchImpl, trust: githubTrustPolicy, userAgent },
        REPOSITORY,
      );
      let newer = false;
      try {
        newer = latest !== null && compareVersions(latest.version, app.getVersion()) > 0;
      } catch {
        logger.warn('launcher-update', `Ignoring release with non-semver tag ${latest?.version}`);
      }
      launcherUpdate =
        latest && newer
          ? { state: 'available', checkedAt, latestVersion: latest.version, releaseUrl: latest.url }
          : { state: 'up-to-date', checkedAt, latestVersion: latest?.version ?? null };
    } catch (error) {
      launcherUpdate = { state: 'error', checkedAt, message: toIpcError(error).message };
      logger.warn('launcher-update', 'Launcher update check failed', errorMessage(error));
    }
    broadcastLauncherUpdate();
    return launcherUpdate;
  };

  const info = (): LauncherInfo => ({
    name: 'Auram Launcher',
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
    paths: {
      dataRoot: paths.dataRoot,
      logs: paths.logsDir,
      apps: resolvedDirectories().apps,
      projects: resolvedDirectories().projects,
      downloads: paths.downloadsDir,
    },
    repositoryUrl: REPOSITORY_URL,
    supportsOpenAtLogin: process.platform === 'win32' || process.platform === 'darwin',
  });

  registerIpcHandlers({
    logger,
    paths,
    settings,
    apps,
    projects,
    info,
    resolvedDirectories,
    launcherUpdate: { status: () => launcherUpdate, check: checkLauncherUpdate },
    externalHosts: () => externalHosts,
    getWindow: () => mainWindow,
  });

  apps.onChanged((list) => mainWindow?.webContents.send(IPC_EVENTS.appsChanged, list));
  apps.onExited((notice) => mainWindow?.webContents.send(IPC_EVENTS.appExited, notice));

  settings.onChange((next: Settings, previous: Settings) => {
    logger.setLevel(next.diagnostics.logLevel);
    if (next.appearance.interfaceScale !== previous.appearance.interfaceScale) {
      mainWindow?.webContents.setZoomFactor(next.appearance.interfaceScale / 100);
    }
    if (
      next.startup.openAtLogin !== previous.startup.openAtLogin &&
      info().supportsOpenAtLogin &&
      app.isPackaged
    ) {
      app.setLoginItemSettings({ openAtLogin: next.startup.openAtLogin });
    }
    if (
      next.directories.apps !== previous.directories.apps ||
      next.updates.includePrerelease !== previous.updates.includePrerelease
    ) {
      void apps
        .refreshInstalled()
        .then(() => mainWindow?.webContents.send(IPC_EVENTS.appsChanged, apps.list()));
    }
  });

  mainWindow = await createMainWindow({
    stateFile: path.join(paths.launcherDir, 'window-state.json'),
    logger,
    zoomFactor: settings.get().appearance.interfaceScale / 100,
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  logger.info('startup', 'Main window loaded');

  if (settings.get().updates.checkOnStartup && !process.env.AURAM_OFFLINE) {
    void apps.checkReleases();
    if (app.isPackaged) void checkLauncherUpdate();
  }

  app.on('before-quit', () => {
    apps.dispose();
    void logger.flush();
  });
}
