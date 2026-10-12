import { describe, expect, it } from 'vitest';
import { formatBytes, formatRelative } from './format';

describe('formatBytes', () => {
  it('uses binary units with sensible precision', () => {
    expect(formatBytes(512, 'en')).toBe('512 B');
    expect(formatBytes(1536, 'en')).toBe('1.5 KB');
    expect(formatBytes(150 * 1024 * 1024, 'en')).toBe('150 MB');
    expect(formatBytes(1536, 'pl')).toBe('1,5 KB');
  });
});

describe('formatRelative', () => {
  const now = Date.parse('2026-10-12T12:00:00Z');
  it('formats past times in the interface language', () => {
    expect(formatRelative('2026-10-12T11:59:30Z', 'en', 'just now', now)).toBe('just now');
    expect(formatRelative('2026-10-12T11:55:00Z', 'en', 'just now', now)).toBe('5 minutes ago');
    expect(formatRelative('2026-10-09T12:00:00Z', 'en', 'just now', now)).toBe('3 days ago');
    expect(formatRelative('2026-10-09T12:00:00Z', 'pl', 'przed chwilą', now)).toBe('3 dni temu');
    expect(formatRelative('not a date', 'en', 'just now', now)).toBe('');
  });
});
