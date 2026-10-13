<p align="center">
  <img src="assets/brand/auram-mark.png" alt="Auram" height="120">
</p>

<h1 align="center">Auram Launcher</h1>

<p align="center">
  The desktop hub for the Auram ecosystem of open-source creative applications.
</p>

---

Auram Launcher installs, updates and starts Auram applications and keeps your creative projects
one click away. It is the first piece of a larger ecosystem: the applications themselves —
starting with **Auram Photo** — are developed as separate projects and integrate with the
launcher through a small, documented contract.

> **Status: early development (0.1.1).** The launcher is functional and installs
> **Auram Photo** from its published release. Other catalog entries show honestly that they
> have no release yet. See [What works today](#what-works-today).

## What works today

| Area                                                                  | Status                                                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Home, Applications, Projects, Updates, Settings                       | Implemented                                                                           |
| Settings persistence (with recovery from corrupted files)             | Implemented, tested across restarts                                                   |
| English and Polish interface                                          | Implemented                                                                           |
| Discovering installed applications                                    | Implemented (release installs and manual developer builds)                            |
| Launching installed applications, optionally with a project           | Implemented, end-to-end tested                                                        |
| Release discovery from GitHub Releases                                | Implemented                                                                           |
| Download → SHA-256 verification → staged install → atomic switch-over | Implemented; tested against a local server and with the published Auram Photo release |
| Project discovery and recent projects (`.cproj` metadata, thumbnails) | Implemented                                                                           |
| Launcher self-update                                                  | Detects new launcher releases and links to them; installation is manual               |
| Windows installer (NSIS)                                              | Configured; built by CI on Windows                                                    |
| Code signing                                                          | Not configured (installers are unsigned)                                              |

## Installing

Download `Auram-Launcher-Setup-<version>-x64.exe` from
[GitHub Releases](https://github.com/deziemniakv/Auram-Launcher/releases) and run it. The installer
is not code-signed yet, so Windows SmartScreen may warn on first run; `SHA256SUMS.txt` in the same
release lists the installer's checksum. Settings, installed applications and projects are stored
outside the installation folder, so upgrading or uninstalling the launcher leaves them in place.

## Development

Requirements: **Node.js 22.12+** and **pnpm 10** (`corepack enable` installs the pinned version).

```sh
pnpm install          # install dependencies (downloads Electron)
pnpm dev              # start the launcher with hot reload
```

Common tasks:

```sh
pnpm check            # lint + typecheck + unit tests + production build
pnpm test             # unit tests (Vitest)
pnpm build && pnpm test:e2e   # end-to-end tests against the built app (Playwright)
pnpm package:win      # Windows installer (run on Windows; see docs/release.md)
pnpm format           # format with Prettier
```

To run without touching your real data, point the launcher at throwaway folders:

```sh
AURAM_DATA_DIR=/tmp/auram/data AURAM_DOCUMENTS_DIR=/tmp/auram/docs pnpm dev
```

More detail: [docs/development.md](docs/development.md).

## Repository layout

```
apps/launcher/          Electron application (main, preload, renderer)
packages/app-manifest/  Catalog, release-manifest and installation schemas; version logic
packages/project-format/  The .cproj project container schema
packages/design-tokens/ Colours, spacing, typography and geometry tokens
packages/ui/            React components implementing the design system
docs/                   Architecture and integration documentation
scripts/                Asset and license generation
```

## Documentation

- [Architecture](docs/architecture.md) — processes, services, security boundary
- [Application integration](docs/app-integration.md) — how an Auram app is published, installed and launched
- [Project format](docs/project-format.md) — the `.cproj` container
- [Data locations](docs/data-locations.md) — where the launcher stores what
- [Design system](docs/design-system.md) — visual rules and tokens
- [Releasing](docs/release.md) — versioning and the release workflow

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md). Report security issues privately as described in
[SECURITY.md](SECURITY.md).

## License

The source code is licensed under the [Apache License 2.0](LICENSE). The Auram name and logo are
not covered by that license; see [NOTICE](NOTICE) and [assets/brand/README.md](assets/brand/README.md).
