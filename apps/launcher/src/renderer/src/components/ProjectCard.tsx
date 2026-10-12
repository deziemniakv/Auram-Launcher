import { FileImage, FileWarning, FolderSearch, X } from 'lucide-react';
import { Button, IconButton } from '@auram/ui';
import type { ProjectView } from '../../../shared/ipc';
import { useLanguage, useT } from '../i18n';
import { openProject, removeRecentProject, revealProject } from '../lib/actions';
import { formatRelative } from '../lib/format';
import { useAppsStore } from '../store/apps';
import styles from './ProjectCard.module.css';

export function ProjectCard({ project, removable }: { project: ProjectView; removable: boolean }) {
  const t = useT();
  const language = useLanguage();
  const appName = useAppsStore(
    (state) => state.apps.find((app) => app.id === project.appId)?.name ?? null,
  );
  const title = project.name ?? project.fileName;
  const modified = project.modifiedAt ?? project.fileModifiedAt;
  const ok = project.status === 'ok';

  return (
    <article className={styles.card} aria-label={title}>
      <div className={styles.thumb}>
        {project.thumbnail ? (
          <img src={project.thumbnail} alt="" draggable={false} />
        ) : (
          <div className={styles.placeholder}>
            {ok ? (
              <FileImage aria-hidden strokeWidth={1.25} />
            ) : (
              <FileWarning aria-hidden strokeWidth={1.25} />
            )}
            <span>{t.projects.noThumbnail}</span>
          </div>
        )}
      </div>
      <div className={styles.body}>
        <h3 className={styles.name} title={project.path}>
          {title}
        </h3>
        {ok ? (
          <span className={styles.line}>
            {appName ? t.projects.projectOf(appName) : t.projects.unknownType}
          </span>
        ) : (
          <span className={styles.problem} title={project.problem ?? undefined}>
            {project.status === 'missing' ? t.projects.missing : t.projects.invalid}
          </span>
        )}
        {modified && (
          <span className={styles.line}>
            {t.projects.modified(formatRelative(modified, language, t.time.justNow))}
          </span>
        )}
      </div>
      <div className={styles.actions}>
        <Button
          variant="primary"
          size="sm"
          disabled={!ok}
          onClick={() => void openProject(project.path)}
        >
          {t.projects.openProject}
        </Button>
        <span className={styles.spacer} />
        {project.status !== 'missing' && (
          <IconButton
            icon={FolderSearch}
            size="sm"
            label={t.projects.reveal}
            onClick={() => void revealProject(project.path)}
          />
        )}
        {removable && (
          <IconButton
            icon={X}
            size="sm"
            label={t.projects.removeRecent}
            onClick={() => void removeRecentProject(project.path)}
          />
        )}
      </div>
    </article>
  );
}

export function ProjectGrid({
  projects,
  removable,
}: {
  projects: ProjectView[];
  removable: boolean;
}) {
  return (
    <ul className={styles.grid}>
      {projects.map((project) => (
        <li key={project.path}>
          <ProjectCard project={project} removable={removable} />
        </li>
      ))}
    </ul>
  );
}
