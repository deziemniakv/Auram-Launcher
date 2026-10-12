import { useState, type ReactNode } from 'react';
import { ExternalLink, FileText, FolderOpen } from 'lucide-react';
import {
  Button,
  Dialog,
  ErrorState,
  Field,
  SectionHeader,
  Select,
  Switch,
  TextInput,
} from '@auram/ui';
import type { DirectoryKind, FolderKind } from '../../../shared/ipc';
import {
  INTERFACE_SCALES,
  LOG_LEVELS,
  START_SECTIONS,
  type InterfaceScale,
  type Language,
  type LogLevel,
} from '../../../shared/constants';
import type { SettingsPatch } from '../../../shared/settings';
import { BrandMark } from '../components/BrandMark';
import licenses from '../generated/licenses.json';
import { useT } from '../i18n';
import { openExternal, openFolder } from '../lib/actions';
import { messageOf } from '../lib/api';
import { useSettingsStore } from '../store/settings';
import { toast } from '../store/ui';
import styles from './SettingsPage.module.css';

function Group({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <section className={styles.group} aria-labelledby={id}>
      <h2 id={id} className={styles.groupTitle}>
        {title}
      </h2>
      <div className={styles.groupBody}>{children}</div>
    </section>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className={styles.row}>{children}</div>;
}

export function SettingsPage() {
  const t = useT();
  const info = useSettingsStore((state) => state.info);
  const snapshot = useSettingsStore((state) => state.snapshot);
  const updateSettings = useSettingsStore((state) => state.update);
  const chooseDirectory = useSettingsStore((state) => state.chooseDirectory);
  const resetDirectory = useSettingsStore((state) => state.resetDirectory);
  const [licensesOpen, setLicensesOpen] = useState(false);

  if (!snapshot || !info) return null;
  const { settings } = snapshot;

  const update = (patch: SettingsPatch) =>
    updateSettings(patch).catch((error: unknown) =>
      toast({ tone: 'error', title: t.settings.saveFailed, body: messageOf(error) }),
    );

  const pathRow = (kind: DirectoryKind, label: string, hint: string, folder: FolderKind) => {
    const isDefault = settings.directories[kind] === null;
    return (
      <Row>
        <Field label={label} description={hint}>
          {({ controlId, describedBy }) => (
            <div className={styles.pathControl}>
              <TextInput
                id={controlId}
                aria-describedby={describedBy}
                readOnly
                value={`${snapshot.resolved[kind]}${isDefault ? ` ${t.settings.defaultSuffix}` : ''}`}
              />
              <div className={styles.pathButtons}>
                <Button
                  onClick={() =>
                    void chooseDirectory(kind).catch((error: unknown) =>
                      toast({
                        tone: 'error',
                        title: t.settings.saveFailed,
                        body: messageOf(error),
                      }),
                    )
                  }
                >
                  {t.common.change}
                </Button>
                <Button
                  variant="ghost"
                  disabled={isDefault}
                  onClick={() => void resetDirectory(kind)}
                >
                  {t.common.reset}
                </Button>
                <Button variant="ghost" icon={FolderOpen} onClick={() => void openFolder(folder)}>
                  {t.common.openFolder}
                </Button>
              </div>
            </div>
          )}
        </Field>
      </Row>
    );
  };

  const openAtLoginNote = !info.supportsOpenAtLogin
    ? t.settings.openAtLoginUnsupported
    : !info.isPackaged
      ? t.settings.openAtLoginDev
      : undefined;

  return (
    <>
      <SectionHeader level="page" title={t.settings.title} description={t.settings.subtitle} />

      {snapshot.warnings.length > 0 && (
        <ErrorState title={t.settings.warningsTitle} compact>
          {snapshot.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </ErrorState>
      )}

      <div className={styles.layout}>
        <Group title={t.settings.appearance} id="settings-appearance">
          <Row>
            <Field
              label={t.settings.interfaceScale}
              description={t.settings.interfaceScaleHint}
              className={styles.narrow}
            >
              {({ controlId, describedBy }) => (
                <Select<`${InterfaceScale}`>
                  id={controlId}
                  aria-describedby={describedBy}
                  value={`${settings.appearance.interfaceScale}`}
                  options={INTERFACE_SCALES.map((scale) => ({
                    value: `${scale}`,
                    label: `${scale}%`,
                  }))}
                  onChange={(value) =>
                    void update({ appearance: { interfaceScale: Number(value) as InterfaceScale } })
                  }
                />
              )}
            </Field>
          </Row>
          <Row>
            <Switch
              label={t.settings.reduceMotion}
              description={t.settings.reduceMotionHint}
              checked={settings.appearance.reduceMotion}
              onChange={(reduceMotion) => void update({ appearance: { reduceMotion } })}
            />
          </Row>
        </Group>

        <Group title={t.settings.language} id="settings-language">
          <Row>
            <Field label={t.settings.languageLabel} className={styles.narrow}>
              {({ controlId }) => (
                <Select<Language>
                  id={controlId}
                  value={settings.language}
                  options={[
                    { value: 'en', label: 'English' },
                    { value: 'pl', label: 'Polski' },
                  ]}
                  onChange={(language) => void update({ language })}
                />
              )}
            </Field>
          </Row>
        </Group>

        <Group title={t.settings.storage} id="settings-storage">
          {pathRow('projects', t.settings.projectsDir, t.settings.projectsDirHint, 'projects')}
          {pathRow('apps', t.settings.appsDir, t.settings.appsDirHint, 'apps')}
          <Row>
            <Field label={t.settings.dataDir} description={t.settings.dataDirHint}>
              {({ controlId, describedBy }) => (
                <div className={styles.pathControl}>
                  <TextInput
                    id={controlId}
                    aria-describedby={describedBy}
                    readOnly
                    value={info.paths.dataRoot}
                  />
                  <Button variant="ghost" icon={FolderOpen} onClick={() => void openFolder('data')}>
                    {t.common.openFolder}
                  </Button>
                </div>
              )}
            </Field>
          </Row>
        </Group>

        <Group title={t.settings.startup} id="settings-startup">
          <Row>
            <Switch
              label={t.settings.openAtLogin}
              description={openAtLoginNote}
              disabled={!info.supportsOpenAtLogin || !info.isPackaged}
              checked={settings.startup.openAtLogin}
              onChange={(openAtLogin) => void update({ startup: { openAtLogin } })}
            />
          </Row>
          <Row>
            <Field label={t.settings.startSection} className={styles.narrow}>
              {({ controlId }) => (
                <Select<(typeof START_SECTIONS)[number]>
                  id={controlId}
                  value={settings.startup.startSection}
                  options={START_SECTIONS.map((section) => ({
                    value: section,
                    label: t.nav[section],
                  }))}
                  onChange={(startSection) => void update({ startup: { startSection } })}
                />
              )}
            </Field>
          </Row>
        </Group>

        <Group title={t.settings.updates} id="settings-updates">
          <Row>
            <Switch
              label={t.settings.checkOnStartup}
              description={t.settings.checkOnStartupHint}
              checked={settings.updates.checkOnStartup}
              onChange={(checkOnStartup) => void update({ updates: { checkOnStartup } })}
            />
          </Row>
          <Row>
            <Switch
              label={t.settings.includePrerelease}
              description={t.settings.includePrereleaseHint}
              checked={settings.updates.includePrerelease}
              onChange={(includePrerelease) => void update({ updates: { includePrerelease } })}
            />
          </Row>
        </Group>

        <Group title={t.settings.diagnostics} id="settings-diagnostics">
          <Row>
            <Field
              label={t.settings.logLevel}
              description={t.settings.logLevelHint}
              className={styles.narrow}
            >
              {({ controlId, describedBy }) => (
                <Select<LogLevel>
                  id={controlId}
                  aria-describedby={describedBy}
                  value={settings.diagnostics.logLevel}
                  options={LOG_LEVELS.map((level) => ({
                    value: level,
                    label: t.settings.logLevels[level],
                  }))}
                  onChange={(logLevel) => void update({ diagnostics: { logLevel } })}
                />
              )}
            </Field>
            <div className={styles.buttons}>
              <Button icon={FolderOpen} onClick={() => void openFolder('logs')}>
                {t.settings.openLogs}
              </Button>
            </div>
          </Row>
        </Group>

        <Group title={t.settings.about} id="settings-about">
          <Row>
            <div className={styles.aboutHead}>
              <BrandMark height={48} decorative={false} />
              <div>
                <p className={styles.aboutName}>{info.name}</p>
                <p className={styles.hint}>
                  {info.version}
                  {!info.isPackaged && ` · ${t.settings.developmentBuild}`}
                </p>
              </div>
            </div>
            <dl className={styles.facts}>
              <dt>{t.settings.version}</dt>
              <dd>{info.version}</dd>
              <dt>{t.settings.runtime}</dt>
              <dd>
                Electron {info.versions.electron} · Chromium {info.versions.chrome} · Node.js{' '}
                {info.versions.node} · {info.platform}-{info.arch}
              </dd>
              <dt>{t.settings.license}</dt>
              <dd>{t.settings.licenseValue}</dd>
            </dl>
            <div className={styles.buttons}>
              <Button icon={ExternalLink} onClick={() => void openExternal(info.repositoryUrl)}>
                {t.settings.sourceCode}
              </Button>
              <Button icon={FileText} onClick={() => setLicensesOpen(true)}>
                {t.settings.openSourceLicenses}
              </Button>
            </div>
          </Row>
        </Group>
      </div>

      <Dialog
        open={licensesOpen}
        title={t.settings.licensesTitle}
        onClose={() => setLicensesOpen(false)}
        closeLabel={t.common.close}
        footer={<Button onClick={() => setLicensesOpen(false)}>{t.common.close}</Button>}
      >
        <p>{t.settings.licensesIntro}</p>
        <ul className={styles.licenseList}>
          {licenses.map((pkg) => (
            <li key={`${pkg.name}@${pkg.version}`} className={styles.licenseItem}>
              <span className={styles.licenseName}>
                {pkg.name} <span className={styles.licenseValue}>{pkg.version}</span>
              </span>
              <span className={styles.licenseValue}>{pkg.license}</span>
            </li>
          ))}
        </ul>
        <p className={`${styles.hint} ${styles.footnote}`}>{t.settings.licensesChromium}</p>
      </Dialog>
    </>
  );
}
