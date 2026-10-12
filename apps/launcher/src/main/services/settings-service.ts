import { copyFile } from 'node:fs/promises';
import path from 'node:path';
import {
  SETTINGS_SECTIONS,
  SettingsPatchSchema,
  SettingsSchema,
  defaultSettings,
  type Settings,
  type SettingsPatch,
} from '../../shared/settings';
import { LauncherError } from './errors';
import { readJsonFile, timestampForFileName, writeJsonAtomic } from './fs-utils';
import type { Logger } from './logger';

export interface SettingsLoadResult {
  settings: Settings;
  warnings: string[];
}

/**
 * Loads settings, recovering as much as possible from a damaged file.
 *
 * - Missing file: defaults.
 * - Unparseable JSON: the file is copied to `settings.corrupt-<time>.json` and defaults are used.
 * - Valid JSON with invalid sections: valid sections are kept, invalid ones reset,
 *   and the original is backed up before it is overwritten.
 *
 * The user's file is never silently discarded.
 */
export async function loadSettings(
  file: string,
  locale: string,
  logger: Logger,
): Promise<SettingsLoadResult> {
  const defaults = defaultSettings(locale);
  const read = await readJsonFile(file);

  if (read.kind === 'missing') return { settings: defaults, warnings: [] };

  if (read.kind === 'invalid') {
    const backup = await backupFile(file, logger);
    logger.warn('settings', 'Settings file is not valid JSON; using defaults', {
      error: read.error,
      backup,
    });
    return {
      settings: defaults,
      warnings: [
        `The settings file could not be read and was reset. A copy was saved as ${path.basename(backup ?? '')}.`,
      ],
    };
  }

  const full = SettingsSchema.safeParse(read.value);
  if (full.success) return { settings: full.data, warnings: [] };

  const raw = (typeof read.value === 'object' && read.value !== null ? read.value : {}) as Record<
    string,
    unknown
  >;
  const salvaged: Record<string, unknown> = { ...defaults };
  const reset: string[] = [];
  for (const [key, schema] of Object.entries(SETTINGS_SECTIONS)) {
    if (!(key in raw)) continue;
    const section = schema.safeParse(raw[key]);
    if (section.success) salvaged[key] = section.data;
    else reset.push(key);
  }
  const settings = SettingsSchema.parse(salvaged);
  const backup = await backupFile(file, logger);
  logger.warn('settings', 'Some settings were invalid and have been reset', { reset, backup });
  return {
    settings,
    warnings: [
      `Some settings were invalid and have been reset (${reset.join(', ') || 'format'}). A copy of the previous file was saved as ${path.basename(backup ?? '')}.`,
    ],
  };
}

async function backupFile(file: string, logger: Logger): Promise<string | null> {
  const backup = path.join(path.dirname(file), `settings.corrupt-${timestampForFileName()}.json`);
  try {
    await copyFile(file, backup);
    return backup;
  } catch (error) {
    logger.error('settings', 'Could not back up settings file', error);
    return null;
  }
}

export function applySettingsPatch(current: Settings, patch: SettingsPatch): Settings {
  const parsed = SettingsPatchSchema.safeParse(patch);
  if (!parsed.success) {
    throw new LauncherError('invalid-input', parsed.error.issues[0]?.message ?? 'Invalid settings');
  }
  const p = parsed.data;
  return SettingsSchema.parse({
    ...current,
    language: p.language ?? current.language,
    appearance: { ...current.appearance, ...p.appearance },
    startup: { ...current.startup, ...p.startup },
    updates: { ...current.updates, ...p.updates },
    diagnostics: { ...current.diagnostics, ...p.diagnostics },
  });
}

export class SettingsService {
  private settings: Settings;
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(settings: Settings, previous: Settings) => void>();

  constructor(
    private readonly file: string,
    initial: SettingsLoadResult,
    private readonly logger: Logger,
  ) {
    this.settings = initial.settings;
    this.warnings = initial.warnings;
  }

  readonly warnings: string[];

  get(): Settings {
    return this.settings;
  }

  onChange(listener: (settings: Settings, previous: Settings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async update(patch: SettingsPatch): Promise<Settings> {
    return this.commit(applySettingsPatch(this.settings, patch));
  }

  async setDirectory(kind: 'projects' | 'apps', value: string | null): Promise<Settings> {
    return this.commit(
      SettingsSchema.parse({
        ...this.settings,
        directories: { ...this.settings.directories, [kind]: value },
      }),
    );
  }

  /** Persists the current settings, e.g. on first launch. */
  async save(): Promise<void> {
    await this.enqueueWrite(this.settings);
  }

  private async commit(next: Settings): Promise<Settings> {
    const previous = this.settings;
    await this.enqueueWrite(next);
    this.settings = next;
    for (const listener of this.listeners) listener(next, previous);
    return next;
  }

  private enqueueWrite(value: Settings): Promise<void> {
    const write = this.writeQueue.then(() => writeJsonAtomic(this.file, value));
    this.writeQueue = write.catch((error: unknown) => {
      this.logger.error('settings', 'Failed to save settings', error);
    });
    return write.catch((error: unknown) => {
      throw new LauncherError(
        'io',
        `Settings could not be saved: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }
}
