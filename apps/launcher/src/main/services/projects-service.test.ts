import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeZip, tempDir } from '../test-utils';
import { nullLogger } from './logger';
import { ProjectsService, readProjectDetails } from './projects-service';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

function manifest(name: string, modifiedAt = '2026-09-02T10:00:00Z') {
  return JSON.stringify({
    format: 'auram.project',
    formatVersion: 1,
    id: '0b6f1d2e-6a3c-4c1e-9f55-3c2c8f1b9a10',
    name,
    appId: 'auram.photo',
    createdAt: '2026-09-01T10:00:00Z',
    modifiedAt,
  });
}

describe('projects', () => {
  let root: { dir: string; cleanup: () => Promise<void> };
  let projectsDir: string;

  beforeEach(async () => {
    root = await tempDir();
    projectsDir = path.join(root.dir, 'Projects');
    await mkdir(projectsDir, { recursive: true });
  });
  afterEach(() => root.cleanup());

  async function writeProject(relative: string, entries: Parameters<typeof makeZip>[0]) {
    const file = path.join(projectsDir, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, await makeZip(entries));
    return file;
  }

  it('reads metadata and thumbnails from the container', async () => {
    const file = await writeProject('Poster.cproj', [
      { name: 'manifest.json', content: manifest('Poster') },
      { name: 'thumbnail.png', content: PNG_1PX },
      { name: 'layers/0.bin', content: 'pixels' },
    ]);
    const details = await readProjectDetails(file);
    expect(details).toMatchObject({
      status: 'ok',
      name: 'Poster',
      appId: 'auram.photo',
      modifiedAt: '2026-09-02T10:00:00Z',
    });
    expect(details.thumbnail).toMatch(/^data:image\/png;base64,/);
    expect(details.fileModifiedAt).not.toBeNull();
  });

  it('marks unreadable files instead of inventing metadata', async () => {
    const notZip = path.join(projectsDir, 'broken.cproj');
    await writeFile(notZip, 'not a zip');
    expect(await readProjectDetails(notZip)).toMatchObject({
      status: 'invalid',
      name: null,
      appId: null,
    });

    const noManifest = await writeProject('empty.cproj', [{ name: 'other.txt', content: 'x' }]);
    expect((await readProjectDetails(noManifest)).problem).toMatch(/manifest/);

    expect(await readProjectDetails(path.join(projectsDir, 'gone.cproj'))).toMatchObject({
      status: 'missing',
    });
  });

  it('rejects oversized thumbnails', async () => {
    const file = await writeProject('big.cproj', [
      { name: 'manifest.json', content: manifest('Big') },
      { name: 'thumbnail.png', content: Buffer.alloc(5 * 1024 * 1024) },
    ]);
    expect((await readProjectDetails(file)).status).toBe('invalid');
  });

  it('discovers projects in the folder and one level below, newest first', async () => {
    await writeProject('a.cproj', [
      { name: 'manifest.json', content: manifest('Older', '2026-01-01T00:00:00Z') },
    ]);
    await writeProject('Client/b.cproj', [
      { name: 'manifest.json', content: manifest('Newer', '2026-05-01T00:00:00Z') },
    ]);
    await writeProject('Client/Deep/c.cproj', [
      { name: 'manifest.json', content: manifest('Too deep') },
    ]);
    await writeFile(path.join(projectsDir, 'notes.txt'), 'ignored');

    const service = new ProjectsService({
      recentFile: path.join(root.dir, 'recent.json'),
      getProjectsDir: () => projectsDir,
      platform: process.platform,
      logger: nullLogger,
    });
    await service.init();
    const snapshot = await service.snapshot();
    expect(snapshot.directory.exists).toBe(true);
    expect(snapshot.directory.projects.map((project) => project.name)).toEqual(['Newer', 'Older']);
  });

  it('remembers recent projects across restarts and validates paths', async () => {
    const file = await writeProject('Poster.cproj', [
      { name: 'manifest.json', content: manifest('Poster') },
    ]);
    const options = {
      recentFile: path.join(root.dir, 'recent.json'),
      getProjectsDir: () => path.join(root.dir, 'missing-dir'),
      platform: process.platform,
      logger: nullLogger,
    };
    const service = new ProjectsService(options);
    await service.init();
    await service.addRecent(await service.assertProjectFile(file));
    await service.addRecent(file);

    const reloaded = new ProjectsService(options);
    await reloaded.init();
    const snapshot = await reloaded.snapshot();
    expect(snapshot.recent.map((project) => project.name)).toEqual(['Poster']);
    expect(snapshot.directory).toMatchObject({ exists: false, projects: [] });

    await reloaded.removeRecent(file);
    expect((await reloaded.snapshot()).recent).toEqual([]);

    await expect(reloaded.assertProjectFile('relative.cproj')).rejects.toMatchObject({
      code: 'invalid-input',
    });
    await expect(reloaded.assertProjectFile(path.join(root.dir, 'x.txt'))).rejects.toMatchObject({
      code: 'invalid-input',
    });
    await expect(
      reloaded.assertProjectFile(path.join(root.dir, 'gone.cproj')),
    ).rejects.toMatchObject({ code: 'not-found' });
  });
});
