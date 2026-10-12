import { LauncherError } from './errors';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Decides which URLs the launcher may download from. */
export interface TrustPolicy {
  isTrusted(url: URL): boolean;
}

/** Hosts used by GitHub Releases, the initial distribution mechanism. */
export const GITHUB_RELEASE_HOSTS = new Set([
  'api.github.com',
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);

export const githubTrustPolicy: TrustPolicy = {
  isTrusted: (url) => url.protocol === 'https:' && GITHUB_RELEASE_HOSTS.has(url.hostname),
};

export interface TrustedFetchOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/**
 * Fetches from a trusted source. Both the requested URL and the final URL after
 * redirects must satisfy the trust policy; otherwise the body is never read.
 */
export async function trustedFetch(
  fetchImpl: FetchLike,
  url: string,
  policy: TrustPolicy,
  options: TrustedFetchOptions = {},
): Promise<Response> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new LauncherError('network', `Invalid URL: ${url}`);
  }
  if (!policy.isTrusted(parsed)) {
    throw new LauncherError(
      'forbidden',
      `Refusing to download from an untrusted location: ${parsed.origin}`,
    );
  }

  let response: Response;
  try {
    response = await fetchImpl(url, {
      redirect: 'follow',
      signal: options.signal,
      headers: options.headers,
      cache: 'no-store',
    });
  } catch (error) {
    if (options.signal?.aborted)
      throw new LauncherError('cancelled', 'The operation was cancelled.');
    throw new LauncherError(
      'network',
      `Network request failed: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    );
  }

  if (response.url) {
    const final = new URL(response.url);
    if (!policy.isTrusted(final)) {
      await response.body?.cancel().catch(() => {});
      throw new LauncherError(
        'forbidden',
        `Download was redirected to an untrusted location: ${final.origin}`,
      );
    }
  }
  return response;
}

/** Reads a response body as text, aborting once it exceeds `maxBytes`. */
export async function readTextLimited(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new LauncherError(
      'invalid-package',
      `Response is larger than the allowed ${maxBytes} bytes.`,
    );
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new LauncherError(
        'invalid-package',
        `Response is larger than the allowed ${maxBytes} bytes.`,
      );
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function fetchJson(
  fetchImpl: FetchLike,
  url: string,
  policy: TrustPolicy,
  options: TrustedFetchOptions & { maxBytes: number },
): Promise<{ status: number; json: unknown }> {
  const response = await trustedFetch(fetchImpl, url, policy, options);
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    return { status: response.status, json: null };
  }
  const text = await readTextLimited(response, options.maxBytes);
  try {
    return { status: response.status, json: JSON.parse(text) };
  } catch {
    throw new LauncherError('invalid-package', `The server returned invalid JSON for ${url}.`);
  }
}
