import { create } from 'zustand';
import type {
  DirectoryKind,
  LauncherInfo,
  LauncherUpdateStatus,
  SettingsSnapshot,
} from '../../../shared/ipc';
import type { SettingsPatch } from '../../../shared/settings';
import { call } from '../lib/api';

interface SettingsState {
  info: LauncherInfo | null;
  snapshot: SettingsSnapshot | null;
  launcherUpdate: LauncherUpdateStatus;
  load: () => Promise<void>;
  update: (patch: SettingsPatch) => Promise<void>;
  chooseDirectory: (kind: DirectoryKind) => Promise<void>;
  resetDirectory: (kind: DirectoryKind) => Promise<void>;
  checkLauncherUpdate: () => Promise<void>;
  setLauncherUpdate: (status: LauncherUpdateStatus) => void;
}

/** Applies a patch locally so controls respond instantly; the main process stays authoritative. */
function applyPatch(snapshot: SettingsSnapshot, patch: SettingsPatch): SettingsSnapshot {
  const current = snapshot.settings;
  return {
    ...snapshot,
    settings: {
      ...current,
      language: patch.language ?? current.language,
      appearance: { ...current.appearance, ...patch.appearance },
      startup: { ...current.startup, ...patch.startup },
      updates: { ...current.updates, ...patch.updates },
      diagnostics: { ...current.diagnostics, ...patch.diagnostics },
    },
  };
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  info: null,
  snapshot: null,
  launcherUpdate: { state: 'not-checked' },
  load: async () => {
    const [info, snapshot, launcherUpdate] = await Promise.all([
      call((api) => api.launcher.info()),
      call((api) => api.settings.get()),
      call((api) => api.launcher.updateStatus()),
    ]);
    set({ info, snapshot, launcherUpdate });
  },
  update: async (patch) => {
    const previous = get().snapshot;
    if (previous) set({ snapshot: applyPatch(previous, patch) });
    try {
      const snapshot = await call((api) => api.settings.update(patch));
      set({ snapshot });
    } catch (error) {
      if (previous) set({ snapshot: previous });
      throw error;
    }
  },
  chooseDirectory: async (kind) => {
    const snapshot = await call((api) => api.settings.chooseDirectory(kind));
    if (snapshot) {
      const info = await call((api) => api.launcher.info());
      set({ snapshot, info });
    }
  },
  resetDirectory: async (kind) => {
    const snapshot = await call((api) => api.settings.resetDirectory(kind));
    const info = await call((api) => api.launcher.info());
    set({ snapshot, info });
  },
  checkLauncherUpdate: async () => {
    set({ launcherUpdate: { state: 'checking' } });
    const launcherUpdate = await call((api) => api.launcher.checkForUpdate());
    set({ launcherUpdate });
  },
  setLauncherUpdate: (launcherUpdate) => set({ launcherUpdate }),
}));
