import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, IPC_EVENTS, type AuramApi } from '../shared/ipc';

/*
 * The only bridge between the sandboxed renderer and the main process.
 * Each method maps to one validated IPC channel; no Node.js or Electron
 * objects are exposed, and listeners receive plain data only.
 */

const invoke = <T>(channel: string, input?: unknown): Promise<T> =>
  ipcRenderer.invoke(channel, input);

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

const api: AuramApi = {
  launcher: {
    info: () => invoke(IPC.launcherInfo),
    updateStatus: () => invoke(IPC.launcherUpdateStatus),
    checkForUpdate: () => invoke(IPC.launcherCheckUpdate),
    onUpdateStatus: (listener) => subscribe(IPC_EVENTS.launcherUpdate, listener),
  },
  settings: {
    get: () => invoke(IPC.settingsGet),
    update: (patch) => invoke(IPC.settingsUpdate, patch),
    chooseDirectory: (kind) => invoke(IPC.settingsChooseDirectory, kind),
    resetDirectory: (kind) => invoke(IPC.settingsResetDirectory, kind),
  },
  apps: {
    list: () => invoke(IPC.appsList),
    refresh: () => invoke(IPC.appsRefresh),
    checkReleases: (appId) => invoke(IPC.appsCheckReleases, appId),
    launch: (appId) => invoke(IPC.appsLaunch, appId),
    install: (appId) => invoke(IPC.appsInstall, appId),
    cancel: (appId) => invoke(IPC.appsCancel, appId),
    uninstall: (appId) => invoke(IPC.appsUninstall, appId),
    dismissError: (appId) => invoke(IPC.appsDismissError, appId),
    onChanged: (listener) => subscribe(IPC_EVENTS.appsChanged, listener),
    onExited: (listener) => subscribe(IPC_EVENTS.appExited, listener),
  },
  projects: {
    list: () => invoke(IPC.projectsList),
    open: (path) => invoke(IPC.projectsOpen, path),
    reveal: (path) => invoke(IPC.projectsReveal, path),
    addExisting: () => invoke(IPC.projectsAddExisting),
    chooseAndOpen: () => invoke(IPC.projectsChooseAndOpen),
    removeRecent: (path) => invoke(IPC.projectsRemoveRecent, path),
  },
  system: {
    openFolder: (kind) => invoke(IPC.systemOpenFolder, kind),
    openExternal: (url) => invoke(IPC.systemOpenExternal, url),
  },
};

contextBridge.exposeInMainWorld('auram', api);
