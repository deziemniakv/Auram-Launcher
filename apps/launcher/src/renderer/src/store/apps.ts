import { create } from 'zustand';
import type { AppView } from '../../../shared/ipc';
import { call } from '../lib/api';

interface AppsState {
  apps: AppView[];
  loaded: boolean;
  checking: boolean;
  load: () => Promise<void>;
  set: (apps: AppView[]) => void;
  refresh: () => Promise<void>;
  checkReleases: (appId?: string) => Promise<void>;
}

export const useAppsStore = create<AppsState>((set) => ({
  apps: [],
  loaded: false,
  checking: false,
  load: async () => {
    const apps = await call((api) => api.apps.list());
    set({ apps, loaded: true });
  },
  set: (apps) => set({ apps, loaded: true }),
  refresh: async () => {
    const apps = await call((api) => api.apps.refresh());
    set({ apps });
  },
  checkReleases: async (appId) => {
    set({ checking: true });
    try {
      const apps = await call((api) => api.apps.checkReleases(appId));
      set({ apps });
    } finally {
      set({ checking: false });
    }
  },
}));

export function useApp(appId: string): AppView | undefined {
  return useAppsStore((state) => state.apps.find((app) => app.id === appId));
}
