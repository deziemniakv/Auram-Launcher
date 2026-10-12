import { app, BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { colors, layout } from '@auram/design-tokens';
import { z } from 'zod';
import { readJsonFile, writeJsonAtomic } from './services/fs-utils';
import type { Logger } from './services/logger';

const WindowStateSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().min(400),
  height: z.number().int().min(300),
  maximized: z.boolean(),
});
type WindowState = z.infer<typeof WindowStateSchema>;

const MIN_WIDTH = 960;
const MIN_HEIGHT = 600;

async function loadWindowState(file: string): Promise<WindowState | null> {
  const read = await readJsonFile(file, 16 * 1024).catch(() => null);
  if (!read || read.kind !== 'ok') return null;
  const parsed = WindowStateSchema.safeParse(read.value);
  if (!parsed.success) return null;
  // Ignore saved bounds that no longer intersect a connected display.
  const visible = screen.getAllDisplays().some(({ workArea }) => {
    const s = parsed.data;
    return (
      s.x < workArea.x + workArea.width &&
      s.x + s.width > workArea.x &&
      s.y < workArea.y + workArea.height &&
      s.y + s.height > workArea.y
    );
  });
  return visible ? parsed.data : null;
}

export async function createMainWindow(options: {
  stateFile: string;
  logger: Logger;
  zoomFactor: number;
}): Promise<BrowserWindow> {
  const state = await loadWindowState(options.stateFile);

  const window = new BrowserWindow({
    width: state?.width ?? 1280,
    height: state?.height ?? 800,
    x: state?.x,
    y: state?.y,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    title: 'Auram Launcher',
    backgroundColor: colors.bg,
    titleBarStyle: 'hidden',
    titleBarOverlay:
      process.platform === 'darwin'
        ? undefined
        : {
            color: colors.surface0,
            symbolColor: colors.textSecondary,
            height: layout.topbarHeight - 1,
          },
    trafficLightPosition: { x: 14, y: 12 },
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });

  if (state?.maximized) window.maximize();

  window.once('ready-to-show', () => {
    if (!process.env.AURAM_HIDE_WINDOW) window.show();
  });
  window.webContents.on('did-finish-load', () => {
    window.webContents.setZoomFactor(options.zoomFactor);
  });
  // Recover from renderer crashes, but never loop if the page crashes on load.
  let reloads = 0;
  window.webContents.on('render-process-gone', (_event, details) => {
    options.logger.error('window', 'Renderer process gone', details);
    if (details.reason !== 'clean-exit' && !window.isDestroyed() && reloads < 3) {
      reloads++;
      window.reload();
    }
  });

  window.on('close', () => {
    const bounds = window.getNormalBounds();
    void writeJsonAtomic(options.stateFile, { ...bounds, maximized: window.isMaximized() }).catch(
      (error: unknown) => options.logger.warn('window', 'Could not save window state', error),
    );
  });

  const devServerUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
  if (devServerUrl) await window.loadURL(devServerUrl);
  else await window.loadFile(path.join(__dirname, '../renderer/index.html'));
  return window;
}
