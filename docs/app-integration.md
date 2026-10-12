# Integrating an Auram application

This document is the contract between the launcher and an Auram application such as
**Auram Photo**. An application publishes releases; the launcher discovers, verifies, installs
and starts them. Schemas live in `packages/app-manifest/src/schemas.ts`.

## 1. Catalog entry

The launcher ships a catalog (`apps/launcher/src/main/catalog/catalog.json`). Adding an
application means adding an entry:

```json
{
  "id": "auram.photo",
  "name": "Auram Photo",
  "description": "Photo editing and graphic design.",
  "category": "photo",
  "availability": "in-development",
  "releaseSource": {
    "type": "github",
    "owner": "deziemniakv",
    "repo": "auram-photo",
    "manifestAsset": "auram-release.json"
  },
  "projectExtensions": [".cproj"]
}
```

- `id` is permanent. It names the installation folder and appears in project files.
- `availability`: `released`, `in-development` or `planned`. Planned entries have no
  `releaseSource` and are shown as unavailable.

## 2. Release manifest (`auram-release.json`)

Attach this file to every GitHub release of the application:

```json
{
  "schemaVersion": 1,
  "id": "auram.photo",
  "name": "Auram Photo",
  "version": "0.1.0",
  "channel": "stable",
  "releasedAt": "2026-11-01T12:00:00Z",
  "minLauncherVersion": "0.1.0",
  "releaseNotes": {
    "summary": "First preview.",
    "body": "Plain text. Never rendered as HTML.",
    "url": "https://github.com/deziemniakv/auram-photo/releases/tag/v0.1.0"
  },
  "artifacts": [
    {
      "platform": "win32",
      "arch": "x64",
      "format": "zip",
      "url": "https://github.com/deziemniakv/auram-photo/releases/download/v0.1.0/auram-photo-0.1.0-win-x64.zip",
      "sha256": "<64 lowercase hex characters>",
      "size": 123456789
    }
  ],
  "dependencies": []
}
```

Rules enforced by the launcher:

- `version` is SemVer. Prereleases use a SemVer prerelease suffix and/or
  `"channel": "prerelease"`, and are offered only when the user enables prereleases.
- `url` must be HTTPS on a GitHub Releases host; the final URL after redirects is checked too.
- `size` and `sha256` must match the downloaded file exactly.
- The launcher refuses releases whose `minLauncherVersion` is newer than itself.
- Draft releases are ignored. The newest qualifying release that has the manifest asset wins.

Compute the digest with `sha256sum file.zip` (Linux/macOS) or
`Get-FileHash file.zip -Algorithm SHA256` (PowerShell, lowercase the result).

## 3. Package layout

The artifact is a ZIP archive. Its root must contain `auram-app.json`:

```json
{
  "schemaVersion": 1,
  "id": "auram.photo",
  "name": "Auram Photo",
  "version": "0.1.0",
  "executable": { "win32": "Auram Photo.exe" },
  "openProjectArgument": "positional"
}
```

- `id` and `version` must match the release manifest.
- `executable` paths are relative, use forward slashes and may not contain `..`.
- `openProjectArgument` is `"positional"` (`app.exe <project>`) or a flag such as `"--open"`
  (`app.exe --open <project>`). Arbitrary command lines are not supported.
- Archives with symlinks, absolute paths or `..` entries are rejected.
- The launcher never runs installers or scripts from the package. Anything an application needs
  at first start (e.g. creating its own settings) must happen when the application itself runs.

## 4. Installed layout

```
%LOCALAPPDATA%\Auram\Apps\auram.photo\
  current.json            {"schemaVersion":1,"id":"auram.photo","version":"0.1.0",
                           "installedAt":"…","source":"release"}
  versions\
    0.1.0\                extracted package (contains auram-app.json)
    0.0.9\                previous version kept for manual rollback
```

`current.json` is written last and atomically; it is the switch-over point.

### Developer builds

For local development you can install a build by hand: copy it to
`Apps/auram.photo/versions/<version>/` with a valid `auram-app.json`. Without `current.json` the
launcher picks the newest valid version and labels it _Manual installation_.

## 5. Launch environment

Applications are started detached, without a shell, with the version directory as the working
directory. `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and similar variables are removed from the
environment and `AURAM_LAUNCHER_VERSION` is set. If the process exits with a failure within
15 seconds, the launcher reports it to the user.

## 6. Projects

Applications that save projects should use the `.cproj` container described in
[project-format.md](project-format.md) so the launcher can list and open them.
