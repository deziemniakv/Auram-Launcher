import { describe, expect, it } from 'vitest';
import { resolveAuramPaths } from './paths';

describe('resolveAuramPaths', () => {
  it('uses %LOCALAPPDATA% and Documents on Windows', () => {
    const paths = resolveAuramPaths({
      platform: 'win32',
      env: { LOCALAPPDATA: 'C:\\Users\\Ada\\AppData\\Local' },
      homeDir: 'C:\\Users\\Ada',
      documentsDir: 'C:\\Users\\Ada\\Documents',
    });
    expect(paths.dataRoot).toBe('C:\\Users\\Ada\\AppData\\Local\\Auram');
    expect(paths.settingsFile).toBe(
      'C:\\Users\\Ada\\AppData\\Local\\Auram\\Launcher\\settings.json',
    );
    expect(paths.logsDir).toBe('C:\\Users\\Ada\\AppData\\Local\\Auram\\Launcher\\logs');
    expect(paths.defaultAppsDir).toBe('C:\\Users\\Ada\\AppData\\Local\\Auram\\Apps');
    expect(paths.downloadsDir).toBe('C:\\Users\\Ada\\AppData\\Local\\Auram\\Downloads');
    expect(paths.defaultProjectsDir).toBe('C:\\Users\\Ada\\Documents\\Auram\\Projects');
  });

  it('falls back to the profile when LOCALAPPDATA is missing', () => {
    const paths = resolveAuramPaths({
      platform: 'win32',
      env: {},
      homeDir: 'C:\\Users\\Ada',
      documentsDir: 'D:\\Docs',
    });
    expect(paths.dataRoot).toBe('C:\\Users\\Ada\\AppData\\Local\\Auram');
  });

  it('follows platform conventions on macOS and Linux', () => {
    expect(
      resolveAuramPaths({
        platform: 'darwin',
        env: {},
        homeDir: '/Users/ada',
        documentsDir: '/Users/ada/Documents',
      }).dataRoot,
    ).toBe('/Users/ada/Library/Application Support/Auram');
    expect(
      resolveAuramPaths({
        platform: 'linux',
        env: {},
        homeDir: '/home/ada',
        documentsDir: '/home/ada/Documents',
      }).dataRoot,
    ).toBe('/home/ada/.local/share/Auram');
    expect(
      resolveAuramPaths({
        platform: 'linux',
        env: { XDG_DATA_HOME: '/data' },
        homeDir: '/home/ada',
        documentsDir: '/d',
      }).dataRoot,
    ).toBe('/data/Auram');
  });

  it('honours development overrides', () => {
    const paths = resolveAuramPaths({
      platform: 'linux',
      env: { AURAM_DATA_DIR: '/tmp/a', AURAM_DOCUMENTS_DIR: '/tmp/b' },
      homeDir: '/home/ada',
      documentsDir: '/home/ada/Documents',
    });
    expect(paths.dataRoot).toBe('/tmp/a');
    expect(paths.defaultProjectsDir).toBe('/tmp/b/Auram/Projects');
  });
});
