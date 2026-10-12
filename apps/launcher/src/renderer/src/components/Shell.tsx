import type { ReactNode } from 'react';
import { AppWindow, FolderOpen, Home, RefreshCw, Settings } from 'lucide-react';
import { NavItem, ProgressBar } from '@auram/ui';
import type { Section } from '../../../shared/constants';
import { hasUpdate } from '../lib/app-state';
import { formatBytes } from '../lib/format';
import { useAppsStore } from '../store/apps';
import { useSettingsStore } from '../store/settings';
import { useUiStore } from '../store/ui';
import { useLanguage, useT } from '../i18n';
import { BrandMark, Wordmark } from './BrandMark';
import styles from './Shell.module.css';

const NAV: Array<{ section: Section; icon: typeof Home }> = [
  { section: 'home', icon: Home },
  { section: 'applications', icon: AppWindow },
  { section: 'projects', icon: FolderOpen },
  { section: 'updates', icon: RefreshCw },
];

function Activity() {
  const t = useT();
  const language = useLanguage();
  const active = useAppsStore((state) =>
    state.apps.find((app) => app.operation && app.operation.phase !== 'failed'),
  );
  const op = active?.operation;
  if (!active || !op || op.phase === 'failed') return null;
  let label: string;
  let value: number | null = null;
  if (op.phase === 'downloading') {
    value = op.totalBytes > 0 ? op.receivedBytes / op.totalBytes : null;
    label = `${active.name} · ${t.appDetails.progress(formatBytes(op.receivedBytes, language), formatBytes(op.totalBytes, language))}`;
  } else {
    const phaseLabel = {
      verifying: t.appState.verifying,
      installing: t.appState.installing,
      uninstalling: t.appState.uninstalling,
    }[op.phase];
    label = `${active.name} · ${phaseLabel}`;
  }
  return (
    <div className={styles.activity} role="status">
      <span className={styles.activityText}>{label}</span>
      <div className={styles.activityBar}>
        <ProgressBar value={value} label={label} />
      </div>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const t = useT();
  const section = useUiStore((state) => state.section);
  const navigate = useUiStore((state) => state.navigate);
  const updates = useAppsStore((state) => state.apps.filter(hasUpdate).length);
  const version = useSettingsStore((state) => state.info?.version);

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#content">
        {t.nav.skipToContent}
      </a>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <BrandMark height={22} />
          <Wordmark />
        </div>
        <div className={styles.topbarMain}>
          <Activity />
        </div>
      </header>

      <nav className={styles.sidebar} aria-label={t.nav.label}>
        <div className={styles.navGroup}>
          {NAV.map(({ section: target, icon }) => (
            <NavItem
              key={target}
              icon={icon}
              label={t.nav[target]}
              active={section === target}
              onSelect={() => navigate(target)}
              badge={target === 'updates' ? updates : undefined}
              badgeLabel={target === 'updates' ? t.nav.updatesBadge(updates) : undefined}
            />
          ))}
        </div>
        <div className={`${styles.navGroup} ${styles.navBottom}`}>
          <NavItem
            icon={Settings}
            label={t.nav.settings}
            active={section === 'settings'}
            onSelect={() => navigate('settings')}
          />
        </div>
        {version && <div className={styles.sidebarFooter}>{t.nav.launcherVersion(version)}</div>}
      </nav>

      <main id="content" className={styles.main} tabIndex={-1}>
        <div className={styles.content}>{children}</div>
      </main>
    </div>
  );
}
