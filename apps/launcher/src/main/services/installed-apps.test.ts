import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tempDir } from '../test-utils';
import { appLayout, discoverInstalledApp } from './installed-apps';

const APP = 'auram.photo';

describe('discoverInstalledApp', () => {
  let root: { dir: string; cleanup: () => Promise<void> };
  beforeEach(async () => {
    root = await tempDir();
  });
  afterEach(() => root.cleanup());

  async function placeVersion(
    version: string,
    descriptor: Record<string, unknown> = {},
    executable = true,
  ) {
    const dir = path.join(root.dir, APP, 'versions', version);
    await mkdir(path.join(dir, 'bin'), { recursive: true });
    await writeFile(
      path.join(dir, 'auram-app.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: APP,
        name: 'Auram Photo',
        version,
        executable: { linux: 'bin/photo', win32: 'bin/photo.exe' },
        ...descriptor,
      }),
    );
    if (executable) {
      await writeFile(path.join(dir, 'bin', 'photo'), '#!/bin/sh\n');
      await chmod(path.join(dir, 'bin', 'photo'), 0o755);
    }
    return dir;
  }

  it('returns null when nothing is installed', async () => {
    expect(await discoverInstalledApp(root.dir, APP, 'linux')).toBeNull();
  });

  it('uses current.json to select the active version', async () => {
    await placeVersion('1.0.0');
    await placeVersion('2.0.0');
    await writeFile(
      path.join(root.dir, APP, 'current.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: APP,
        version: '1.0.0',
        installedAt: '2026-01-01T00:00:00Z',
        source: 'release',
      }),
    );
    const app = await discoverInstalledApp(root.dir, APP, 'linux');
    expect(app?.version).toBe('1.0.0');
    expect(app?.record?.source).toBe('release');
    expect(app?.problem).toBeNull();
  });

  it('falls back to the newest valid version as a manual installation', async () => {
    await placeVersion('1.0.0');
    await placeVersion('1.10.0');
    await placeVersion('1.9.0');
    const app = await discoverInstalledApp(root.dir, APP, 'linux');
    expect(app?.version).toBe('1.10.0');
    expect(app?.record).toBeNull();
  });

  it('reports a missing executable instead of pretending the app can run', async () => {
    await placeVersion('1.0.0', {}, false);
    const app = await discoverInstalledApp(root.dir, APP, 'linux');
    expect(app?.executablePath).toBeNull();
    expect(app?.problem).toMatch(/missing/);
  });

  it('reports versions that do not support the current platform', async () => {
    await placeVersion('1.0.0', { executable: { win32: 'bin/photo.exe' } });
    const app = await discoverInstalledApp(root.dir, APP, 'linux');
    expect(app?.executablePath).toBeNull();
    expect(app?.problem).toMatch(/operating system/);
  });

  it('ignores descriptors that belong to another application', async () => {
    await placeVersion('1.0.0', { id: 'auram.video' });
    expect(await discoverInstalledApp(root.dir, APP, 'linux')).toBeNull();
  });

  it('rejects invalid application ids before touching the filesystem', () => {
    expect(() => appLayout(root.dir, '../evil')).toThrow();
  });
});
