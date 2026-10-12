import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import yazl from 'yazl';
import type { TrustPolicy } from './services/net';

/* Helpers for main-process tests. Not bundled into the application. */

export async function tempDir(
  prefix = 'auram-test-',
): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export interface ZipEntry {
  name: string;
  content?: string | Buffer;
  mode?: number;
  directory?: boolean;
  /**
   * Name written into the archive bytes after creation, for entries a well-behaved
   * ZIP writer refuses to create (e.g. `../escape`). Must have the same byte length as `name`.
   */
  rawName?: string;
}

export function makeZip(entries: ZipEntry[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    for (const entry of entries) {
      if (entry.directory) zip.addEmptyDirectory(entry.name);
      else
        zip.addBuffer(Buffer.from(entry.content ?? ''), entry.name, {
          mode: entry.mode ?? 0o100644,
        });
    }
    zip.end();
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on('end', () => {
      const archive = Buffer.concat(chunks);
      for (const entry of entries) {
        if (!entry.rawName) continue;
        const from = Buffer.from(entry.name);
        const to = Buffer.from(entry.rawName);
        if (from.length !== to.length) throw new Error('rawName must have the same length as name');
        for (let i = archive.indexOf(from); i !== -1; i = archive.indexOf(from, i + 1))
          to.copy(archive, i);
      }
      resolve(archive);
    });
    zip.outputStream.on('error', reject);
  });
}

export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export interface Route {
  status?: number;
  body?: Buffer | string;
  headers?: Record<string, string>;
  /** Close the connection after sending this many bytes of the body. */
  truncateAt?: number;
}

export interface TestServer {
  url: (pathname: string) => string;
  routes: Map<string, Route>;
  requests: string[];
  close: () => Promise<void>;
}

/** A local HTTP server standing in for GitHub in tests. */
export async function startServer(): Promise<TestServer> {
  const routes = new Map<string, Route>();
  const requests: string[] = [];
  const server: Server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    requests.push(pathname);
    const route = routes.get(pathname);
    if (!route) {
      res.writeHead(404).end();
      return;
    }
    const body =
      typeof route.body === 'string' ? Buffer.from(route.body) : (route.body ?? Buffer.alloc(0));
    res.writeHead(route.status ?? 200, { 'content-length': String(body.length), ...route.headers });
    if (route.truncateAt !== undefined) {
      res.write(body.subarray(0, route.truncateAt), () => res.destroy());
    } else {
      res.end(body);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: (pathname) => `http://127.0.0.1:${port}${pathname}`,
    routes,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** Trusts only the local test server. */
export const localTrust: TrustPolicy = { isTrusted: (url) => url.hostname === '127.0.0.1' };

export const testFetch = (input: string, init?: RequestInit) => fetch(input, init);
