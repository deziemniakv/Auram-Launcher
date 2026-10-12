import { describe, expect, it } from 'vitest';
import type { AppView, ReleaseStatus } from '../../../shared/ipc';
import { deriveAppState, hasUpdate } from './app-state';

function app(overrides: Partial<AppView> = {}): AppView {
  return {
    id: 'auram.photo',
    name: 'Auram Photo',
    description: 'Photo editing',
    descriptionTranslations: {},
    category: 'photo',
    availability: 'in-development',
    homepage: null,
    projectExtensions: ['.cproj'],
    installed: null,
    release: { state: 'not-checked' },
    operation: null,
    running: false,
    ...overrides,
  };
}

const installed = {
  version: '1.0.0',
  installedAt: null,
  source: 'release' as const,
  launchable: true,
  problem: null,
};

function resolved(
  resolution: Extract<ReleaseStatus, { state: 'resolved' }>['resolution'],
  version = '1.1.0',
): ReleaseStatus {
  return {
    state: 'resolved',
    checkedAt: '2026-01-01T00:00:00Z',
    version,
    channel: 'stable',
    releasedAt: '2026-01-01T00:00:00Z',
    notes: { summary: null, body: null, url: null },
    downloadSize: 100,
    resolution,
    minLauncherVersion: '0.1.0',
  };
}

describe('deriveAppState', () => {
  it('never offers an action for apps without a published release', () => {
    expect(deriveAppState(app())).toMatchObject({
      status: 'inDevelopment',
      primary: { kind: 'unavailable' },
    });
    expect(deriveAppState(app({ availability: 'planned' }))).toMatchObject({
      status: 'planned',
      primary: { kind: 'unavailable' },
    });
    expect(
      deriveAppState(app({ release: { state: 'no-release', checkedAt: 'x' } })).primary.kind,
    ).toBe('unavailable');
  });

  it('offers installation only when a verified release resolves for this system', () => {
    expect(deriveAppState(app({ release: resolved('not-installed-available') }))).toMatchObject({
      status: 'available',
      primary: { kind: 'install' },
    });
    expect(deriveAppState(app({ release: resolved('no-compatible-artifact') })).primary.kind).toBe(
      'unavailable',
    );
    expect(deriveAppState(app({ release: resolved('requires-newer-launcher') })).primary.kind).toBe(
      'unavailable',
    );
  });

  it('opens installed applications and flags available updates', () => {
    expect(deriveAppState(app({ installed }))).toMatchObject({
      status: 'installed',
      primary: { kind: 'open' },
    });
    expect(deriveAppState(app({ installed, running: true })).status).toBe('running');
    expect(deriveAppState(app({ installed, release: resolved('update-available') })).status).toBe(
      'updateAvailable',
    );
    expect(hasUpdate(app({ installed, release: resolved('update-available') }))).toBe(true);
    expect(hasUpdate(app({ installed, release: resolved('up-to-date') }))).toBe(false);
  });

  it('does not offer to open broken installations', () => {
    const broken = { ...installed, launchable: false, problem: 'The executable is missing.' };
    expect(deriveAppState(app({ installed: broken }))).toMatchObject({
      status: 'needsAttention',
      primary: { kind: 'unavailable' },
    });
    expect(
      deriveAppState(app({ installed: broken, release: resolved('update-available') })).primary,
    ).toEqual({
      kind: 'update',
      version: '1.1.0',
    });
  });

  it('reflects real operation phases and progress', () => {
    const downloading = deriveAppState(
      app({
        operation: {
          phase: 'downloading',
          kind: 'install',
          version: '1.0.0',
          receivedBytes: 25,
          totalBytes: 100,
        },
      }),
    );
    expect(downloading).toMatchObject({
      status: 'downloading',
      primary: { kind: 'cancel' },
      progress: 0.25,
    });

    const updating = deriveAppState(
      app({ installed, operation: { phase: 'installing', kind: 'update', version: '1.1.0' } }),
    );
    expect(updating).toMatchObject({
      status: 'updating',
      primary: { kind: 'busy' },
      progress: null,
    });

    const failed = deriveAppState(
      app({
        operation: {
          phase: 'failed',
          kind: 'install',
          version: '1.0.0',
          code: 'integrity',
          message: 'bad',
          at: 'x',
        },
      }),
    );
    expect(failed).toMatchObject({ status: 'failed', tone: 'danger', primary: { kind: 'retry' } });
  });
});
