import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform, Writable } from 'node:stream';
import yauzl from 'yauzl';
import { LauncherError } from './errors';
import { isWithin } from './fs-utils';
import { createWriteStream, fsp } from './fs';

const { mkdir } = fsp;

type ZipFile = yauzl.ZipFile;
type Entry = yauzl.Entry;

function openZip(file: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      file,
      { lazyEntries: true, autoClose: false, strictFileNames: true },
      (error, zip) => {
        if (error || !zip)
          reject(
            new LauncherError(
              'invalid-package',
              `Not a valid ZIP archive: ${error?.message ?? 'unknown error'}`,
            ),
          );
        else resolve(zip);
      },
    );
  });
}

function openEntryStream(zip: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream)
        reject(
          new LauncherError(
            'invalid-package',
            `Cannot read ${entry.fileName}: ${error?.message ?? ''}`,
          ),
        );
      else resolve(stream);
    });
  });
}

/** Iterates entries one at a time; the callback finishes before the next entry is read. */
async function forEachEntry(
  zip: ZipFile,
  onEntry: (entry: Entry) => Promise<boolean | void>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    zip.on('error', (error: Error) =>
      finish(new LauncherError('invalid-package', `Corrupted ZIP archive: ${error.message}`)),
    );
    zip.on('end', () => finish());
    zip.on('entry', (entry: Entry) => {
      onEntry(entry).then(
        (stop) => {
          if (stop === true) finish();
          else zip.readEntry();
        },
        (error: unknown) => finish(error),
      );
    });
    zip.readEntry();
  });
}

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

function isSymlink(entry: Entry): boolean {
  return ((entry.externalFileAttributes >>> 16) & S_IFMT) === S_IFLNK;
}

function limitBytes(maxBytes: number, label: string): Transform {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.length;
      if (total > maxBytes)
        callback(new LauncherError('invalid-package', `${label} is larger than allowed.`));
      else callback(null, chunk);
    },
  });
}

/**
 * Reads selected small entries into memory. Entries larger than their limit are
 * rejected before decompression and while streaming (sizes in headers can lie).
 */
export async function readZipEntries(
  file: string,
  limits: Record<string, number>,
): Promise<Map<string, Buffer>> {
  const zip = await openZip(file);
  const found = new Map<string, Buffer>();
  const wanted = new Set(Object.keys(limits));
  try {
    await forEachEntry(zip, async (entry) => {
      if (!wanted.has(entry.fileName)) return;
      const limit = limits[entry.fileName] ?? 0;
      if (entry.uncompressedSize > limit) {
        throw new LauncherError('invalid-package', `${entry.fileName} is larger than allowed.`);
      }
      const stream = await openEntryStream(zip, entry);
      const chunks: Buffer[] = [];
      await pipeline(
        stream,
        limitBytes(limit, entry.fileName),
        new Writable({
          write(chunk: Buffer, _encoding, callback) {
            chunks.push(chunk);
            callback();
          },
        }),
      );
      found.set(entry.fileName, Buffer.concat(chunks));
      wanted.delete(entry.fileName);
      return wanted.size === 0;
    });
  } finally {
    zip.close();
  }
  return found;
}

export interface ExtractLimits {
  maxEntries: number;
  maxTotalBytes: number;
  signal?: AbortSignal;
}

/**
 * Extracts an archive into `destination`, which must be empty or absent.
 * Rejects path traversal ("zip slip"), absolute paths and symbolic links, and
 * enforces entry-count and total-size limits against decompression bombs.
 */
export async function extractZip(
  file: string,
  destination: string,
  limits: ExtractLimits,
): Promise<void> {
  const zip = await openZip(file);
  const root = path.resolve(destination);
  await mkdir(root, { recursive: true });
  let entries = 0;
  let total = 0;
  try {
    await forEachEntry(zip, async (entry) => {
      if (limits.signal?.aborted)
        throw new LauncherError('cancelled', 'The operation was cancelled.');
      entries++;
      if (entries > limits.maxEntries)
        throw new LauncherError('invalid-package', 'Archive contains too many files.');

      const name = entry.fileName;
      if (name.includes('\\') || path.posix.isAbsolute(name) || /^[a-zA-Z]:/.test(name)) {
        throw new LauncherError('invalid-package', `Archive contains an unsafe path: ${name}`);
      }
      const target = path.resolve(root, ...name.split('/'));
      if (!isWithin(root, target) || target === root) {
        throw new LauncherError('invalid-package', `Archive contains an unsafe path: ${name}`);
      }
      if (isSymlink(entry)) {
        throw new LauncherError('invalid-package', `Archive contains a symbolic link: ${name}`);
      }
      if (name.endsWith('/')) {
        await mkdir(target, { recursive: true });
        return;
      }

      total += entry.uncompressedSize;
      if (total > limits.maxTotalBytes)
        throw new LauncherError('invalid-package', 'Archive is larger than allowed.');

      await mkdir(path.dirname(target), { recursive: true });
      const stream = await openEntryStream(zip, entry);
      const mode = (entry.externalFileAttributes >>> 16) & 0o777;
      await pipeline(
        stream,
        limitBytes(entry.uncompressedSize, name),
        createWriteStream(target, { flags: 'wx', mode: mode & 0o111 ? 0o755 : 0o644 }),
      );
    });
  } finally {
    zip.close();
  }
}
