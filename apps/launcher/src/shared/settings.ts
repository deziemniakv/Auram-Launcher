import { z } from 'zod';
import { LANGUAGES, LOG_LEVELS, START_SECTIONS } from './constants';

export * from './constants';

const AppearanceSchema = z.object({
  interfaceScale: z
    .union([z.literal(90), z.literal(100), z.literal(110), z.literal(125)])
    .default(100),
  reduceMotion: z.boolean().default(false),
});

const DirectoriesSchema = z.object({
  /** `null` means the platform default (Documents/Auram/Projects). */
  projects: z.string().min(1).max(1024).nullable().default(null),
  /** `null` means the platform default (<data root>/Apps). */
  apps: z.string().min(1).max(1024).nullable().default(null),
});

const StartupSchema = z.object({
  openAtLogin: z.boolean().default(false),
  startSection: z.enum(START_SECTIONS).default('home'),
});

const UpdatesSchema = z.object({
  checkOnStartup: z.boolean().default(true),
  includePrerelease: z.boolean().default(false),
});

const DiagnosticsSchema = z.object({
  logLevel: z.enum(LOG_LEVELS).default('info'),
});

export const SettingsSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  language: z.enum(LANGUAGES).default('en'),
  appearance: AppearanceSchema.default(AppearanceSchema.parse({})),
  directories: DirectoriesSchema.default(DirectoriesSchema.parse({})),
  startup: StartupSchema.default(StartupSchema.parse({})),
  updates: UpdatesSchema.default(UpdatesSchema.parse({})),
  diagnostics: DiagnosticsSchema.default(DiagnosticsSchema.parse({})),
});
export type Settings = z.infer<typeof SettingsSchema>;

/** Per-section schemas, used to salvage valid sections from a partially corrupted file. */
export const SETTINGS_SECTIONS = {
  language: z.enum(LANGUAGES),
  appearance: AppearanceSchema,
  directories: DirectoriesSchema,
  startup: StartupSchema,
  updates: UpdatesSchema,
  diagnostics: DiagnosticsSchema,
} as const;

/**
 * Changes the renderer may request. Directories are intentionally excluded:
 * they can only be changed through a native folder picker in the main process.
 */
export const SettingsPatchSchema = z
  .object({
    language: z.enum(LANGUAGES).optional(),
    appearance: AppearanceSchema.partial().strict().optional(),
    startup: StartupSchema.partial().strict().optional(),
    updates: UpdatesSchema.partial().strict().optional(),
    diagnostics: DiagnosticsSchema.partial().strict().optional(),
  })
  .strict();
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export function defaultSettings(locale: string): Settings {
  return SettingsSchema.parse({ language: locale.toLowerCase().startsWith('pl') ? 'pl' : 'en' });
}
