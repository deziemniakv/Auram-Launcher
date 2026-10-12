/* Setting values shared by the main process and the renderer. Kept free of Zod so the
 * renderer bundle does not include schema code it never runs. */

export const LANGUAGES = ['en', 'pl'] as const;
export type Language = (typeof LANGUAGES)[number];

export const INTERFACE_SCALES = [90, 100, 110, 125] as const;
export type InterfaceScale = (typeof INTERFACE_SCALES)[number];

export const SECTIONS = ['home', 'applications', 'projects', 'updates', 'settings'] as const;
export type Section = (typeof SECTIONS)[number];

export const START_SECTIONS = ['home', 'applications', 'projects'] as const;
export const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
