import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import yazl from 'yazl';

const launcherDir = path.resolve(__dirname, '..');

export interface Sandbox {
  root: string;
  dataDir: string;
  documentsDir: string;
  projectsDir: string;
  appsDir: string;
  cleanup: () => Promise<void>;
}

/** An isolated data + documents directory so tests never touch real user data. */
export async function createSandbox(): Promise<Sandbox> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'auram-e2e-'));
  const dataDir = path.join(root, 'data');
  const documentsDir = path.join(root, 'documents');
  return {
    root,
    dataDir,
    documentsDir,
    projectsDir: path.join(documentsDir, 'Auram', 'Projects'),
    appsDir: path.join(dataDir, 'Apps'),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

export async function launch(
  sandbox: Sandbox,
): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({
    args: [launcherDir, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: {
      ...process.env,
      AURAM_DATA_DIR: sandbox.dataDir,
      AURAM_DOCUMENTS_DIR: sandbox.documentsDir,
      // Keep tests hermetic: no release checks against GitHub on startup.
      AURAM_OFFLINE: '1',
      LANG: 'en_US.UTF-8',
    },
  });
  const window = await app.firstWindow();
  await window.getByRole('navigation').waitFor();
  return { app, window };
}

export function zip(entries: Array<{ name: string; content: string | Buffer }>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = new yazl.ZipFile();
    for (const entry of entries) {
      const executable = entry.name.endsWith('.sh');
      archive.addBuffer(Buffer.from(entry.content), entry.name, {
        mode: executable ? 0o100755 : 0o100644,
      });
    }
    archive.end();
    const chunks: Buffer[] = [];
    archive.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    archive.outputStream.on('error', reject);
  });
}

export async function writeProject(dir: string, fileName: string, name: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, fileName);
  await writeFile(
    file,
    await zip([
      {
        name: 'manifest.json',
        content: JSON.stringify({
          format: 'auram.project',
          formatVersion: 1,
          id: '0b6f1d2e-6a3c-4c1e-9f55-3c2c8f1b9a10',
          name,
          appId: 'auram.photo',
          createdAt: '2026-09-01T10:00:00Z',
          modifiedAt: new Date().toISOString(),
        }),
      },
    ]),
  );
  return file;
}

/**
 * Places a stand-in "Auram Photo" build where the launcher discovers manually
 * installed applications. The executable records its arguments to `marker`.
 */
export async function installFakePhoto(appsDir: string, marker: string): Promise<void> {
  const versionDir = path.join(appsDir, 'auram.photo', 'versions', '0.0.1');
  await mkdir(versionDir, { recursive: true });
  await writeFile(
    path.join(versionDir, 'auram-app.json'),
    JSON.stringify({
      schemaVersion: 1,
      id: 'auram.photo',
      name: 'Auram Photo',
      version: '0.0.1',
      executable: { linux: 'auram-photo.sh', darwin: 'auram-photo.sh' },
    }),
  );
  const script = path.join(versionDir, 'auram-photo.sh');
  await writeFile(script, `#!/bin/sh\nprintf '%s\\n' "started" "$@" > "${marker}"\n`);
  await chmod(script, 0o755);
}

export interface FakeRelease {
  version: string;
  zip: Buffer;
  /** Overrides the digest published in the manifest, to simulate a corrupted download. */
  sha256?: string;
}

/**
 * Replaces Electron's `net.fetch` in the main process with a stand-in for GitHub
 * Releases serving one release of Auram Photo. Test-only: production code has no
 * hooks for this.
 */
export async function serveFakeRelease(
  app: ElectronApplication,
  release: FakeRelease,
): Promise<void> {
  const { createHash } = await import('node:crypto');
  const base = `https://github.com/deziemniakv/auram-photo/releases/download/v${release.version}`;
  const manifest = {
    schemaVersion: 1,
    id: 'auram.photo',
    name: 'Auram Photo',
    version: release.version,
    channel: 'stable',
    releasedAt: '2026-10-01T12:00:00Z',
    minLauncherVersion: '0.1.0',
    releaseNotes: { summary: 'Test release', body: 'First line\nSecond line' },
    artifacts: [
      {
        platform: process.platform,
        arch: process.arch,
        format: 'zip',
        url: `${base}/auram-photo.zip`,
        sha256: release.sha256 ?? createHash('sha256').update(release.zip).digest('hex'),
        size: release.zip.length,
      },
    ],
  };
  const releases = [
    {
      tag_name: `v${release.version}`,
      html_url: `https://github.com/deziemniakv/auram-photo/releases/tag/v${release.version}`,
      draft: false,
      prerelease: false,
      published_at: '2026-10-01T12:00:00Z',
      assets: [
        { name: 'auram-release.json', browser_download_url: `${base}/auram-release.json`, size: 1 },
      ],
    },
  ];
  await app.evaluate(
    ({ net }, data) => {
      const routes: Record<string, () => Response> = {
        'https://api.github.com/repos/deziemniakv/auram-photo/releases?per_page=20': () =>
          Response.json(data.releases),
        [`${data.base}/auram-release.json`]: () => Response.json(data.manifest),
        [`${data.base}/auram-photo.zip`]: () => new Response(Buffer.from(data.zip, 'base64')),
      };
      net.fetch = (async (input: string) =>
        routes[input]?.() ?? new Response(null, { status: 404 })) as typeof net.fetch;
    },
    { base, manifest, releases, zip: release.zip.toString('base64') },
  );
}

export function photoPackage(version: string, marker: string): Promise<Buffer> {
  return zip([
    {
      name: 'auram-app.json',
      content: JSON.stringify({
        schemaVersion: 1,
        id: 'auram.photo',
        name: 'Auram Photo',
        version,
        executable: { linux: 'auram-photo.sh', darwin: 'auram-photo.sh' },
      }),
    },
    { name: 'auram-photo.sh', content: `#!/bin/sh\necho "${version}" > "${marker}"\n` },
    // Real Electron apps ship resources/app.asar. Electron's fs treats *.asar paths as
    // archives, so the installer must write them as plain files.
    { name: 'resources/app.asar', content: Buffer.from('not parsed by the launcher') },
  ]);
}
