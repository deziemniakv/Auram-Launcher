import { CatalogSchema, type Catalog } from '@auram/app-manifest';
import rawCatalog from './catalog.json';

/**
 * The bundled catalog of Auram applications. It describes products and where
 * their releases are published; it says nothing about what is installed.
 * Validated at startup (and in tests) so a malformed edit fails loudly.
 */
export function loadBundledCatalog(): Catalog {
  return CatalogSchema.parse(rawCatalog);
}
