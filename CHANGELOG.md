# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.1] - 2026-10-13

First public release. It contains everything listed under 0.1.0, which was never published,
plus the changes below.

### Changed

- Releases are built, tagged and published from **Actions → Release → Run workflow**. Each
  release includes `SHA256SUMS.txt`, and a draft is published only after its installer matches
  that checksum.

### Fixed

- Installing an application failed with "Invalid package …\\resources\\app.asar". Electron treats
  `*.asar` files as archives in its patched `fs`; the launcher now uses Electron's unpatched
  `original-fs` for all file operations, so Electron-based applications such as Auram Photo
  install, update and uninstall correctly.
- Staging folders left behind by an interrupted installation are removed on the next install.

## [0.1.0] - Not released

First development version, only distributed as CI builds.

### Added

- Electron launcher with Home, Applications, Projects, Updates and Settings sections.
- Sandboxed renderer with a typed, validated IPC bridge.
- Application catalog (Auram Photo in development; Video, Motion and 3D planned).
- Discovery and launching of installed applications, including manual developer builds.
- Release discovery from GitHub Releases with validated release manifests.
- Install and update pipeline: download, size and SHA-256 verification, staged extraction,
  descriptor validation and atomic activation, with cancellation and retry.
- Project discovery for `.cproj` containers, recent projects, thumbnails.
- Persistent settings with corruption recovery; English and Polish interface.
- Rotating file logs.
- Design tokens and reusable UI components with square geometry.
- Windows NSIS packaging, CI and release workflows.
