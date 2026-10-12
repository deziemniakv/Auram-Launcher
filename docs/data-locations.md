# Data locations

The launcher keeps machine-local data, user content and Chromium's own profile apart.

## Windows

```
%LOCALAPPDATA%\Auram\
  Launcher\
    settings.json            user settings (validated on load)
    settings.corrupt-*.json  backups of unreadable settings files, if any
    recent-projects.json     recently opened projects (paths only)
    window-state.json        window size and position
    logs\launcher.log        current log (rotated at 1 MiB, 5 old files kept)
    cache\releases.json      last known release information
    cache\electron\          Chromium profile data used by Electron
  Apps\                      installed applications (configurable in Settings)
    auram.photo\
      current.json
      versions\<version>\
  Downloads\                 temporary artifact downloads (removed after each operation)

%USERPROFILE%\Documents\Auram\
  Projects\                  default projects folder (configurable in Settings)
```

`%LOCALAPPDATA%` is used instead of the roaming profile because installed applications and
caches are large and machine-specific.

## macOS and Linux (development)

|           | macOS                                 | Linux                                                   |
| --------- | ------------------------------------- | ------------------------------------------------------- |
| Data root | `~/Library/Application Support/Auram` | `$XDG_DATA_HOME/Auram` (default `~/.local/share/Auram`) |
| Projects  | `~/Documents/Auram/Projects`          | `~/Documents/Auram/Projects`                            |

## Overrides

`AURAM_DATA_DIR` replaces the data root and `AURAM_DOCUMENTS_DIR` replaces the documents folder.
They exist for development and automated tests.

## What is deleted, and when

- **Uninstalling an application** removes `Apps/<id>` only, after confirmation. Projects are never
  touched.
- **Uninstalling the launcher** (NSIS) removes the program files. Settings, installed applications
  and projects stay in place.
- **Changing the application storage folder** does not move existing installations.
- Partial downloads and staging folders are removed automatically after success or failure.
