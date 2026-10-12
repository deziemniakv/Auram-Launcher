import { useEffect, useState } from 'react';
import { Button, ErrorState, LoadingState, ToastViewport } from '@auram/ui';
import type { AppView } from '../../shared/ipc';
import { Shell } from './components/Shell';
import { dictionaries, useLanguage, useT } from './i18n';
import { getApi, messageOf } from './lib/api';
import { ApplicationsPage } from './pages/ApplicationsPage';
import { HomePage } from './pages/HomePage';
import { ProjectsPage } from './pages/ProjectsPage';
import { SettingsPage } from './pages/SettingsPage';
import { UpdatesPage } from './pages/UpdatesPage';
import { useAppsStore } from './store/apps';
import { useSettingsStore } from './store/settings';
import { toast, useUiStore } from './store/ui';

function currentT() {
  return dictionaries[useSettingsStore.getState().snapshot?.settings.language ?? 'en'];
}

/** Announces completed installs by comparing consecutive application snapshots. */
function announceTransitions(previous: AppView[], next: AppView[]): void {
  for (const app of next) {
    const before = previous.find((candidate) => candidate.id === app.id);
    const op = before?.operation;
    if (!op || app.operation) continue;
    if (
      (op.phase === 'installing' || op.phase === 'verifying') &&
      app.installed?.version === op.version
    ) {
      toast({ tone: 'success', title: currentT().toasts.installed(app.name, op.version) });
    }
  }
}

async function initialise(): Promise<void> {
  await useSettingsStore.getState().load();
  await useAppsStore.getState().load();
  const snapshot = useSettingsStore.getState().snapshot;
  if (snapshot) useUiStore.getState().navigate(snapshot.settings.startup.startSection);
  for (const warning of snapshot?.warnings ?? []) {
    toast({ tone: 'error', title: currentT().settings.warningsTitle, body: warning });
  }
}

function useDocumentAttributes(): void {
  const language = useLanguage();
  const reduceMotion = useSettingsStore(
    (state) => state.snapshot?.settings.appearance.reduceMotion ?? false,
  );
  const platform = useSettingsStore((state) => state.info?.platform);
  useEffect(() => {
    const root = document.documentElement;
    root.lang = language;
    root.dataset.reduceMotion = String(reduceMotion);
    if (platform) root.dataset.platform = platform;
  }, [language, reduceMotion, platform]);
}

export function App() {
  const t = useT();
  const section = useUiStore((state) => state.section);
  const toasts = useUiStore((state) => state.toasts);
  const dismissToast = useUiStore((state) => state.dismissToast);
  const [status, setStatus] = useState<'loading' | 'ready' | { error: string }>(() =>
    window.auram ? 'loading' : { error: dictionaries.en.errors.bridgeMissing },
  );
  useDocumentAttributes();

  useEffect(() => {
    if (!window.auram) return;
    let disposed = false;
    const api = getApi();
    const unsubscribe = [
      api.apps.onChanged((apps) => {
        announceTransitions(useAppsStore.getState().apps, apps);
        useAppsStore.getState().set(apps);
      }),
      api.apps.onExited((notice) => {
        const dict = currentT();
        toast({
          tone: 'error',
          title: dict.errors.exitedEarly(notice.appName),
          body: dict.errors.exitCode(
            notice.exitCode !== null ? String(notice.exitCode) : (notice.signal ?? '?'),
          ),
        });
      }),
      api.launcher.onUpdateStatus((status) =>
        useSettingsStore.getState().setLauncherUpdate(status),
      ),
    ];
    initialise().then(
      () => !disposed && setStatus('ready'),
      (error: unknown) => !disposed && setStatus({ error: messageOf(error) }),
    );
    return () => {
      disposed = true;
      for (const off of unsubscribe) off();
    };
  }, []);

  if (status === 'loading') {
    return (
      <div className="auram-boot">
        <LoadingState label={t.common.loading} />
      </div>
    );
  }
  if (typeof status === 'object') {
    return (
      <div className="auram-boot">
        <ErrorState
          title={t.errors.startupFailed}
          actions={<Button onClick={() => window.location.reload()}>{t.common.retry}</Button>}
        >
          {status.error}
        </ErrorState>
      </div>
    );
  }

  return (
    <>
      <Shell>
        {section === 'home' && <HomePage />}
        {section === 'applications' && <ApplicationsPage />}
        {section === 'projects' && <ProjectsPage />}
        {section === 'updates' && <UpdatesPage />}
        {section === 'settings' && <SettingsPage />}
      </Shell>
      <ToastViewport toasts={toasts} onDismiss={dismissToast} dismissLabel={t.common.dismiss} />
    </>
  );
}
