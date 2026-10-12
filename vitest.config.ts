import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Electron's unpatched fs (see apps/launcher/src/main/services/fs.ts) is plain fs in Node.
    alias: { 'original-fs': 'node:fs' },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/launcher/src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
