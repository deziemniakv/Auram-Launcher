import { create } from 'zustand';
import type { ToastMessage } from '@auram/ui';
import type { Section } from '../../../shared/constants';

interface UiState {
  section: Section;
  toasts: ToastMessage[];
  navigate: (section: Section) => void;
  toast: (toast: Omit<ToastMessage, 'id'>) => void;
  dismissToast: (id: string) => void;
}

let counter = 0;
const TOAST_TIMEOUT_MS = { info: 4000, success: 4000, error: 9000 } as const;

export const useUiStore = create<UiState>((set, get) => ({
  section: 'home',
  toasts: [],
  navigate: (section) => set({ section }),
  toast: (toast) => {
    const id = `toast-${++counter}`;
    // Keep the stack short; the oldest message makes room for the newest.
    set((state) => ({ toasts: [...state.toasts.slice(-3), { ...toast, id }] }));
    setTimeout(() => get().dismissToast(id), TOAST_TIMEOUT_MS[toast.tone]);
  },
  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

export const toast = (message: Omit<ToastMessage, 'id'>) => useUiStore.getState().toast(message);
