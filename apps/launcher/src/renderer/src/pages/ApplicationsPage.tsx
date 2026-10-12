import { FolderOpen, RefreshCw } from 'lucide-react';
import { Button, LoadingState, SectionHeader } from '@auram/ui';
import { AppCard } from '../components/AppCard';
import { useT } from '../i18n';
import { checkReleases, openFolder } from '../lib/actions';
import { useAppsStore } from '../store/apps';
import styles from './Page.module.css';

export function ApplicationsPage() {
  const t = useT();
  const apps = useAppsStore((state) => state.apps);
  const loaded = useAppsStore((state) => state.loaded);
  const checking = useAppsStore((state) => state.checking);

  return (
    <>
      <SectionHeader
        level="page"
        title={t.applications.title}
        description={t.applications.subtitle}
        actions={
          <>
            <Button variant="ghost" icon={FolderOpen} onClick={() => void openFolder('apps')}>
              {t.applications.openAppsFolder}
            </Button>
            <Button icon={RefreshCw} busy={checking} onClick={() => void checkReleases()}>
              {t.applications.checkReleases}
            </Button>
          </>
        }
      />
      {loaded ? (
        <div className={styles.appGrid}>
          {apps.map((app) => (
            <AppCard key={app.id} app={app} />
          ))}
        </div>
      ) : (
        <LoadingState label={t.common.loading} />
      )}
    </>
  );
}
