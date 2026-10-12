import { describe, expect, it } from 'vitest';
import { en } from './en';
import { pl } from './pl';

type Tree = { [key: string]: Tree | string | ((...args: never[]) => string) };

function leaves(tree: Tree, prefix = ''): Array<[string, Tree[string]]> {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'object'
      ? leaves(value, `${prefix}${key}.`)
      : [[`${prefix}${key}`, value] as [string, Tree[string]]],
  );
}

describe('translations', () => {
  const english = new Map(leaves(en as unknown as Tree));
  const polish = new Map(leaves(pl as unknown as Tree));

  it('Polish covers every English key with the same kind of value', () => {
    expect([...polish.keys()].sort()).toEqual([...english.keys()].sort());
    for (const [key, value] of english) {
      expect(typeof polish.get(key), key).toBe(typeof value);
    }
  });

  it('has no empty strings', () => {
    for (const [key, value] of polish) {
      const text =
        typeof value === 'function' ? (value as (...args: unknown[]) => string)('X', 'Y') : value;
      expect(String(text).trim(), key).not.toBe('');
    }
  });

  it('uses correct Polish plural forms', () => {
    expect(pl.nav.updatesBadge(1)).toBe('1 dostępna aktualizacja');
    expect(pl.nav.updatesBadge(3)).toBe('3 dostępne aktualizacje');
    expect(pl.nav.updatesBadge(5)).toBe('5 dostępnych aktualizacji');
    expect(pl.nav.updatesBadge(12)).toBe('12 dostępnych aktualizacji');
    expect(pl.nav.updatesBadge(22)).toBe('22 dostępne aktualizacje');
  });
});
