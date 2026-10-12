import { spawn } from 'node:child_process';
import { LauncherError, errorMessage } from './errors';
import type { InstalledApp } from './installed-apps';

/** Environment variables that must not leak from the launcher into child apps. */
const STRIPPED_ENV = [
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ATTACH_CONSOLE',
  'NODE_OPTIONS',
  'NODE_CHANNEL_FD',
];

export function childEnvironment(
  base: NodeJS.ProcessEnv,
  launcherVersion: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const key of STRIPPED_ENV) delete env[key];
  env.AURAM_LAUNCHER_VERSION = launcherVersion;
  return env;
}

export function buildLaunchArguments(app: InstalledApp, projectPath?: string): string[] {
  if (!projectPath) return [];
  const mode = app.descriptor?.openProjectArgument ?? 'positional';
  return mode === 'positional' ? [projectPath] : [mode, projectPath];
}

export interface LaunchedProcess {
  pid: number | undefined;
  /** Resolves when the process exits. */
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null; uptimeMs: number }>;
}

/**
 * Starts an installed application as an independent process. No shell is
 * involved; the executable comes from a validated descriptor inside the
 * installation directory and arguments are passed as an array.
 */
export function launchInstalledApp(
  app: InstalledApp,
  options: { projectPath?: string; launcherVersion: string },
): Promise<LaunchedProcess> {
  if (!app.executablePath) {
    throw new LauncherError(
      'launch-failed',
      app.problem ?? 'This application cannot be started on this system.',
    );
  }
  const executable = app.executablePath;
  const args = buildLaunchArguments(app, options.projectPath);

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(executable, args, {
        cwd: app.versionDir,
        detached: true,
        shell: false,
        stdio: 'ignore',
        windowsHide: false,
        env: childEnvironment(process.env, options.launcherVersion),
      });
    } catch (error) {
      reject(
        new LauncherError(
          'launch-failed',
          `Could not start the application: ${errorMessage(error)}`,
          { cause: error },
        ),
      );
      return;
    }

    const exited = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
      uptimeMs: number;
    }>((resolveExit) => {
      child.once('exit', (code, signal) =>
        resolveExit({ code, signal, uptimeMs: Date.now() - startedAt }),
      );
    });

    child.once('error', (error) => {
      reject(
        new LauncherError('launch-failed', `Could not start the application: ${error.message}`, {
          cause: error,
        }),
      );
    });
    child.once('spawn', () => {
      child.unref();
      resolve({ pid: child.pid, exited });
    });
  });
}
