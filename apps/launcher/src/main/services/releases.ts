import {
  GitHubReleaseListSchema,
  ReleaseManifestSchema,
  githubReleasesApiUrl,
  pickRelease,
  type CatalogEntry,
  type ReleaseManifest,
} from '@auram/app-manifest';
import { LauncherError } from './errors';
import { fetchJson, type FetchLike, type TrustPolicy } from './net';

export type ReleaseLookup =
  | { kind: 'no-source' }
  | { kind: 'no-release' }
  | { kind: 'found'; manifest: ReleaseManifest; releasePageUrl: string };

const GITHUB_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

/**
 * Looks up the newest published release manifest for a catalog entry.
 * The manifest must validate and must describe the same application id;
 * anything else is reported as an error rather than shown as an update.
 */
export async function lookupLatestRelease(
  deps: { fetch: FetchLike; trust: TrustPolicy; userAgent: string },
  entry: CatalogEntry,
  options: { includePrerelease: boolean; signal?: AbortSignal },
): Promise<ReleaseLookup> {
  const source = entry.releaseSource;
  if (!source) return { kind: 'no-source' };

  const headers = { ...GITHUB_HEADERS, 'User-Agent': deps.userAgent };
  const list = await fetchJson(deps.fetch, githubReleasesApiUrl(source), deps.trust, {
    maxBytes: 4 * 1024 * 1024,
    headers,
    signal: options.signal,
  });
  // A missing repository or one without releases is a normal state for apps in development.
  if (list.status === 404) return { kind: 'no-release' };
  if (list.status === 403 || list.status === 429) {
    throw new LauncherError('network', 'GitHub rate limit reached. Try again later.');
  }
  if (list.status >= 400)
    throw new LauncherError('network', `GitHub responded with HTTP ${list.status}.`);

  const releases = GitHubReleaseListSchema.safeParse(list.json);
  if (!releases.success)
    throw new LauncherError('invalid-package', 'Unexpected response from GitHub.');

  const picked = pickRelease(releases.data, source.manifestAsset, options.includePrerelease);
  if (!picked) return { kind: 'no-release' };

  const manifestResponse = await fetchJson(deps.fetch, picked.manifestUrl, deps.trust, {
    maxBytes: 1024 * 1024,
    headers: { 'User-Agent': deps.userAgent, Accept: 'application/octet-stream' },
    signal: options.signal,
  });
  if (manifestResponse.status >= 400) {
    throw new LauncherError(
      'network',
      `The release manifest could not be downloaded (HTTP ${manifestResponse.status}).`,
    );
  }
  const manifest = ReleaseManifestSchema.safeParse(manifestResponse.json);
  if (!manifest.success) {
    const issue = manifest.error.issues[0];
    throw new LauncherError(
      'invalid-package',
      `The published release manifest is invalid (${issue?.path.join('.') ?? ''}: ${issue?.message ?? 'unknown'}).`,
    );
  }
  if (manifest.data.id !== entry.id) {
    throw new LauncherError(
      'invalid-package',
      `The release manifest describes ${manifest.data.id}, not ${entry.id}.`,
    );
  }
  return { kind: 'found', manifest: manifest.data, releasePageUrl: picked.release.html_url };
}

export interface LauncherReleaseInfo {
  version: string;
  url: string;
}

/** Latest published (non-draft, non-prerelease) launcher release, if any. */
export async function lookupLatestLauncherRelease(
  deps: { fetch: FetchLike; trust: TrustPolicy; userAgent: string },
  repository: { owner: string; repo: string },
): Promise<LauncherReleaseInfo | null> {
  const list = await fetchJson(deps.fetch, githubReleasesApiUrl(repository), deps.trust, {
    maxBytes: 4 * 1024 * 1024,
    headers: { ...GITHUB_HEADERS, 'User-Agent': deps.userAgent },
  });
  if (list.status === 404) return null;
  if (list.status >= 400)
    throw new LauncherError('network', `GitHub responded with HTTP ${list.status}.`);
  const releases = GitHubReleaseListSchema.safeParse(list.json);
  if (!releases.success)
    throw new LauncherError('invalid-package', 'Unexpected response from GitHub.');
  const latest = releases.data.find((release) => !release.draft && !release.prerelease);
  if (!latest) return null;
  return { version: latest.tag_name.replace(/^v/, ''), url: latest.html_url };
}
