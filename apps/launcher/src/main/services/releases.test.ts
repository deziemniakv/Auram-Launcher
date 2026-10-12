import type { CatalogEntry } from '@auram/app-manifest';
import { sampleManifest } from '@auram/app-manifest/testing';
import { describe, expect, it } from 'vitest';
import { lookupLatestLauncherRelease, lookupLatestRelease } from './releases';
import type { FetchLike, TrustPolicy } from './net';

const entry: CatalogEntry = {
  id: 'auram.photo',
  name: 'Auram Photo',
  description: 'Photo editing',
  descriptionTranslations: {},
  category: 'photo',
  availability: 'in-development',
  releaseSource: {
    type: 'github',
    owner: 'auram',
    repo: 'photo',
    manifestAsset: 'auram-release.json',
  },
  projectExtensions: ['.cproj'],
};

const trust: TrustPolicy = { isTrusted: (url) => url.protocol === 'https:' };

function fakeFetch(routes: Record<string, { status?: number; body: unknown }>): FetchLike {
  return async (input) => {
    const route = routes[input];
    if (!route) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200 });
  };
}

const API = 'https://api.github.com/repos/auram/photo/releases?per_page=20';
const MANIFEST = 'https://github.com/auram/photo/releases/download/v1.2.0/auram-release.json';
const release = {
  tag_name: 'v1.2.0',
  html_url: 'https://github.com/auram/photo/releases/tag/v1.2.0',
  draft: false,
  prerelease: false,
  published_at: '2026-09-01T00:00:00Z',
  assets: [{ name: 'auram-release.json', browser_download_url: MANIFEST, size: 100 }],
};

const deps = (routes: Record<string, { status?: number; body: unknown }>) => ({
  fetch: fakeFetch(routes),
  trust,
  userAgent: 'test',
});

describe('lookupLatestRelease', () => {
  it('returns the validated manifest of the newest release', async () => {
    const result = await lookupLatestRelease(
      deps({ [API]: { body: [release] }, [MANIFEST]: { body: sampleManifest() } }),
      entry,
      { includePrerelease: false },
    );
    expect(result.kind).toBe('found');
    if (result.kind === 'found') expect(result.manifest.version).toBe('1.2.0');
  });

  it('reports a missing repository or release as "no release", not as an error', async () => {
    expect((await lookupLatestRelease(deps({}), entry, { includePrerelease: false })).kind).toBe(
      'no-release',
    );
    expect(
      (
        await lookupLatestRelease(deps({ [API]: { body: [] } }), entry, {
          includePrerelease: false,
        })
      ).kind,
    ).toBe('no-release');
  });

  it('never shows an update from an invalid or mismatched manifest', async () => {
    await expect(
      lookupLatestRelease(
        deps({ [API]: { body: [release] }, [MANIFEST]: { body: { version: 'x' } } }),
        entry,
        {
          includePrerelease: false,
        },
      ),
    ).rejects.toMatchObject({ code: 'invalid-package' });
    await expect(
      lookupLatestRelease(
        deps({
          [API]: { body: [release] },
          [MANIFEST]: { body: sampleManifest({ id: 'auram.video' }) },
        }),
        entry,
        { includePrerelease: false },
      ),
    ).rejects.toMatchObject({ code: 'invalid-package' });
  });

  it('surfaces rate limiting and server errors', async () => {
    await expect(
      lookupLatestRelease(deps({ [API]: { status: 403, body: {} } }), entry, {
        includePrerelease: false,
      }),
    ).rejects.toMatchObject({
      code: 'network',
    });
    await expect(
      lookupLatestRelease(deps({ [API]: { status: 500, body: {} } }), entry, {
        includePrerelease: false,
      }),
    ).rejects.toMatchObject({
      code: 'network',
    });
  });

  it('does nothing for applications without a release source', async () => {
    const result = await lookupLatestRelease(
      deps({}),
      { ...entry, releaseSource: null },
      { includePrerelease: false },
    );
    expect(result).toEqual({ kind: 'no-source' });
  });
});

describe('lookupLatestLauncherRelease', () => {
  const api = 'https://api.github.com/repos/o/launcher/releases?per_page=20';
  it('ignores drafts and prereleases', async () => {
    const result = await lookupLatestLauncherRelease(
      deps({
        [api]: {
          body: [
            { ...release, tag_name: 'v0.3.0', prerelease: true },
            {
              ...release,
              tag_name: 'v0.2.0',
              html_url: 'https://github.com/o/launcher/releases/tag/v0.2.0',
            },
          ],
        },
      }),
      { owner: 'o', repo: 'launcher' },
    );
    expect(result).toEqual({
      version: '0.2.0',
      url: 'https://github.com/o/launcher/releases/tag/v0.2.0',
    });
  });
});
