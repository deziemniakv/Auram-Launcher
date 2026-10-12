import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/out/**',
      '**/dist/**',
      '**/release/**',
      '**/test-results/**',
      '**/playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': 'off',
    },
  },
  {
    files: ['packages/ui/**/*.{ts,tsx}', 'apps/launcher/src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The renderer is sandboxed: Node.js modules are unavailable there by design.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'fs', 'path', 'child_process', 'electron'],
              message: 'The renderer has no Node.js or Electron access. Use window.auram.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/launcher/src/renderer/**/*.test.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // Electron's patched fs treats *.asar files as directories, which breaks installing
    // Electron-based apps. Main-process code must use services/fs.ts (original-fs).
    files: ['apps/launcher/src/main/**/*.ts'],
    ignores: ['apps/launcher/src/main/**/*.test.ts', 'apps/launcher/src/main/test-utils.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['fs', 'fs/promises', 'node:fs', 'node:fs/promises'].map((name) => ({
            name,
            message: 'Use services/fs.ts: Electron patches fs for *.asar paths.',
          })),
        },
      ],
    },
  },
);
