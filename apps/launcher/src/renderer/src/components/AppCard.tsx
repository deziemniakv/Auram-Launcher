import { useState } from 'react';
import { Box, Clapperboard, Image, Sparkles, Trash2, type LucideIcon } from 'lucide-react';
import type { AppCategory } from '@auram/app-manifest';
import { Button, Dialog, IconButton, ProgressBar, StatusTag, cx } from '@auram/ui';
import type { AppView } from '../../../shared/ipc';
import { useLanguage, useT, type Dictionary } from '../i18n';
import {
  cancelOperation,
  dismissAppError,
  installApp,
  launchApp,
  retryOperation,
  uninstallApp,
} from '../lib/actions';
import { deriveAppState, hasUpdate, type PrimaryAction } from '../lib/app-state';
import { formatBytes } from '../lib/format';
import styles from './AppCard.module.css';

const CATEGORY_ICONS: Record<AppCategory, LucideIcon> = {
  photo: Image,
  video: Clapperboard,
  motion: Sparkles,
  '3d': Box,
};

export function AppIcon({ app }: { app: AppView }) {
  const Icon = CATEGORY_ICONS[app.category];
  return (
    <div className={cx(styles.icon, !app.installed && styles.dim)} aria-hidden>
      <Icon strokeWidth={1.5} />
    </div>
  );
}

function PrimaryButton({
  app,
  action,
  t,
  busyLabel,
  size = 'md',
}: {
  app: AppView;
  action: PrimaryAction;
  t: Dictionary;
  busyLabel: string;
  size?: 'sm' | 'md';
}) {
  switch (action.kind) {
    case 'open':
      return (
        <Button variant="primary" size={size} onClick={() => void launchApp(app)}>
          {t.appActions.open}
        </Button>
      );
    case 'install':
      return (
        <Button variant="primary" size={size} onClick={() => void installApp(app)}>
          {t.appActions.install}
        </Button>
      );
    case 'update':
      return (
        <Button variant="primary" size={size} onClick={() => void installApp(app)}>
          {t.appActions.update(action.version)}
        </Button>
      );
    case 'cancel':
      return (
        <Button size={size} onClick={() => void cancelOperation(app)}>
          {t.appActions.cancel}
        </Button>
      );
    case 'retry':
      return (
        <Button variant="primary" size={size} onClick={() => void retryOperation(app)}>
          {t.appActions.retry}
        </Button>
      );
    case 'busy':
      return (
        <Button size={size} busy>
          {busyLabel}
        </Button>
      );
    case 'unavailable':
      return (
        <Button size={size} disabled>
          {t.appActions.unavailable}
        </Button>
      );
  }
}

function ReleaseValue({ app, t }: { app: AppView; t: Dictionary }) {
  const release = app.release;
  switch (release.state) {
    case 'no-source':
      return <>{t.appDetails.noSource}</>;
    case 'not-checked':
      return <>{t.appDetails.notChecked}</>;
    case 'checking':
      return <>{t.appDetails.checking}</>;
    case 'no-release':
      return <>{t.appDetails.notPublished}</>;
    case 'error':
      return (
        <span className={styles.error} title={release.message}>
          {t.appDetails.checkFailed}
        </span>
      );
    case 'resolved':
      return <span className={styles.mono}>{release.version}</span>;
  }
}

/** The version an installed app can be updated to, when an update is actionable now. */
function updateVersion(app: AppView): string | null {
  return hasUpdate(app) && app.release.state === 'resolved' && !app.operation
    ? app.release.version
    : null;
}

function releaseNote(app: AppView, t: Dictionary): string | null {
  const release = app.release;
  if (release.state !== 'resolved') return null;
  switch (release.resolution) {
    case 'requires-newer-launcher':
      return t.appDetails.requiresLauncher(release.minLauncherVersion);
    case 'no-compatible-artifact':
      return t.appDetails.noArtifact;
    case 'prerelease-skipped':
      return t.appDetails.prereleaseOnly(release.version);
    default:
      return null;
  }
}

export function AppCard({ app }: { app: AppView }) {
  const t = useT();
  const language = useLanguage();
  const state = deriveAppState(app);
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const op = app.operation;
  const note = releaseNote(app, t);
  const canUninstall = app.installed !== null && (!op || op.phase === 'failed') && !app.running;
  const update = updateVersion(app);

  return (
    <article className={styles.card} aria-labelledby={`app-${app.id}`}>
      <div className={styles.head}>
        <AppIcon app={app} />
        <div className={styles.titleGroup}>
          <h3 id={`app-${app.id}`} className={styles.name}>
            {app.name}
          </h3>
          <span className={styles.category}>{t.categories[app.category]}</span>
        </div>
        <StatusTag tone={state.tone}>{t.appState[state.status]}</StatusTag>
      </div>

      <p className={styles.description}>
        {app.descriptionTranslations[language] ?? app.description}
      </p>

      <dl className={styles.meta}>
        <div>
          <dt>{t.appDetails.installedVersion}</dt>
          <dd className={app.installed ? styles.mono : undefined}>
            {app.installed ? app.installed.version : t.appState.notInstalled}
          </dd>
        </div>
        <div>
          <dt>{t.appDetails.latestVersion}</dt>
          <dd>
            <ReleaseValue app={app} t={t} />
          </dd>
        </div>
        {app.installed?.source === 'manual' && (
          <div className={styles.wide}>
            <dd>{t.appDetails.manualInstall}</dd>
          </div>
        )}
        {app.installed?.problem && (
          <div className={styles.wide}>
            <dd className={styles.problem}>{app.installed.problem}</dd>
          </div>
        )}
        {note && (
          <div className={styles.wide}>
            <dd className={styles.problem}>{note}</dd>
          </div>
        )}
        {state.progress !== undefined && op && op.phase !== 'failed' && (
          <div className={styles.progress}>
            <ProgressBar value={state.progress} label={t.appState[state.status]} />
            {op.phase === 'downloading' && (
              <span>
                {t.appDetails.progress(
                  formatBytes(op.receivedBytes, language),
                  formatBytes(op.totalBytes, language),
                )}
              </span>
            )}
          </div>
        )}
        {op?.phase === 'failed' && (
          <div className={styles.wide}>
            <dd className={styles.error}>{op.message}</dd>
          </div>
        )}
      </dl>

      <div className={styles.actions}>
        <PrimaryButton
          app={app}
          action={state.primary}
          t={t}
          busyLabel={t.appState[state.status]}
        />
        {update && state.primary.kind === 'open' && (
          <Button onClick={() => void installApp(app)}>{t.appActions.update(update)}</Button>
        )}
        {op?.phase === 'failed' && (
          <Button variant="ghost" onClick={() => void dismissAppError(app)}>
            {t.common.dismiss}
          </Button>
        )}
        <span className={styles.spacer} />
        {canUninstall && (
          <IconButton
            icon={Trash2}
            label={t.appActions.uninstall}
            onClick={() => setConfirmUninstall(true)}
          />
        )}
      </div>

      <Dialog
        open={confirmUninstall}
        title={t.uninstall.title(app.name)}
        onClose={() => setConfirmUninstall(false)}
        closeLabel={t.common.close}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmUninstall(false)}>
              {t.common.cancel}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmUninstall(false);
                void uninstallApp(app);
              }}
            >
              {t.uninstall.confirm}
            </Button>
          </>
        }
      >
        {t.uninstall.body}
      </Dialog>
    </article>
  );
}

/** Compact single-line variant for overviews. `update` shows the update action instead of Open. */
export function AppRow({
  app,
  action = 'default',
}: {
  app: AppView;
  action?: 'default' | 'update';
}) {
  const t = useT();
  const state = deriveAppState(app);
  const update = updateVersion(app);
  return (
    <div className={styles.row}>
      <AppIcon app={app} />
      <div className={styles.rowText}>
        <span className={styles.name}>{app.name}</span>
        <span className={styles.rowMeta}>
          {app.installed ? (
            <span className={styles.mono}>{app.installed.version}</span>
          ) : (
            t.appState.notInstalled
          )}
        </span>
      </div>
      <StatusTag tone={state.tone}>{t.appState[state.status]}</StatusTag>
      {action === 'update' && update ? (
        <Button variant="primary" size="sm" onClick={() => void installApp(app)}>
          {t.appActions.update(update)}
        </Button>
      ) : (
        <PrimaryButton
          app={app}
          action={state.primary}
          t={t}
          busyLabel={t.appState[state.status]}
          size="sm"
        />
      )}
    </div>
  );
}
