import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tempDir } from '../test-utils';
import { nullLogger } from './logger';
import { SettingsService, applySettingsPatch, loadSettings } from './settings-service';
import { defaultSettings } from '../../shared/settings';

describe('settings', () => {
  let root: { dir: string; cleanup: () => Promise<void> };
  let file: string;

  beforeEach(async () => {
    root = await tempDir();
    file = path.join(root.dir, 'settings.json');
  });
  afterEach(() => root.cleanup());

  it('uses locale-aware defaults when no file exists', async () => {
    expect((await loadSettings(file, 'pl-PL', nullLogger)).settings.language).toBe('pl');
    expect((await loadSettings(file, 'en-US', nullLogger)).settings.language).toBe('en');
    expect((await loadSettings(file, 'de', nullLogger)).warnings).toEqual([]);
  });

  it('persists changes and reads them back', async () => {
    const service = new SettingsService(
      file,
      await loadSettings(file, 'en', nullLogger),
      nullLogger,
    );
    await service.update({ language: 'pl', appearance: { interfaceScale: 125 } });
    await service.setDirectory('projects', '/work/projects');

    const reloaded = await loadSettings(file, 'en', nullLogger);
    expect(reloaded.warnings).toEqual([]);
    expect(reloaded.settings.language).toBe('pl');
    expect(reloaded.settings.appearance.interfaceScale).toBe(125);
    expect(reloaded.settings.appearance.reduceMotion).toBe(false);
    expect(reloaded.settings.directories.projects).toBe('/work/projects');
  });

  it('backs up and resets an unparseable file', async () => {
    await writeFile(file, '{ not json');
    const result = await loadSettings(file, 'en', nullLogger);
    expect(result.settings).toEqual(defaultSettings('en'));
    expect(result.warnings).toHaveLength(1);
    const backups = (await readdir(root.dir)).filter((name) =>
      name.startsWith('settings.corrupt-'),
    );
    expect(backups).toHaveLength(1);
    expect(await readFile(path.join(root.dir, backups[0]!), 'utf8')).toBe('{ not json');
  });

  it('keeps valid sections when others are invalid', async () => {
    await writeFile(
      file,
      JSON.stringify({
        language: 'pl',
        appearance: { interfaceScale: 999 },
        updates: { checkOnStartup: false },
      }),
    );
    const result = await loadSettings(file, 'en', nullLogger);
    expect(result.settings.language).toBe('pl');
    expect(result.settings.updates.checkOnStartup).toBe(false);
    expect(result.settings.appearance.interfaceScale).toBe(100);
    expect(result.warnings[0]).toContain('appearance');
  });

  it('ignores unknown keys from newer versions without losing known ones', async () => {
    await writeFile(
      file,
      JSON.stringify({ ...defaultSettings('en'), language: 'pl', futureOption: true }),
    );
    const result = await loadSettings(file, 'en', nullLogger);
    expect(result.settings.language).toBe('pl');
  });

  it('rejects patches that try to change directories or contain unknown fields', () => {
    const current = defaultSettings('en');
    expect(() =>
      applySettingsPatch(current, { directories: { projects: '/x' } } as never),
    ).toThrow();
    expect(() =>
      applySettingsPatch(current, { appearance: { interfaceScale: 42 } } as never),
    ).toThrow();
    expect(applySettingsPatch(current, { updates: { includePrerelease: true } }).updates).toEqual({
      checkOnStartup: true,
      includePrerelease: true,
    });
  });

  it('notifies listeners with the previous value', async () => {
    const service = new SettingsService(
      file,
      await loadSettings(file, 'en', nullLogger),
      nullLogger,
    );
    const seen: string[] = [];
    service.onChange((next, previous) => seen.push(`${previous.language}->${next.language}`));
    await service.update({ language: 'pl' });
    expect(seen).toEqual(['en->pl']);
  });
});
