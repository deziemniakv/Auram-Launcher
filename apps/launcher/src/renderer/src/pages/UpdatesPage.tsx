import { ExternalLink, RefreshCw } from 'lucide-react';
import { Button, EmptyState, Panel, ProgressBar, SectionHeader, StatusTag } from '@auram/ui';
import type { ReactNode } from 'react';
import type { AppView } from '../../../shared/ipc';
import { AppIcon } from '../components/AppCard';
import { BrandMark } from '../components/BrandMark';
import { useLanguage, useT, type Dictionary } from '../i18n';
import {
  cancelOperation,
  checkReleases,
  installApp,
  openExternal,
  retryOperation,
} from '../lib/actions';
import { deriveAppState } from '../lib/app-state';
import { formatBytes, formatDate, formatRelative } from '../lib/format';
import { useAppsStore } from '../store/apps';
import { useSettingsStore } from '../store/settings';
import { toast } from '../store/ui';
import { messageOf } from '../lib/api';
import styles from './UpdatesPage.module.css';
import page from './Page.module.css';

function LauncherPanel() {
  const t = useT();
  const language = useLanguage();
  const info = useSettingsStore((state) => state.info);
  const status = useSettingsStore((state) => state.launcherUpdate);
  const check = useSettingsStore((state) => state.checkLauncherUpdate);

  const runCheck = () =>
    check().catch((error: unknown) =>
      toast({ tone: 'error', title: t.errors.checkFailed, body: messageOf(error) }),
    );

  let line: string;
  let tone: 'neutral' | 'success' | 'warning' | 'danger' = 'neutral';
  switch (status.state) {
    case 'not-checked':
      line = info?.isPackaged ? t.updates.launcherNotChecked : t.updates.launcherDev;
      break;
    case 'checking':
      line = t.appDetails.checking;
      break;
    case 'up-to-date':
      line = status.latestVersion ? t.updates.launcherUpToDate : t.updates.launcherNoReleases;
      tone = 'success';
      break;
    case 'available':
      line = t.updates.launcherAvailable(status.latestVersion);
      tone = 'warning';
      break;
    case 'error':
      line = status.message;
      tone = 'danger';
      break;
  }
  const checkedAt = 'checkedAt' in status ? status.checkedAt : null;

  return (
    <Panel className={styles.launcher}>
      <BrandMark height={32} />
      <div className={styles.launcherText}>
        <span className={styles.launcherName}>
          {t.updates.launcherTitle} <span className={styles.mono}>{info?.version}</span>
        </span>
        <span className={tone === 'danger' ? styles.error : styles.secondary}>{line}</span>
        <span className={styles.tertiary}>
          {checkedAt
            ? `${t.updates.lastChecked(formatRelative(checkedAt, language, t.time.justNow))} · `
            : ''}
          {t.updates.launcherHint}
        </span>
      </div>
      <div className={styles.actions}>
        {status.state === 'available' && (
          <Button
            variant="primary"
            icon={ExternalLink}
            onClick={() => void openExternal(status.releaseUrl)}
          >
            {t.updates.viewRelease}
          </Button>
        )}
        <Button icon={RefreshCw} busy={status.state === 'checking'} onClick={() => void runCheck()}>
          {t.updates.check}
        </Button>
      </div>
    </Panel>
  );
}

function statusText(
  app: AppView,
  t: Dictionary,
): { text: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' } {
  const release = app.release;
  const state = deriveAppState(app);
  if (app.operation) return { text: t.appState[state.status], tone: state.tone };
  switch (release.state) {
    case 'not-checked':
      return { text: t.appDetails.notChecked, tone: 'neutral' };
    case 'checking':
      return { text: t.appDetails.checking, tone: 'info' };
    case 'no-source':
      return { text: t.appDetails.noSource, tone: 'neutral' };
    case 'no-release':
      return { text: t.appDetails.notPublished, tone: 'neutral' };
    case 'error':
      return { text: t.appDetails.checkFailed, tone: 'danger' };
    case 'resolved':
      switch (release.resolution) {
        case 'update-available':
          return { text: t.appState.updateAvailable, tone: 'warning' };
        case 'not-installed-available':
          return { text: t.appState.available, tone: 'neutral' };
        case 'up-to-date':
          return {
            text: app.installed ? t.updates.upToDate : t.appState.notInstalled,
            tone: app.installed ? 'success' : 'neutral',
          };
        case 'requires-newer-launcher':
          return {
            text: t.appDetails.requiresLauncher(release.minLauncherVersion),
            tone: 'warning',
          };
        case 'no-compatible-artifact':
          return { text: t.appDetails.noArtifact, tone: 'warning' };
        case 'prerelease-skipped':
          return { text: t.appDetails.prereleaseOnly(release.version), tone: 'neutral' };
      }
  }
}

function UpdateRow({ app }: { app: AppView }) {
  const t = useT();
  const language = useLanguage();
  const release = app.release;
  const op = app.operation;
  const status = statusText(app, t);
  const display = deriveAppState(app);

  let action: ReactNode = null;
  if (op && (op.phase === 'downloading' || op.phase === 'verifying')) {
    action = (
      <Button size="sm" onClick={() => void cancelOperation(app)}>
        {t.common.cancel}
      </Button>
    );
  } else if (op?.phase === 'failed' && op.kind !== 'uninstall') {
    action = (
      <Button size="sm" variant="primary" onClick={() => void retryOperation(app)}>
        {t.common.retry}
      </Button>
    );
  } else if (!op && release.state === 'resolved' && release.resolution === 'update-available') {
    action = (
      <Button size="sm" variant="primary" onClick={() => void installApp(app)}>
        {t.appActions.update(release.version)}
      </Button>
    );
  } else if (
    !op &&
    release.state === 'resolved' &&
    release.resolution === 'not-installed-available'
  ) {
    action = (
      <Button size="sm" variant="primary" onClick={() => void installApp(app)}>
        {t.appActions.install}
      </Button>
    );
  } else if (release.state === 'error') {
    action = (
      <Button size="sm" icon={RefreshCw} onClick={() => void checkReleases(app.id)}>
        {t.common.retry}
      </Button>
    );
  }

  return (
    <div className={styles.item} role="group" aria-label={app.name}>
      <div className={styles.row}>
        <div className={styles.appCell}>
          <AppIcon app={app} />
          {app.name}
        </div>
        <span className={styles.mono}>{app.installed?.version ?? t.updates.notInstalled}</span>
        <span className={styles.mono}>{release.state === 'resolved' ? release.version : '—'}</span>
        <div className={styles.statusCell}>
          <StatusTag tone={status.tone}>{status.text}</StatusTag>
          {display.progress !== undefined && op && op.phase !== 'failed' && (
            <ProgressBar value={display.progress} label={status.text} />
          )}
          {op?.phase === 'downloading' && (
            <span className={styles.tertiary}>
              {t.appDetails.progress(
                formatBytes(op.receivedBytes, language),
                formatBytes(op.totalBytes, language),
              )}
            </span>
          )}
          {op?.phase === 'failed' && (
            <span className={styles.error} title={op.message}>
              {op.message}
            </span>
          )}
          {release.state === 'error' && !op && (
            <span className={styles.error} title={release.message}>
              {release.message}
            </span>
          )}
          {'checkedAt' in release && (
            <span className={styles.tertiary}>
              {t.updates.lastChecked(formatRelative(release.checkedAt, language, t.time.justNow))}
            </span>
          )}
        </div>
        <div className={styles.actionCell}>{action}</div>
      </div>
      {release.state === 'resolved' && (
        <details className={styles.notes}>
          <summary>
            {t.updates.releaseNotes} · {release.version} ·{' '}
            {formatDate(release.releasedAt, language)}
            {release.downloadSize
              ? ` · ${t.appDetails.downloadSize(formatBytes(release.downloadSize, language))}`
              : ''}
          </summary>
          <div className={styles.notesBody}>
            {release.notes.summary && <p className={styles.secondary}>{release.notes.summary}</p>}
            {release.notes.body ? (
              <pre className={styles.notesText}>{release.notes.body}</pre>
            ) : (
              !release.notes.summary && <p className={styles.tertiary}>{t.updates.noNotes}</p>
            )}
            {release.notes.url && (
              <Button
                className={styles.notesLink}
                variant="ghost"
                size="sm"
                icon={ExternalLink}
                onClick={() => void openExternal(release.notes.url!)}
              >
                {t.common.viewOnGitHub}
              </Button>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

export function UpdatesPage() {
  const t = useT();
  const apps = useAppsStore((state) => state.apps);
  const checking = useAppsStore((state) => state.checking);
  const tracked = apps.filter((app) => app.release.state !== 'no-source' || app.installed);
  const untracked = apps.length - tracked.length;

  return (
    <>
      <SectionHeader
        level="page"
        title={t.updates.title}
        description={t.updates.subtitle}
        actions={
          <Button icon={RefreshCw} busy={checking} onClick={() => void checkReleases()}>
            {t.updates.checkAll}
          </Button>
        }
      />

      <LauncherPanel />

      <section className={page.section} aria-labelledby="updates-apps">
        <SectionHeader id="updates-apps" title={t.updates.applicationsTitle} />
        {tracked.length === 0 ? (
          <EmptyState icon={RefreshCw} title={t.updates.noTrackedApps} compact />
        ) : (
          <div className={styles.table}>
            <div className={styles.headerRow} aria-hidden>
              <span>{t.updates.colApp}</span>
              <span>{t.updates.colInstalled}</span>
              <span>{t.updates.colLatest}</span>
              <span>{t.updates.colStatus}</span>
              <span />
            </div>
            {tracked.map((app) => (
              <UpdateRow key={app.id} app={app} />
            ))}
          </div>
        )}
        {untracked > 0 && <p className={page.note}>{t.updates.plannedFootnote}</p>}
      </section>
    </>
  );
}
