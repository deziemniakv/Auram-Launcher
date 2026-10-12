import { create } from 'zustand';
import type { ProjectsSnapshot } from '../../../shared/ipc';
import { call, messageOf } from '../lib/api';

interface ProjectsState {
  snapshot: ProjectsSnapshot | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  setSnapshot: (snapshot: ProjectsSnapshot) => void;
}

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  snapshot: null,
  loading: false,
  error: null,
  load: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const snapshot = await call((api) => api.projects.list());
      set({ snapshot, loading: false });
    } catch (error) {
      set({ error: messageOf(error), loading: false });
    }
  },
  setSnapshot: (snapshot) => set({ snapshot, error: null }),
}));
