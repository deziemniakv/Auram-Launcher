import { useEffect } from 'react';
import { FolderOpen, FolderPlus, History, Plus, RefreshCw } from 'lucide-react';
import { Button, EmptyState, ErrorState, LoadingState, SectionHeader } from '@auram/ui';
import { ProjectGrid } from '../components/ProjectCard';
import { useT } from '../i18n';
import { addExistingProjects, openFolder } from '../lib/actions';
import { useProjectsStore } from '../store/projects';
import styles from './Page.module.css';

export function ProjectsPage() {
  const t = useT();
  const snapshot = useProjectsStore((state) => state.snapshot);
  const loading = useProjectsStore((state) => state.loading);
  const error = useProjectsStore((state) => state.error);
  const load = useProjectsStore((state) => state.load);

  useEffect(() => {
    void load();
  }, [load]);

  const reloadAfterFolderOpen = async () => {
    await openFolder('projects');
    await load();
  };

  return (
    <>
      <SectionHeader
        level="page"
        title={t.projects.title}
        description={t.projects.subtitle}
        actions={
          <>
            <Button variant="ghost" icon={RefreshCw} busy={loading} onClick={() => void load()}>
              {t.common.refresh}
            </Button>
            <Button icon={Plus} onClick={() => void addExistingProjects()}>
              {t.projects.add}
            </Button>
          </>
        }
      />

      {error && !snapshot && (
        <ErrorState
          title={t.projects.loadError}
          actions={<Button onClick={() => void load()}>{t.common.retry}</Button>}
        >
          {error}
        </ErrorState>
      )}
      {!snapshot && !error && <LoadingState label={t.common.loading} />}

      {snapshot && (
        <>
          <section className={styles.section} aria-labelledby="projects-recent">
            <SectionHeader id="projects-recent" title={t.projects.recent} />
            {snapshot.recent.length > 0 ? (
              <ProjectGrid projects={snapshot.recent} removable />
            ) : (
              <EmptyState icon={History} title={t.projects.noRecentTitle} compact>
                {t.projects.noRecentBody}
              </EmptyState>
            )}
          </section>

          <section className={styles.section} aria-labelledby="projects-folder">
            <SectionHeader
              id="projects-folder"
              title={t.projects.inFolder}
              description={<span className={styles.mono}>{snapshot.directory.path}</span>}
              actions={
                snapshot.directory.exists && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={FolderOpen}
                    onClick={() => void openFolder('projects')}
                  >
                    {t.projects.openFolder}
                  </Button>
                )
              }
            />
            {snapshot.directory.error ? (
              <ErrorState title={t.projects.folderError} compact>
                {snapshot.directory.error}
              </ErrorState>
            ) : !snapshot.directory.exists ? (
              <EmptyState
                icon={FolderPlus}
                title={t.projects.folderMissingTitle}
                compact
                actions={
                  <Button onClick={() => void reloadAfterFolderOpen()}>
                    {t.projects.createFolder}
                  </Button>
                }
              >
                {t.projects.folderMissingBody(snapshot.directory.path)}
              </EmptyState>
            ) : snapshot.directory.projects.length === 0 ? (
              <EmptyState icon={FolderOpen} title={t.projects.folderEmptyTitle} compact>
                {t.projects.folderEmptyBody}
              </EmptyState>
            ) : (
              <>
                <ProjectGrid projects={snapshot.directory.projects} removable={false} />
                {snapshot.directory.truncated && (
                  <p className={styles.note}>
                    {t.projects.truncated(snapshot.directory.projects.length)}
                  </p>
                )}
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}
