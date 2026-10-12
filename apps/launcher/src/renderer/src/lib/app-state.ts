import type { AppView } from '../../../shared/ipc';
import type { Tone } from '@auram/ui';

export type AppStatusKey =
  | 'installed'
  | 'running'
  | 'notInstalled'
  | 'available'
  | 'updateAvailable'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'updating'
  | 'uninstalling'
  | 'failed'
  | 'inDevelopment'
  | 'planned'
  | 'needsAttention';

export type PrimaryAction =
  | { kind: 'open' }
  | { kind: 'install' }
  | { kind: 'update'; version: string }
  | { kind: 'cancel' }
  | { kind: 'retry' }
  | { kind: 'busy' }
  | { kind: 'unavailable' };

export interface AppDisplayState {
  status: AppStatusKey;
  tone: Tone;
  primary: PrimaryAction;
  /** 0..1 while downloading, null for indeterminate phases, undefined when idle. */
  progress?: number | null;
}

/**
 * Maps the real application state reported by the main process to what the
 * UI shows. Pure, so every combination is covered by unit tests.
 */
export function deriveAppState(app: AppView): AppDisplayState {
  const op = app.operation;
  const release = app.release;
  const updating = app.installed !== null;

  if (op) {
    switch (op.phase) {
      case 'downloading':
        return {
          status: updating ? 'updating' : 'downloading',
          tone: 'info',
          primary: { kind: 'cancel' },
          progress: op.totalBytes > 0 ? op.receivedBytes / op.totalBytes : null,
        };
      case 'verifying':
        return { status: 'verifying', tone: 'info', primary: { kind: 'cancel' }, progress: null };
      case 'installing':
        return {
          status: updating ? 'updating' : 'installing',
          tone: 'info',
          primary: { kind: 'busy' },
          progress: null,
        };
      case 'uninstalling':
        return { status: 'uninstalling', tone: 'info', primary: { kind: 'busy' }, progress: null };
      case 'failed': {
        const canRetry = op.kind !== 'uninstall';
        return {
          status: 'failed',
          tone: 'danger',
          primary: canRetry
            ? { kind: 'retry' }
            : app.installed?.launchable
              ? { kind: 'open' }
              : { kind: 'unavailable' },
        };
      }
    }
  }

  if (app.installed) {
    const update =
      release.state === 'resolved' && release.resolution === 'update-available'
        ? release.version
        : null;
    if (!app.installed.launchable) {
      return {
        status: 'needsAttention',
        tone: 'warning',
        primary: update ? { kind: 'update', version: update } : { kind: 'unavailable' },
      };
    }
    if (app.running) return { status: 'running', tone: 'success', primary: { kind: 'open' } };
    if (update) return { status: 'updateAvailable', tone: 'warning', primary: { kind: 'open' } };
    return { status: 'installed', tone: 'success', primary: { kind: 'open' } };
  }

  if (release.state === 'resolved' && release.resolution === 'not-installed-available') {
    return { status: 'available', tone: 'neutral', primary: { kind: 'install' } };
  }
  if (app.availability === 'planned')
    return { status: 'planned', tone: 'neutral', primary: { kind: 'unavailable' } };
  if (app.availability === 'in-development') {
    return { status: 'inDevelopment', tone: 'neutral', primary: { kind: 'unavailable' } };
  }
  return { status: 'notInstalled', tone: 'neutral', primary: { kind: 'unavailable' } };
}

export function hasUpdate(app: AppView): boolean {
  return (
    app.installed !== null &&
    app.release.state === 'resolved' &&
    app.release.resolution === 'update-available' &&
    (app.operation === null || app.operation.phase === 'failed')
  );
}
