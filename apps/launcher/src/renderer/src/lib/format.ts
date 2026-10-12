import type { Language } from '../../../shared/constants';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(bytes: number, language: Language): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value)} ${UNITS[unit]}`;
}

const DIVISIONS: Array<{ amount: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { amount: 60, unit: 'second' },
  { amount: 60, unit: 'minute' },
  { amount: 24, unit: 'hour' },
  { amount: 7, unit: 'day' },
  { amount: 4.34524, unit: 'week' },
  { amount: 12, unit: 'month' },
  { amount: Number.POSITIVE_INFINITY, unit: 'year' },
];

/** "3 days ago" / "3 dni temu". Falls back to `justNow` for the last minute. */
export function formatRelative(
  iso: string,
  language: Language,
  justNow: string,
  now = Date.now(),
): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  let duration = (time - now) / 1000;
  if (Math.abs(duration) < 60) return justNow;
  const formatter = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  for (const division of DIVISIONS) {
    if (Math.abs(duration) < division.amount)
      return formatter.format(Math.round(duration), division.unit);
    duration /= division.amount;
  }
  return '';
}

export function formatDate(iso: string, language: Language): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(time);
}
