import type { Language } from '../../../shared/constants';
import { useSettingsStore } from '../store/settings';
import { en, type Dictionary } from './en';
import { pl } from './pl';

export const dictionaries: Record<Language, Dictionary> = { en, pl };

export type { Dictionary };

/** The active dictionary. Re-renders when the language setting changes. */
export function useT(): Dictionary {
  const language = useSettingsStore((state) => state.snapshot?.settings.language ?? 'en');
  return dictionaries[language];
}

export function useLanguage(): Language {
  return useSettingsStore((state) => state.snapshot?.settings.language ?? 'en');
}
