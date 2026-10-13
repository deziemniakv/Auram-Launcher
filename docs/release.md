# Releasing

## Versioning

The launcher follows [Semantic Versioning](https://semver.org/). The version in
`apps/launcher/package.json` is the product version shown in the app and used for
`minLauncherVersion` checks. Shared packages are private and versioned with the repository.

## Steps

1. Update `CHANGELOG.md`: move entries from _Unreleased_ into a new version section with the date.
2. Set the version in `apps/launcher/package.json`.
3. Run `pnpm check` and `pnpm test:e2e` locally.
4. Merge the change into `main`.
5. Open **Actions → Release → Run workflow**, choose `main` and leave **Publish** unticked.
   The **Release** workflow (`.github/workflows/release.yml`) then:
   - reads the version from `apps/launcher/package.json`;
   - runs lint, typecheck and tests on Windows and builds the NSIS installer;
   - only after a successful build, creates the tag `v<version>` on the built commit;
   - creates a **draft** GitHub release with `Auram-Launcher-Setup-<version>-x64.exe` and
     `SHA256SUMS.txt`.
6. Install the draft's installer on a clean Windows machine and check: the launcher starts,
   settings persist after restart, and upgrading over the previous version keeps settings,
   installed applications and projects.
7. Edit the draft's release notes if needed, then run the workflow again with **Publish** ticked.
   It downloads the draft's files, checks the installer against `SHA256SUMS.txt` and publishes
   the draft. Publishing by hand from the draft's page works too.

Pushing a tag `v<version>` instead of step 5 starts the same workflow for that tag.

The workflow never deletes, moves or overwrites a tag or release. If a run fails after the tag
was created, run it again: it builds the tagged commit and creates the missing draft. If the
draft already exists, it builds nothing and only publishes when asked. A tag must point to a
commit on `main` with the matching version, otherwise the workflow stops.

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

## Installer identity

The application id `com.auram.launcher` (`electron-builder.yml`) determines the Windows
AppUserModelID and the installer identity. Since 0.1.1 has been released with it, it must not
change, or new installers will no longer upgrade existing installations.
