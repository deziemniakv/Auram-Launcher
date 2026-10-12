import { dialog, shell, type BrowserWindow } from 'electron';
import { fsp } from '../services/fs';
import { z } from 'zod';
import { AppIdSchema } from '@auram/app-manifest';
import {
  IPC,
  type FolderKind,
  type LauncherInfo,
  type LauncherUpdateStatus,
  type SettingsSnapshot,
} from '../../shared/ipc';
import { SettingsPatchSchema } from '../../shared/settings';
import type { AppManager } from '../services/app-manager';
import { LauncherError } from '../services/errors';
import type { Logger } from '../services/logger';
import type { AuramPaths } from '../services/paths';
import type { ProjectsService } from '../services/projects-service';
import type { SettingsService } from '../services/settings-service';
import { isAllowedExternalUrl } from '../security';
import { handle } from './handle';

const { mkdir } = fsp;

export interface IpcContext {
  logger: Logger;
  paths: AuramPaths;
  settings: SettingsService;
  apps: AppManager;
  projects: ProjectsService;
  info: () => LauncherInfo;
  resolvedDirectories: () => { projects: string; apps: string };
  launcherUpdate: {
    status: () => LauncherUpdateStatus;
    check: () => Promise<LauncherUpdateStatus>;
  };
  externalHosts: () => ReadonlySet<string>;
  getWindow: () => BrowserWindow | null;
}

const None = z.undefined();
const DirectoryKindSchema = z.enum(['projects', 'apps']);
const FolderKindSchema = z.enum(['logs', 'data', 'apps', 'projects']);
const ProjectPathSchema = z.string().min(1).max(4096);

const DIALOG_TEXT = {
  en: {
    projects: 'Choose projects folder',
    apps: 'Choose application storage folder',
    open: 'Open Auram project',
    filter: 'Auram projects',
  },
  pl: {
    projects: 'Wybierz folder projektów',
    apps: 'Wybierz folder aplikacji',
    open: 'Otwórz projekt Auram',
    filter: 'Projekty Auram',
  },
} as const;

export function registerIpcHandlers(ctx: IpcContext): void {
  const { logger } = ctx;
  const text = () => DIALOG_TEXT[ctx.settings.get().language];

  const settingsSnapshot = (): SettingsSnapshot => ({
    settings: ctx.settings.get(),
    resolved: ctx.resolvedDirectories(),
    defaults: { projects: ctx.paths.defaultProjectsDir, apps: ctx.paths.defaultAppsDir },
    warnings: ctx.settings.warnings,
  });

  /* Launcher */
  handle(logger, IPC.launcherInfo, None, () => ctx.info());
  handle(logger, IPC.launcherUpdateStatus, None, () => ctx.launcherUpdate.status());
  handle(logger, IPC.launcherCheckUpdate, None, () => ctx.launcherUpdate.check());

  /* Settings */
  handle(logger, IPC.settingsGet, None, () => settingsSnapshot());
  handle(logger, IPC.settingsUpdate, SettingsPatchSchema, async (patch) => {
    await ctx.settings.update(patch);
    return settingsSnapshot();
  });
  handle(logger, IPC.settingsChooseDirectory, DirectoryKindSchema, async (kind) => {
    const window = ctx.getWindow();
    const options: Electron.OpenDialogOptions = {
      title: text()[kind],
      defaultPath: ctx.resolvedDirectories()[kind],
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    const chosen = result.filePaths[0];
    if (result.canceled || !chosen) return null;
    await ctx.settings.setDirectory(kind, chosen);
    logger.info('settings', `Changed ${kind} directory`);
    return settingsSnapshot();
  });
  handle(logger, IPC.settingsResetDirectory, DirectoryKindSchema, async (kind) => {
    await ctx.settings.setDirectory(kind, null);
    return settingsSnapshot();
  });

  /* Applications */
  handle(logger, IPC.appsList, None, () => ctx.apps.list());
  handle(logger, IPC.appsRefresh, None, async () => {
    await ctx.apps.refreshInstalled();
    return ctx.apps.list();
  });
  handle(logger, IPC.appsCheckReleases, AppIdSchema.optional(), async (appId) => {
    await ctx.apps.checkReleases(appId);
    return ctx.apps.list();
  });
  handle(logger, IPC.appsLaunch, AppIdSchema, async (appId) => {
    await ctx.apps.launch(appId);
    return null;
  });
  handle(logger, IPC.appsInstall, AppIdSchema, async (appId) => {
    await ctx.apps.install(appId);
    return null;
  });
  handle(logger, IPC.appsCancel, AppIdSchema, (appId) => {
    ctx.apps.cancel(appId);
    return null;
  });
  handle(logger, IPC.appsUninstall, AppIdSchema, async (appId) => {
    await ctx.apps.uninstall(appId);
    return null;
  });
  handle(logger, IPC.appsDismissError, AppIdSchema, (appId) => {
    ctx.apps.dismissError(appId);
    return null;
  });

  /* Projects */
  handle(logger, IPC.projectsList, None, () => ctx.projects.snapshot());
  const openProjectFile = async (file: string) => {
    const appId = await ctx.projects.projectAppId(file);
    const entry = ctx.apps.list().find((candidate) => candidate.id === appId);
    if (!entry)
      throw new LauncherError(
        'not-found',
        `This project belongs to an unknown application (${appId}).`,
      );
    if (!entry.installed) {
      throw new LauncherError(
        'not-installed',
        `${entry.name} is required to open this project and is not installed.`,
      );
    }
    await ctx.apps.launch(appId, file);
  };

  handle(logger, IPC.projectsOpen, ProjectPathSchema, async (raw) => {
    const file = await ctx.projects.assertProjectFile(raw);
    await openProjectFile(file);
    await ctx.projects.addRecent(file);
    return null;
  });
  handle(logger, IPC.projectsChooseAndOpen, None, async () => {
    const window = ctx.getWindow();
    const options: Electron.OpenDialogOptions = {
      title: text().open,
      defaultPath: ctx.resolvedDirectories().projects,
      properties: ['openFile'],
      filters: [{ name: text().filter, extensions: ['cproj'] }],
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    const chosen = result.filePaths[0];
    if (result.canceled || !chosen) return null;
    const file = await ctx.projects.assertProjectFile(chosen);
    // Remember the project even if it cannot be opened yet, so it stays easy to find.
    await ctx.projects.addRecent(file);
    await openProjectFile(file);
    return null;
  });
  handle(logger, IPC.projectsReveal, ProjectPathSchema, async (raw) => {
    const file = await ctx.projects.assertProjectFile(raw);
    shell.showItemInFolder(file);
    return null;
  });
  handle(logger, IPC.projectsAddExisting, None, async () => {
    const window = ctx.getWindow();
    const options: Electron.OpenDialogOptions = {
      title: text().open,
      defaultPath: ctx.resolvedDirectories().projects,
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: text().filter, extensions: ['cproj'] }],
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    for (const chosen of result.filePaths) {
      await ctx.projects.addRecent(await ctx.projects.assertProjectFile(chosen));
    }
    return ctx.projects.snapshot();
  });
  handle(logger, IPC.projectsRemoveRecent, ProjectPathSchema, async (file) => {
    await ctx.projects.removeRecent(file);
    return ctx.projects.snapshot();
  });

  /* System */
  handle(logger, IPC.systemOpenFolder, FolderKindSchema, async (kind: FolderKind) => {
    const dirs = ctx.resolvedDirectories();
    const target = {
      logs: ctx.paths.logsDir,
      data: ctx.paths.dataRoot,
      apps: dirs.apps,
      projects: dirs.projects,
    }[kind];
    await mkdir(target, { recursive: true });
    const error = await shell.openPath(target);
    if (error) throw new LauncherError('io', error);
    return null;
  });
  handle(logger, IPC.systemOpenExternal, z.string().max(2048), async (url) => {
    if (!isAllowedExternalUrl(url, ctx.externalHosts())) {
      throw new LauncherError('forbidden', 'This link cannot be opened.');
    }
    await shell.openExternal(url);
    return null;
  });
}
