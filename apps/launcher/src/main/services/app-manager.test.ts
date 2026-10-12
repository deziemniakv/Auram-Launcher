import path from 'node:path';
import type { Arch, Catalog, Platform } from '@auram/app-manifest';
import { sampleManifest } from '@auram/app-manifest/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppExitNotice, AppView } from '../../shared/ipc';
import { makeZip, sha256, tempDir } from '../test-utils';
import { AppManager } from './app-manager';
import { nullLogger } from './logger';
import type { FetchLike } from './net';

const platform = process.platform as Platform;
const arch = process.arch as Arch;
const API = 'https://api.github.com/repos/auram/photo/releases?per_page=20';
const MANIFEST_URL = 'https://github.com/auram/photo/releases/download/v1.0.0/auram-release.json';
const ARTIFACT_URL = 'https://github.com/auram/photo/releases/download/v1.0.0/photo.zip';

const catalog: Catalog = {
  schemaVersion: 1,
  apps: [
    {
      id: 'auram.photo',
      name: 'Auram Photo',
      description: 'Photo editing',
      descriptionTranslations: {},
      category: 'photo',
      availability: 'in-development',
      releaseSource: {
        type: 'github',
        owner: 'auram',
        repo: 'photo',
        manifestAsset: 'auram-release.json',
      },
      projectExtensions: ['.cproj'],
    },
    {
      id: 'auram.video',
      name: 'Auram Video',
      description: 'Video editing',
      descriptionTranslations: {},
      category: 'video',
      availability: 'planned',
      releaseSource: null,
      projectExtensions: [],
    },
  ],
};

async function photoPackage(exitCode: number) {
  const script = `#!/bin/sh\nexit ${exitCode}\n`;
  return makeZip([
    {
      name: 'auram-app.json',
      content: JSON.stringify({
        schemaVersion: 1,
        id: 'auram.photo',
        name: 'Auram Photo',
        version: '1.0.0',
        executable: { linux: 'photo.sh', darwin: 'photo.sh', win32: 'photo.exe' },
      }),
    },
    { name: 'photo.sh', content: script, mode: 0o100755 },
    { name: 'photo.exe', content: 'not a real executable' },
  ]);
}

function releaseFetch(zip: Buffer, options: { published: boolean }): FetchLike {
  const manifest = sampleManifest({
    version: '1.0.0',
    artifacts: [
      { platform, arch, format: 'zip', url: ARTIFACT_URL, sha256: sha256(zip), size: zip.length },
    ],
  });
  return async (input) => {
    if (input === API) {
      const releases = options.published
        ? [
            {
              tag_name: 'v1.0.0',
              html_url: 'https://github.com/auram/photo/releases/tag/v1.0.0',
              draft: false,
              prerelease: false,
              published_at: '2026-09-01T00:00:00Z',
              assets: [{ name: 'auram-release.json', browser_download_url: MANIFEST_URL, size: 1 }],
            },
          ]
        : [];
      return Response.json(releases);
    }
    if (input === MANIFEST_URL) return Response.json(manifest);
    if (input === ARTIFACT_URL) return new Response(new Uint8Array(zip));
    return new Response(null, { status: 404 });
  };
}

describe('AppManager', () => {
  let root: { dir: string; cleanup: () => Promise<void> };
  let manager: AppManager | null = null;

  beforeEach(async () => {
    root = await tempDir();
  });
  afterEach(async () => {
    manager?.dispose();
    await root.cleanup();
  });

  function create(fetchImpl: FetchLike, overrides: { launcherVersion?: string } = {}) {
    manager = new AppManager({
      catalog,
      getAppsDir: () => path.join(root.dir, 'Apps'),
      downloadsDir: path.join(root.dir, 'Downloads'),
      releaseCacheFile: path.join(root.dir, 'cache', 'releases.json'),
      platform: process.platform,
      arch: process.arch,
      launcherVersion: overrides.launcherVersion ?? '0.1.0',
      userAgent: 'test',
      fetch: fetchImpl,
      trust: { isTrusted: (url) => url.protocol === 'https:' },
      logger: nullLogger,
      getIncludePrerelease: () => false,
      earlyExitWindowMs: 10_000,
    });
    return manager;
  }

  const photo = (apps: AppView[]) => apps.find((app) => app.id === 'auram.photo')!;

  function waitFor(m: AppManager, predicate: (apps: AppView[]) => boolean): Promise<AppView[]> {
    return new Promise((resolve) => {
      const off = m.onChanged((apps) => {
        if (predicate(apps)) {
          off();
          resolve(apps);
        }
      });
    });
  }

  it('reports honest initial states before any network check', async () => {
    const m = create(releaseFetch(Buffer.alloc(0), { published: false }));
    await m.init();
    const apps = m.list();
    expect(photo(apps)).toMatchObject({
      installed: null,
      operation: null,
      running: false,
      release: { state: 'not-checked' },
    });
    expect(apps.find((app) => app.id === 'auram.video')?.release).toEqual({ state: 'no-source' });
  });

  it('shows "no release" when nothing is published and refuses to install', async () => {
    const m = create(releaseFetch(Buffer.alloc(0), { published: false }));
    await m.init();
    await m.checkReleases();
    expect(photo(m.list()).release.state).toBe('no-release');
    await expect(m.install('auram.photo')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('records check failures as errors', async () => {
    const m = create(async () => {
      throw new TypeError('offline');
    });
    await m.init();
    await m.checkReleases();
    const release = photo(m.list()).release;
    expect(release.state).toBe('error');
  });

  it('blocks releases that need a newer launcher', async () => {
    const zip = await photoPackage(0);
    const m = create(releaseFetch(zip, { published: true }), { launcherVersion: '0.0.1' });
    await m.init();
    await m.checkReleases();
    const release = photo(m.list()).release;
    expect(release.state === 'resolved' && release.resolution).toBe('requires-newer-launcher');
    await expect(m.install('auram.photo')).rejects.toMatchObject({ code: 'incompatible' });
  });

  it.skipIf(process.platform === 'win32')(
    'installs a published release, launches it and reports an early failure',
    async () => {
      const zip = await photoPackage(3);
      const m = create(releaseFetch(zip, { published: true }));
      await m.init();
      await m.checkReleases();
      expect(photo(m.list()).release).toMatchObject({
        state: 'resolved',
        resolution: 'not-installed-available',
      });

      const installed = waitFor(
        m,
        (apps) => photo(apps).installed !== null && photo(apps).operation === null,
      );
      await m.install('auram.photo');
      expect(photo(m.list()).operation?.phase).toBeDefined();
      const after = photo(await installed);
      expect(after.installed).toMatchObject({
        version: '1.0.0',
        source: 'release',
        launchable: true,
      });
      expect(after.release).toMatchObject({ state: 'resolved', resolution: 'up-to-date' });

      const exited = new Promise<AppExitNotice>((resolve) => m.onExited(resolve));
      await m.launch('auram.photo');
      expect(photo(m.list()).running).toBe(true);
      expect(await exited).toMatchObject({ appId: 'auram.photo', exitCode: 3 });
      // The exit is reported before the "no longer running" change is emitted.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(photo(m.list()).running).toBe(false);
    },
  );

  it('persists release information across restarts', async () => {
    const zip = await photoPackage(0);
    const first = create(releaseFetch(zip, { published: true }));
    await first.init();
    await first.checkReleases();
    first.dispose();

    const second = create(async () => {
      throw new Error('should not be called');
    });
    await second.init();
    expect(photo(second.list()).release).toMatchObject({ state: 'resolved', version: '1.0.0' });
  });

  it('refuses to launch applications that are not installed', async () => {
    const m = create(releaseFetch(Buffer.alloc(0), { published: false }));
    await m.init();
    await expect(m.launch('auram.photo')).rejects.toMatchObject({ code: 'not-installed' });
    await expect(m.launch('auram.unknown')).rejects.toMatchObject({ code: 'not-found' });
  });
});
