import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Artifact } from '@auram/app-manifest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  localTrust,
  makeZip,
  sha256,
  startServer,
  tempDir,
  testFetch,
  type TestServer,
} from '../test-utils';
import { LauncherError } from './errors';
import { discoverInstalledApp } from './installed-apps';
import { installVersion, uninstallApp } from './installer';
import { nullLogger } from './logger';

const APP = 'auram.photo';

function descriptor(version: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    id: APP,
    name: 'Auram Photo',
    version,
    executable: {
      win32: 'bin/auram-photo.exe',
      linux: 'bin/auram-photo',
      darwin: 'bin/auram-photo',
    },
    ...extra,
  });
}

async function packageFor(version: string, extraEntries: Parameters<typeof makeZip>[0] = []) {
  return makeZip([
    { name: 'auram-app.json', content: descriptor(version) },
    { name: 'bin/auram-photo.exe', content: 'binary', mode: 0o100755 },
    { name: 'bin/auram-photo', content: '#!/bin/sh\nexit 0\n', mode: 0o100755 },
    ...extraEntries,
  ]);
}

describe('installVersion', () => {
  let server: TestServer;
  let root: { dir: string; cleanup: () => Promise<void> };
  let appsDir: string;
  let downloadsDir: string;
  const deps = { fetch: testFetch, trust: localTrust, logger: nullLogger };

  beforeEach(async () => {
    server = await startServer();
    root = await tempDir();
    appsDir = path.join(root.dir, 'Apps');
    downloadsDir = path.join(root.dir, 'Downloads');
  });

  afterEach(async () => {
    await server.close();
    await root.cleanup();
  });

  async function publish(
    version: string,
    zip: Buffer,
    overrides: Partial<Artifact> = {},
  ): Promise<Artifact> {
    server.routes.set(`/${version}.zip`, { body: zip });
    return {
      platform: 'linux',
      arch: 'x64',
      format: 'zip',
      url: server.url(`/${version}.zip`),
      sha256: sha256(zip),
      size: zip.length,
      ...overrides,
    };
  }

  const install = (version: string, artifact: Artifact, signal?: AbortSignal, phases?: string[]) =>
    installVersion(deps, {
      appId: APP,
      version,
      artifact,
      appsDir,
      downloadsDir,
      platform: 'linux',
      signal,
      onPhase: (phase) => phases?.push(phase.phase),
    });

  it('downloads, verifies, installs and activates a version', async () => {
    const phases: string[] = [];
    const record = await install(
      '1.0.0',
      await publish('1.0.0', await packageFor('1.0.0')),
      undefined,
      phases,
    );

    expect(record).toMatchObject({ id: APP, version: '1.0.0', source: 'release' });
    expect(new Set(phases)).toEqual(new Set(['downloading', 'verifying', 'installing']));
    const installed = await discoverInstalledApp(appsDir, APP, 'linux');
    expect(installed?.version).toBe('1.0.0');
    expect(installed?.executablePath).toBe(
      path.join(appsDir, APP, 'versions', '1.0.0', 'bin', 'auram-photo'),
    );
    expect(await readdir(downloadsDir)).toEqual([]);
  });

  it('updates to a new version and keeps one previous version', async () => {
    await install('1.0.0', await publish('1.0.0', await packageFor('1.0.0')));
    await install('1.1.0', await publish('1.1.0', await packageFor('1.1.0')));
    await install('1.2.0', await publish('1.2.0', await packageFor('1.2.0')));

    expect((await discoverInstalledApp(appsDir, APP, 'linux'))?.version).toBe('1.2.0');
    expect((await readdir(path.join(appsDir, APP, 'versions'))).sort()).toEqual(['1.1.0', '1.2.0']);
  });

  it('rejects a download whose checksum does not match and leaves the installed version active', async () => {
    await install('1.0.0', await publish('1.0.0', await packageFor('1.0.0')));
    const artifact = await publish('1.1.0', await packageFor('1.1.0'), { sha256: 'f'.repeat(64) });

    await expect(install('1.1.0', artifact)).rejects.toMatchObject({ code: 'integrity' });
    expect((await discoverInstalledApp(appsDir, APP, 'linux'))?.version).toBe('1.0.0');
    expect(await readdir(path.join(appsDir, APP, 'versions'))).toEqual(['1.0.0']);
    expect(await readdir(downloadsDir)).toEqual([]);
  });

  it('rejects an interrupted download', async () => {
    const zip = await packageFor('1.0.0');
    const artifact = await publish('1.0.0', zip);
    server.routes.set('/1.0.0.zip', { body: zip, truncateAt: 10 });

    const error = await install('1.0.0', artifact).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LauncherError);
    expect(['network', 'integrity']).toContain((error as LauncherError).code);
    expect(await discoverInstalledApp(appsDir, APP, 'linux')).toBeNull();
  });

  it('rejects downloads larger than declared', async () => {
    const zip = await packageFor('1.0.0');
    const artifact = await publish('1.0.0', zip, { size: zip.length - 1 });
    await expect(install('1.0.0', artifact)).rejects.toMatchObject({ code: 'integrity' });
  });

  it('reports HTTP errors as network failures', async () => {
    const artifact = await publish('1.0.0', await packageFor('1.0.0'));
    server.routes.set('/1.0.0.zip', { status: 503, body: 'unavailable' });
    await expect(install('1.0.0', artifact)).rejects.toMatchObject({ code: 'network' });
  });

  it('refuses untrusted download locations', async () => {
    const artifact = await publish('1.0.0', await packageFor('1.0.0'));
    await expect(
      install('1.0.0', { ...artifact, url: 'https://example.com/a.zip' }),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(server.requests).toEqual([]);
  });

  it('rejects archives with path traversal entries', async () => {
    const zip = await packageFor('1.0.0', [
      { name: 'zz/escape.txt', rawName: '../escape.txt', content: 'x' },
    ]);
    const artifact = await publish('1.0.0', zip);
    await expect(install('1.0.0', artifact)).rejects.toMatchObject({ code: 'invalid-package' });
    await expect(readFile(path.join(appsDir, APP, 'versions', 'escape.txt'))).rejects.toThrow();
    expect(await readdir(path.join(appsDir, APP, 'versions'))).toEqual([]);
  });

  it('rejects archives with symbolic links', async () => {
    const zip = await packageFor('1.0.0', [
      { name: 'link', content: '/etc/passwd', mode: 0o120777 },
    ]);
    await expect(install('1.0.0', await publish('1.0.0', zip))).rejects.toMatchObject({
      code: 'invalid-package',
    });
  });

  it('rejects packages whose descriptor does not match the release', async () => {
    const zip = await makeZip([
      { name: 'auram-app.json', content: descriptor('9.9.9') },
      { name: 'bin/auram-photo', content: 'x' },
    ]);
    await expect(install('1.0.0', await publish('1.0.0', zip))).rejects.toMatchObject({
      code: 'invalid-package',
    });
  });

  it('rejects packages without an executable for this platform', async () => {
    const zip = await makeZip([{ name: 'auram-app.json', content: descriptor('1.0.0') }]);
    await expect(install('1.0.0', await publish('1.0.0', zip))).rejects.toMatchObject({
      code: 'invalid-package',
    });
  });

  it('enforces extraction limits', async () => {
    const zip = await packageFor('1.0.0');
    const artifact = await publish('1.0.0', zip);
    await expect(
      installVersion(
        { ...deps, extractLimits: { maxEntries: 2, maxTotalBytes: 1_000_000 } },
        { appId: APP, version: '1.0.0', artifact, appsDir, downloadsDir, platform: 'linux' },
      ),
    ).rejects.toMatchObject({ code: 'invalid-package' });
  });

  it('can be cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const artifact = await publish('1.0.0', await packageFor('1.0.0'));
    await expect(install('1.0.0', artifact, controller.signal)).rejects.toMatchObject({
      code: 'cancelled',
    });
    expect(await discoverInstalledApp(appsDir, APP, 'linux')).toBeNull();
  });

  it('removes staging folders left by an interrupted install', async () => {
    const leftover = path.join(appsDir, APP, 'versions', '.staging-1.0.0-deadbeef', 'resources');
    await mkdir(leftover, { recursive: true });
    await writeFile(path.join(leftover, 'app.asar'), 'partial');
    await install('1.0.0', await publish('1.0.0', await packageFor('1.0.0')));
    expect(await readdir(path.join(appsDir, APP, 'versions'))).toEqual(['1.0.0']);
  });

  it('repairs an existing installation of the same version', async () => {
    const artifact = await publish('1.0.0', await packageFor('1.0.0'));
    await install('1.0.0', artifact);
    await writeFile(
      path.join(appsDir, APP, 'versions', '1.0.0', 'bin', 'auram-photo'),
      'corrupted',
    );
    await install('1.0.0', artifact);
    const content = await readFile(
      path.join(appsDir, APP, 'versions', '1.0.0', 'bin', 'auram-photo'),
      'utf8',
    );
    expect(content).toBe('#!/bin/sh\nexit 0\n');
  });
});

describe('uninstallApp', () => {
  it('removes application files and nothing else', async () => {
    const root = await tempDir();
    try {
      const appsDir = path.join(root.dir, 'Apps');
      const projects = path.join(root.dir, 'Projects');
      await mkdir(path.join(appsDir, APP, 'versions', '1.0.0'), { recursive: true });
      await mkdir(projects, { recursive: true });
      await writeFile(path.join(projects, 'keep.cproj'), 'project');

      await uninstallApp(appsDir, APP, nullLogger);

      expect(await readdir(appsDir)).toEqual([]);
      expect(await readFile(path.join(projects, 'keep.cproj'), 'utf8')).toBe('project');
      await expect(uninstallApp(appsDir, APP, nullLogger)).resolves.toBeUndefined();
    } finally {
      await root.cleanup();
    }
  });
});
