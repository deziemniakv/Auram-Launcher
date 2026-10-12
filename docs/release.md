# Releasing

## Versioning

The launcher follows [Semantic Versioning](https://semver.org/). The version in
`apps/launcher/package.json` is the product version shown in the app and used for
`minLauncherVersion` checks. Shared packages are private and versioned with the repository.

## Steps

1. Update `CHANGELOG.md`: move entries from _Unreleased_ into a new version section with the date.
2. Set the version in `apps/launcher/package.json`.
3. Run `pnpm check` and `pnpm test:e2e` locally.
4. Commit, then tag and push:

   ```sh
   git tag v0.1.0
   git push origin v0.1.0
   ```

5. The **Release** workflow (`.github/workflows/release.yml`) verifies that the tag matches the
   package version, runs lint, typecheck and tests on Windows, builds the NSIS installer and
   uploads it to a **draft** GitHub release.
6. Install the draft's installer on a clean Windows machine and check: the launcher starts,
   settings persist after restart, and upgrading over the previous version keeps settings,
   installed applications and projects.
7. Write the release notes and publish the draft.

Installed launchers discover the new version on the Updates page and link to the release; the
user runs the new installer, which upgrades in place.

## Building locally

```sh
pnpm package:win      # on Windows → apps/launcher/release/<version>/Auram-Launcher-Setup-<version>-x64.exe
```

On Linux, `pnpm --filter @auram/launcher package:dir` produces an unpacked build for smoke tests.
Building the NSIS installer on Linux or macOS requires Wine; use a Windows machine or CI instead.

## Code signing

Installers are currently **unsigned**, so Windows SmartScreen warns on first run. To sign,
add repository secrets `WINDOWS_CERTIFICATE` (base64-encoded `.pfx`) and
`WINDOWS_CERTIFICATE_PASSWORD`; electron-builder picks them up as `CSC_LINK` and
`CSC_KEY_PASSWORD`. Never commit certificates or passwords.

## Before the first public release

- Confirm the application id `com.auram.launcher` (`electron-builder.yml`). It determines the
  Windows AppUserModelID and installer identity and must not change after release.
- Decide on code signing.
- Verify an upgrade from one released version to the next.
