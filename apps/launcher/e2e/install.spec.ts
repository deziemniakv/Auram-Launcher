import { expect, test, type Page } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createSandbox, launch, photoPackage, serveFakeRelease, type Sandbox } from './fixtures';

let sandbox: Sandbox;

test.beforeEach(async () => {
  test.skip(process.platform === 'win32', 'Uses a shell script as the stand-in application');
  sandbox = await createSandbox();
});

test.afterEach(async () => {
  await sandbox?.cleanup();
});

const go = (window: Page, label: string) =>
  window.getByRole('navigation').getByRole('button', { name: label, exact: true }).click();

test('installs a verified release and launches it', async () => {
  const marker = path.join(sandbox.root, 'launched.txt');
  const { app, window } = await launch(sandbox);
  try {
    await serveFakeRelease(app, { version: '1.0.0', zip: await photoPackage('1.0.0', marker) });
    await go(window, 'Applications');
    const card = window.getByRole('article', { name: 'Auram Photo' });
    await expect(card.getByRole('button', { name: 'Unavailable' })).toBeDisabled();

    await window.getByRole('button', { name: 'Check for releases' }).click();
    await expect(card.getByText('Available', { exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Install' }).click();

    await expect(window.getByText('Auram Photo 1.0.0 installed')).toBeVisible();
    await expect(card.getByText('Manual installation')).toHaveCount(0);
    await card.getByRole('button', { name: 'Open' }).click();
    await expect.poll(() => readFile(marker, 'utf8').catch(() => '')).toBe('1.0.0\n');

    const current = JSON.parse(
      await readFile(path.join(sandbox.appsDir, 'auram.photo', 'current.json'), 'utf8'),
    );
    expect(current).toMatchObject({ id: 'auram.photo', version: '1.0.0', source: 'release' });

    // The Updates page reports the installed version as current, with release notes.
    await go(window, 'Updates');
    await expect(window.getByText('Up to date')).toBeVisible();
    await window.getByText(/Release notes · 1\.0\.0/).click();
    await expect(window.getByText('Second line', { exact: false })).toBeVisible();

    // Uninstalling removes the files, including resources/app.asar.
    await go(window, 'Applications');
    await card.getByRole('button', { name: 'Uninstall…' }).click();
    await window.getByRole('dialog').getByRole('button', { name: 'Uninstall' }).click();
    await expect(window.getByText('Auram Photo uninstalled')).toBeVisible();
    expect(await readdir(sandbox.appsDir)).toEqual([]);
  } finally {
    await app.close();
  }
});

test('shows a verification failure and installs nothing', async () => {
  const { app, window } = await launch(sandbox);
  try {
    await serveFakeRelease(app, {
      version: '1.0.0',
      zip: await photoPackage('1.0.0', path.join(sandbox.root, 'unused.txt')),
      sha256: '0'.repeat(64),
    });
    await go(window, 'Applications');
    await window.getByRole('button', { name: 'Check for releases' }).click();
    const card = window.getByRole('article', { name: 'Auram Photo' });
    await card.getByRole('button', { name: 'Install' }).click();

    await expect(card.getByText('Failed', { exact: true })).toBeVisible();
    await expect(card.getByText(/SHA-256 checksum does not match/)).toBeVisible();
    await expect(card.getByRole('button', { name: 'Retry' })).toBeVisible();
    const versions = await readdir(path.join(sandbox.appsDir, 'auram.photo', 'versions')).catch(
      () => [],
    );
    expect(versions).toEqual([]);
  } finally {
    await app.close();
  }
});
