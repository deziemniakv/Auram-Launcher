# Development guide

## Requirements

- Node.js 22.12 or newer
- pnpm 10 (`corepack enable` activates the version pinned in `package.json`)
- Windows 10/11 for packaging and for the primary target; Linux and macOS work for development

## First run

```sh
pnpm install
pnpm dev
```

`pnpm dev` starts electron-vite: the renderer hot-reloads, and changes in the main process or
preload restart Electron.

## Isolated data

```sh
# PowerShell
$env:AURAM_DATA_DIR="$env:TEMP\auram\data"; $env:AURAM_DOCUMENTS_DIR="$env:TEMP\auram\docs"; pnpm dev
# bash
AURAM_DATA_DIR=/tmp/auram/data AURAM_DOCUMENTS_DIR=/tmp/auram/docs pnpm dev
```

Set `AURAM_OFFLINE=1` to skip the release checks normally made at startup.

## Trying an application without a release

Create `<data>/Apps/auram.photo/versions/0.0.1/auram-app.json` describing any executable in that
folder (see [app-integration.md](app-integration.md)). The launcher lists it as a manual
installation and can start it.

## Tests

| Command                       | What it runs                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm test`                   | Vitest unit tests for all packages and the launcher's main-process services and renderer logic |
| `pnpm build && pnpm test:e2e` | Playwright tests that start the built Electron app with isolated data                          |

On headless Linux, run end-to-end tests under a virtual display: `xvfb-run -a pnpm test:e2e`.

The installer tests run a local HTTP server and real ZIP archives to cover checksum mismatches,
interrupted downloads, path traversal, symlinks, cancellation and rollback.

## Generated files

| File                                                     | Command                                         |
| -------------------------------------------------------- | ----------------------------------------------- |
| `apps/launcher/src/renderer/src/generated/licenses.json` | `pnpm licenses` (also runs during `pnpm build`) |
| Brand assets and icons                                   | `python3 scripts/generate-brand-assets.py`      |

## Troubleshooting

- **Electron failed to install**: run `node node_modules/electron/install.js` from `apps/launcher`.
- **Logs**: Settings → Diagnostics → Open logs folder, or `<data>/Launcher/logs/launcher.log`.
