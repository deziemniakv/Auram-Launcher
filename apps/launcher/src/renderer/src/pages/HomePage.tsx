import { useEffect } from 'react';
import { AppWindow, FolderOpen } from 'lucide-react';
import { Button, EmptyState, SectionHeader } from '@auram/ui';
import { AppRow } from '../components/AppCard';
import { ProjectGrid } from '../components/ProjectCard';
import { useT } from '../i18n';
import { chooseAndOpenProject } from '../lib/actions';
import { hasUpdate } from '../lib/app-state';
import { useAppsStore } from '../store/apps';
import { useProjectsStore } from '../store/projects';
import { useUiStore } from '../store/ui';
import styles from './Page.module.css';

const RECENT_ON_HOME = 4;

export function HomePage() {
  const t = useT();
  const navigate = useUiStore((state) => state.navigate);
  const apps = useAppsStore((state) => state.apps);
  const projects = useProjectsStore((state) => state.snapshot);
  const loadProjects = useProjectsStore((state) => state.load);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const installed = apps.filter((app) => app.installed);
  const updates = apps.filter(hasUpdate);
  const recent = (projects?.recent ?? []).slice(0, RECENT_ON_HOME);

  return (
    <>
      <section className={styles.hero} aria-labelledby="home-title">
        <div>
          <h1 id="home-title" className={styles.heroTitle}>
            {t.home.title}
          </h1>
          <p className={styles.heroSubtitle}>{t.home.subtitle}</p>
        </div>
        <div className={styles.heroActions}>
          <Button variant="primary" icon={FolderOpen} onClick={() => void chooseAndOpenProject()}>
            {t.home.openProject}
          </Button>
        </div>
      </section>

      {updates.length > 0 && (
        <section className={styles.section} aria-labelledby="home-updates">
          <SectionHeader
            id="home-updates"
            title={t.home.updates}
            actions={
              <Button variant="ghost" size="sm" onClick={() => navigate('updates')}>
                {t.nav.updates}
              </Button>
            }
          />
          <div className={styles.list}>
            {updates.map((app) => (
              <AppRow key={app.id} app={app} action="update" />
            ))}
          </div>
        </section>
      )}

      <section className={styles.section} aria-labelledby="home-recent">
        <SectionHeader
          id="home-recent"
          title={t.home.recentProjects}
          actions={
            <Button variant="ghost" size="sm" onClick={() => navigate('projects')}>
              {t.home.viewAllProjects}
            </Button>
          }
        />
        {recent.length > 0 ? (
          <ProjectGrid projects={recent} removable={false} />
        ) : (
          <EmptyState icon={FolderOpen} title={t.home.noRecentTitle} compact>
            {t.home.noRecentBody}
          </EmptyState>
        )}
      </section>

      <section className={styles.section} aria-labelledby="home-apps">
        <SectionHeader
          id="home-apps"
          title={t.home.installedApps}
          actions={
            <Button variant="ghost" size="sm" onClick={() => navigate('applications')}>
              {t.home.viewAllApps}
            </Button>
          }
        />
        {installed.length > 0 ? (
          <div className={styles.list}>
            {installed.map((app) => (
              <AppRow key={app.id} app={app} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={AppWindow}
            title={t.home.noAppsTitle}
            compact
            actions={<Button onClick={() => navigate('applications')}>{t.home.browseApps}</Button>}
          >
            {t.home.noAppsBody}
          </EmptyState>
        )}
      </section>
    </>
  );
}
