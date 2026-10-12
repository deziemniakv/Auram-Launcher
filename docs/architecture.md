# Architecture

Auram Launcher is an Electron application organised as a pnpm workspace. It manages Auram
applications; it does not contain them. Each application (Auram Photo first) is developed in
its own repository and integrates through the contract in [app-integration.md](app-integration.md).

## Workspace

| Package                 | Responsibility                                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/launcher`         | The Electron app: main process, preload bridge, React renderer, packaging.                                                                                      |
| `@auram/app-manifest`   | Zod schemas for the catalog, release manifests, installed-app descriptors and installation records; SemVer comparison; update resolution. Pure, no I/O.         |
| `@auram/project-format` | Schema and helpers for the `.cproj` project container.                                                                                                          |
| `@auram/design-tokens`  | CSS custom properties (and a small TypeScript mirror) for colour, spacing, type, geometry, motion.                                                              |
| `@auram/ui`             | React components built on the tokens: buttons, inputs, selects, switches, dialogs, toasts, status tags, progress, empty/loading/error states, navigation items. |

Shared packages are consumed as TypeScript source and bundled by electron-vite, so there is no
separate package build step. Turborepo was not added: with one application and four source-only
packages, `pnpm -r` is sufficient. Revisit when more applications join the workspace.

## Processes

```
┌──────────────────────── main process (Node.js, privileged) ───────────────────────┐
│ index.ts         lifecycle, single instance, wiring                                │
│ security.ts      navigation/window/permission/webview policies, URL allow-lists    │
│ window.ts        BrowserWindow (sandboxed), window state                           │
│ ipc/             typed handlers: sender check → Zod validation → service call      │
│ services/                                                                         │
│   paths              data directory layout per OS                                  │
│   settings-service   load/validate/recover/persist settings                         │
│   logger             rotating file log                                             │
│   app-manager        catalog + installs + releases + operations + processes        │
│   installed-apps     discovery of installed versions                               │
│   releases           GitHub Releases lookup, manifest validation                   │
│   installer          download, verify, extract, activate, uninstall                │
│   process-launcher   spawn applications without a shell                            │
│   projects-service   recent projects, folder scan, .cproj metadata                  │
│   net / zip / fs-utils  trusted fetch, safe ZIP handling, atomic writes            │
└───────────────────────────────────────▲──────────────────────────────────────────┘
                                        │ ipcRenderer.invoke / events (plain data)
┌──────────── preload (sandboxed) ──────┴──── exposes window.auram (AuramApi) ───────┐
└───────────────────────────────────────▲──────────────────────────────────────────┘
┌──────────── renderer (sandboxed, no Node.js) ───────────────────────────────────────┐
│ React + Zustand stores (settings, apps, projects, ui) · pages · i18n (en, pl)       │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

The IPC contract lives in `apps/launcher/src/shared/ipc.ts`: channel names, the `AuramApi`
interface implemented by the preload script, and every data type that crosses the boundary.
Handlers return `IpcResult<T>` (`{ ok: true, value }` or `{ ok: false, error: { code, message } }`)
instead of throwing, so the renderer can always show a specific error.

## State model for applications

The main process is the single source of truth. `AppManager.list()` derives an `AppView` per
catalog entry from:

- **Catalog entry** (bundled `catalog.json`): what the product is and where it publishes releases.
- **Installation** (`Apps/<id>/current.json` + `versions/<v>/auram-app.json`): what is on disk.
- **Release status**: result of the last release check (`not-checked`, `checking`, `no-source`,
  `no-release`, `error`, or `resolved` with a resolution such as `update-available`). Cached in
  `Launcher/cache/releases.json` so it survives restarts.
- **Operation**: `downloading → verifying → installing`, `uninstalling`, or `failed` with an
  error code and message.
- **Running processes** started by the launcher.

The renderer maps this to labels and actions in `lib/app-state.ts` (pure, unit tested).
An action is offered only when the underlying state supports it: _Install_ requires a validated
release manifest with an artifact for this OS and architecture; _Open_ requires a launchable
installation.

## Install and update pipeline

1. **Discover**: list releases via the GitHub REST API, pick the newest non-draft release
   (prereleases only if enabled) that carries the manifest asset, download and validate the
   manifest, and check that it describes the expected application id.
2. **Resolve**: compare with the installed version, check `minLauncherVersion`, select the
   artifact for this platform/architecture.
3. **Download** into `Downloads/` over HTTPS from an allow-listed host (also checked after
   redirects), hashing while streaming. Abort if the size exceeds the manifest; reject on size or
   SHA-256 mismatch.
4. **Extract** into a hidden staging directory with limits on entry count and total size;
   reject path traversal, absolute paths and symlinks.
5. **Validate** the package's `auram-app.json` (id, version, executable present for this OS).
6. **Activate** by moving the staged directory to `versions/<version>` and atomically rewriting
   `current.json`. One previous version is kept; older ones are pruned.

Until step 6 the existing installation is untouched; any failure cleans up staging files and the
partial download. Nothing in the package is executed during installation.

## Settings

`SettingsSchema` (Zod, `shared/settings.ts`) defines every setting with defaults. Loading is
tolerant: invalid JSON is backed up as `settings.corrupt-<time>.json` and replaced by defaults;
partially invalid files keep their valid sections. Warnings are shown in the UI. Writes are
atomic (temp file, `fsync`, rename) and serialised. The renderer cannot change directories
directly; those go through a native folder picker in the main process.

## Security boundary

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`.
- A strict Content Security Policy (`script-src 'self'` in production).
- `will-navigate`, `will-redirect`, `setWindowOpenHandler` and `will-attach-webview` block
  everything except the launcher's own page; external links open in the system browser only for
  allow-listed HTTPS hosts.
- All permission requests are denied.
- IPC handlers reject messages from any frame other than the launcher renderer and validate
  input with Zod. Paths from the renderer are accepted only where meaningful (project files) and
  are checked (absolute, `.cproj`, existing regular file).
- Applications are launched with `spawn(executable, args, { shell: false })`; the executable comes
  from the validated descriptor and must resolve inside the installation directory.
- Packaged builds set Electron fuses (no `RunAsNode`, no `NODE_OPTIONS`, no inspector arguments,
  asar integrity validation, load app only from asar).

## Performance notes

- Release checks and directory scans run asynchronously after the window is shown.
- Download progress events are coalesced to at most one per 100 ms.
- Project metadata is cached by path, modification time and size.
- The renderer bundle excludes Zod (shared constants are kept schema-free) and is minified.
