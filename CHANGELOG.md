# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - Unreleased

First development version.

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
