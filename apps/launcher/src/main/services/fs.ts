/**
 * File-system access for the main process.
 *
 * Electron patches Node's `fs` so that any `*.asar` file behaves like a
 * read-only directory. Installed Auram applications are Electron apps with
 * their own `resources/app.asar`, which the launcher must write, inspect, move
 * and delete as ordinary files; through the patched `fs` that fails with
 * "Invalid package". `original-fs` is Electron's unpatched module. Unit tests
 * run in plain Node, where it is aliased to `node:fs` (see vitest.config.ts).
 *
 * All main-process code uses this module instead of `node:fs`; the launcher
 * never needs to read inside an asar archive itself.
 */
import fs from 'original-fs';

export const fsp = fs.promises;
export const { createWriteStream } = fs;
