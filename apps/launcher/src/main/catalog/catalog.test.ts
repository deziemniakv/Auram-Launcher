import { describe, expect, it } from 'vitest';
import { loadBundledCatalog } from './index';

describe('bundled catalog', () => {
  it('is valid and contains Auram Photo', () => {
    const catalog = loadBundledCatalog();
    expect(catalog.apps.map((app) => app.id)).toContain('auram.photo');
  });

  it('does not claim planned applications can be installed', () => {
    for (const app of loadBundledCatalog().apps) {
      if (app.availability === 'planned') expect(app.releaseSource).toBeNull();
    }
  });
});
