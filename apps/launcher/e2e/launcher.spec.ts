import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import packageJson from '../package.json';
import { createSandbox, installFakePhoto, launch, writeProject, type Sandbox } from './fixtures';

/** Clicks a sidebar entry. */
const go = (window: Page, label: string) =>
  window.getByRole('navigation').getByRole('button', { name: label, exact: true }).click();

const launcherVersion = packageJson.version;

let sandbox: Sandbox;

test.beforeEach(async () => {
  sandbox = await createSandbox();
});

test.afterEach(async () => {
  await sandbox.cleanup();
});

test('starts on Home and navigates every section', async () => {
  const { app, window } = await launch(sandbox);
  try {
    await expect(window.getByRole('heading', { name: 'Welcome to Auram' })).toBeVisible();
    const nav = window.getByRole('navigation', { name: 'Main navigation' });

    await nav.getByRole('button', { name: 'Applications' }).click();
    await expect(window.getByRole('heading', { name: 'Applications', level: 1 })).toBeVisible();
    await expect(window.getByRole('heading', { name: 'Auram Photo' })).toBeVisible();
    // No release check has run: nothing may be presented as installable.
    await expect(window.getByRole('button', { name: 'Install' })).toHaveCount(0);

    await nav.getByRole('button', { name: 'Projects' }).click();
    await expect(window.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
    await expect(window.getByText('The projects folder does not exist yet')).toBeVisible();

    await nav.getByRole('button', { name: 'Updates' }).click();
    await expect(window.getByRole('heading', { name: 'Updates', level: 1 })).toBeVisible();

    await nav.getByRole('button', { name: 'Settings' }).click();
    await expect(window.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    await expect(window.getByText(launcherVersion).first()).toBeVisible();
  } finally {
    await app.close();
  }
});

test('keeps the renderer isolated from Node.js', async () => {
  const { app, window } = await launch(sandbox);
  try {
    const globals = await window.evaluate(() => ({
      require: typeof (globalThis as { require?: unknown }).require,
      process: typeof (globalThis as { process?: unknown }).process,
      bridge: Object.keys((window as unknown as { auram: object }).auram).sort(),
    }));
    expect(globals.require).toBe('undefined');
    expect(globals.process).toBe('undefined');
    expect(globals.bridge).toEqual(['apps', 'launcher', 'projects', 'settings', 'system']);

    // The main process validates every call.
    const rejected = await window.evaluate(() =>
      (
        window as unknown as { auram: { apps: { launch: (id: unknown) => Promise<unknown> } } }
      ).auram.apps.launch('../../etc'),
    );
    expect(rejected).toMatchObject({ ok: false, error: { code: 'invalid-input' } });

    const blocked = await window.evaluate(() =>
      (
        window as unknown as {
          auram: { system: { openExternal: (u: string) => Promise<unknown> } };
        }
      ).auram.system.openExternal('file:///etc/passwd'),
    );
    expect(blocked).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  } finally {
    await app.close();
  }
});

test('persists settings across restarts', async () => {
  let { app, window } = await launch(sandbox);
  try {
    await go(window, 'Settings');
    await window.getByLabel('Interface language').selectOption('pl');
    await expect(window.getByRole('heading', { name: 'Ustawienia', level: 1 })).toBeVisible();
    await window.getByRole('switch', { name: 'Uwzględniaj wersje testowe' }).check();
    await window.getByLabel('Strona startowa').selectOption('projects');
  } finally {
    await app.close();
  }

  const saved = JSON.parse(
    await readFile(path.join(sandbox.dataDir, 'Launcher', 'settings.json'), 'utf8'),
  );
  expect(saved).toMatchObject({
    language: 'pl',
    updates: { includePrerelease: true },
    startup: { startSection: 'projects' },
  });

  ({ app, window } = await launch(sandbox));
  try {
    // Restarts on the chosen start page, in Polish.
    await expect(window.getByRole('heading', { name: 'Projekty', level: 1 })).toBeVisible();
    await go(window, 'Ustawienia');
    await expect(window.getByRole('switch', { name: 'Uwzględniaj wersje testowe' })).toBeChecked();
  } finally {
    await app.close();
  }
});

test('discovers projects from their own metadata', async () => {
  await writeProject(sandbox.projectsDir, 'poster.cproj', 'Festival Poster');
  const { app, window } = await launch(sandbox);
  try {
    await go(window, 'Projects');
    const card = window.getByRole('article', { name: 'Festival Poster' });
    await expect(card).toBeVisible();
    await expect(card.getByText('Auram Photo project')).toBeVisible();
    // Auram Photo is not installed, so opening must fail visibly rather than silently.
    await card.getByRole('button', { name: 'Open' }).click();
    await expect(
      window.getByText('Auram Photo is required to open this project and is not installed.'),
    ).toBeVisible();
  } finally {
    await app.close();
  }
});

test('launches an installed application and opens projects with it', async () => {
  test.skip(process.platform === 'win32', 'Uses a shell script as the stand-in application');
  const marker = path.join(sandbox.root, 'launched.txt');
  await installFakePhoto(sandbox.appsDir, marker);
  const project = await writeProject(sandbox.projectsDir, 'poster.cproj', 'Festival Poster');

  const { app, window } = await launch(sandbox);
  try {
    await go(window, 'Applications');
    const card = window.getByRole('article', { name: 'Auram Photo' });
    await expect(card.getByText('Manual installation')).toBeVisible();
    await expect(card.getByText('0.0.1')).toBeVisible();
    await card.getByRole('button', { name: 'Open' }).click();
    await expect.poll(() => readFile(marker, 'utf8').catch(() => '')).toBe('started\n');

    await go(window, 'Projects');
    await window
      .getByRole('article', { name: 'Festival Poster' })
      .first()
      .getByRole('button', { name: 'Open' })
      .click();
    await expect.poll(() => readFile(marker, 'utf8').catch(() => '')).toBe(`started\n${project}\n`);

    // Opening a project adds it to the recent list.
    await go(window, 'Home');
    await expect(window.getByRole('article', { name: 'Festival Poster' })).toBeVisible();
  } finally {
    await app.close();
  }
});
