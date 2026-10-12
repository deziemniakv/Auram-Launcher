# Contributing to Auram Launcher

Thank you for helping build Auram. This document explains how to set up the project and what we
expect from changes.

## Ground rules

- Be respectful; the [Code of Conduct](CODE_OF_CONDUCT.md) applies everywhere.
- Report vulnerabilities privately ([SECURITY.md](SECURITY.md)), never in public issues.
- Discuss larger changes in an issue before opening a pull request.

## Setup

```sh
corepack enable
pnpm install
pnpm dev
```

See [docs/development.md](docs/development.md) for details, including how to run against
isolated data folders and how to test with a stand-in application build.

## Before you open a pull request

```sh
pnpm format
pnpm check            # lint, typecheck, unit tests, build
pnpm test:e2e         # end-to-end tests (on Linux: xvfb-run -a pnpm test:e2e)
```

CI runs the same commands and also builds the Windows installer.

## Expectations for changes

**Honest state.** The launcher must never present something as working when it is not. Use real
data or a clearly designed unavailable/empty/error state. Mock data is only acceptable in tests.

**Security boundary.** The renderer is sandboxed and has no Node.js access. Privileged work
belongs in the main process behind a typed IPC handler that validates its input with Zod (see
`apps/launcher/src/main/ipc`). Never pass arbitrary paths, URLs or commands from the renderer
to the filesystem, shell or network without validation.

**Design system.** Use tokens from `@auram/design-tokens` and components from `@auram/ui`.
Square corners, neutral colours, thin borders, visible keyboard focus. A unit test rejects
hard-coded colours and border radii in stylesheets. See [docs/design-system.md](docs/design-system.md).

**Translations.** Every user-facing string goes through `apps/launcher/src/renderer/src/i18n`
with both English and Polish text. The type system and tests enforce that both exist.

**Tests.** Add unit tests for logic (services, schemas, state derivation) and extend the
end-to-end suite when you change user flows.

**Dependencies.** Add one only with a clear reason, and prefer small, maintained packages.
Run `pnpm licenses` when runtime dependencies change so the in-app license list stays accurate.

## Commit messages

Use the imperative mood and explain _why_ in the body when it is not obvious, for example
`Verify artifact size before hashing`.
