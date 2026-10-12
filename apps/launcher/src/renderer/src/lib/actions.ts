import type { AppView, FolderKind } from '../../../shared/ipc';
import { dictionaries } from '../i18n';
import { useAppsStore } from '../store/apps';
import { useProjectsStore } from '../store/projects';
import { useSettingsStore } from '../store/settings';
import { toast } from '../store/ui';
import { call, messageOf } from './api';

/*
 * User-initiated actions. Each reports failures as a visible toast with the
 * reason from the main process; nothing fails silently.
 */

function t() {
  return dictionaries[useSettingsStore.getState().snapshot?.settings.language ?? 'en'];
}

export async function launchApp(app: AppView): Promise<void> {
  try {
    await call((api) => api.apps.launch(app.id));
    toast({ tone: 'info', title: t().toasts.launched(app.name) });
  } catch (error) {
    toast({ tone: 'error', title: t().errors.launchFailed(app.name), body: messageOf(error) });
  }
}

export async function installApp(app: AppView): Promise<void> {
  try {
    await call((api) => api.apps.install(app.id));
  } catch (error) {
    toast({ tone: 'error', title: t().errors.installFailed(app.name), body: messageOf(error) });
  }
}

export async function cancelOperation(app: AppView): Promise<void> {
  try {
    await call((api) => api.apps.cancel(app.id));
  } catch (error) {
    toast({ tone: 'error', title: t().errors.generic, body: messageOf(error) });
  }
}

export async function retryOperation(app: AppView): Promise<void> {
  await call((api) => api.apps.dismissError(app.id)).catch(() => {});
  await installApp(app);
}

export async function dismissAppError(app: AppView): Promise<void> {
  await call((api) => api.apps.dismissError(app.id)).catch(() => {});
}

export async function uninstallApp(app: AppView): Promise<boolean> {
  try {
    await call((api) => api.apps.uninstall(app.id));
    toast({ tone: 'success', title: t().toasts.uninstalled(app.name) });
    return true;
  } catch (error) {
    toast({ tone: 'error', title: t().errors.uninstallFailed(app.name), body: messageOf(error) });
    return false;
  }
}

export async function checkReleases(appId?: string): Promise<void> {
  try {
    await useAppsStore.getState().checkReleases(appId);
  } catch (error) {
    toast({ tone: 'error', title: t().errors.checkFailed, body: messageOf(error) });
  }
}

export async function openProject(path: string): Promise<void> {
  try {
    await call((api) => api.projects.open(path));
  } catch (error) {
    toast({ tone: 'error', title: t().errors.openProjectFailed, body: messageOf(error) });
  } finally {
    void useProjectsStore.getState().load();
  }
}

export async function revealProject(path: string): Promise<void> {
  try {
    await call((api) => api.projects.reveal(path));
  } catch (error) {
    toast({ tone: 'error', title: t().errors.generic, body: messageOf(error) });
  }
}

export async function addExistingProjects(): Promise<void> {
  try {
    const snapshot = await call((api) => api.projects.addExisting());
    if (snapshot) useProjectsStore.getState().setSnapshot(snapshot);
  } catch (error) {
    toast({ tone: 'error', title: t().errors.generic, body: messageOf(error) });
  }
}

export async function removeRecentProject(path: string): Promise<void> {
  try {
    useProjectsStore.getState().setSnapshot(await call((api) => api.projects.removeRecent(path)));
  } catch (error) {
    toast({ tone: 'error', title: t().errors.generic, body: messageOf(error) });
  }
}

export async function openFolder(kind: FolderKind): Promise<void> {
  try {
    await call((api) => api.system.openFolder(kind));
  } catch (error) {
    toast({ tone: 'error', title: t().errors.generic, body: messageOf(error) });
  }
}

export async function openExternal(url: string): Promise<void> {
  try {
    await call((api) => api.system.openExternal(url));
  } catch (error) {
    toast({ tone: 'error', title: t().errors.generic, body: messageOf(error) });
  }
}

export async function chooseAndOpenProject(): Promise<void> {
  try {
    await call((api) => api.projects.chooseAndOpen());
  } catch (error) {
    toast({ tone: 'error', title: t().errors.openProjectFailed, body: messageOf(error) });
  } finally {
    void useProjectsStore.getState().load();
  }
}
