# Security policy

## Reporting a vulnerability

Please report vulnerabilities **privately** using GitHub's
[private vulnerability reporting](https://github.com/deziemniakv/Auram-Launcher/security/advisories/new)
for this repository. Do not open public issues for security problems.

Include the affected version, steps to reproduce, and the impact you expect. We aim to
acknowledge reports within seven days and will keep you informed while a fix is prepared.

## Supported versions

The project is in early development. Security fixes are made on `main` and shipped in the next
release; older releases are not patched.

## Security model (summary)

- The renderer runs with `contextIsolation`, `sandbox` and without Node.js integration. It can
  only call a fixed, typed API exposed by the preload script.
- Every IPC call is checked against the sending frame and validated with Zod in the main process.
- Navigation, new windows, `<webview>` and permission requests are blocked. External links open
  in the browser only for allow-listed HTTPS hosts.
- Release metadata and artifacts are downloaded only over HTTPS from GitHub Releases hosts,
  including after redirects. Artifacts must match the size and SHA-256 digest in the release
  manifest; archives are rejected if they contain path traversal, absolute paths or symlinks.
- Nothing from a downloaded package is executed during installation. Applications are started
  without a shell, from an executable path declared in their validated descriptor.
- Packaged builds disable `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and inspector flags via
  Electron fuses and validate `app.asar` integrity.

Known limitations, tracked for future work:

- Release manifests are trusted on the basis of HTTPS and GitHub; they are not yet
  cryptographically signed by the publisher.
- Windows installers are not yet code-signed.

See [docs/architecture.md](docs/architecture.md) for details.
