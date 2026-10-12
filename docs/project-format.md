# Auram project format (`.cproj`), version 1

A `.cproj` file is a ZIP archive owned by the application that created it. The launcher reads
only two entries and never modifies the file.

| Entry                                                | Required | Limit   | Purpose                       |
| ---------------------------------------------------- | -------- | ------- | ----------------------------- |
| `manifest.json`                                      | yes      | 256 KiB | Project metadata (below)      |
| `thumbnail.png` / `thumbnail.jpg` / `thumbnail.webp` | no       | 4 MiB   | Preview shown in the launcher |

Everything else in the archive (layers, assets, history…) is defined by the application.

## `manifest.json`

```json
{
  "format": "auram.project",
  "formatVersion": 1,
  "id": "0b6f1d2e-6a3c-4c1e-9f55-3c2c8f1b9a10",
  "name": "Festival Poster",
  "appId": "auram.photo",
  "appVersion": "0.1.0",
  "createdAt": "2026-09-01T10:00:00Z",
  "modifiedAt": "2026-09-02T18:30:00+02:00"
}
```

- `id`: a UUID that stays the same when the file is renamed or moved.
- `appId`: the application that opens the project (see the catalog).
- `createdAt` / `modifiedAt`: ISO 8601 timestamps with an offset, written by the application.
- Additional fields are allowed and preserved by tools that only read the manifest.

## How the launcher uses it

- **Recent projects**: projects opened through the launcher are remembered in
  `Launcher/recent-projects.json` (paths and last-opened time only).
- **Projects folder**: `.cproj` files directly in the configured folder and one level of
  subfolders are listed, newest first.
- **Display**: name, owning application, modification time and thumbnail come from the file.
  If the file cannot be read, the launcher shows it as unreadable instead of guessing.
- **Opening**: the launcher starts the owning application with the project path as described in
  [app-integration.md](app-integration.md). If the application is not installed, the user is told.

The schema is implemented in `packages/project-format`. Changes that are not backwards
compatible require a new `formatVersion`.
