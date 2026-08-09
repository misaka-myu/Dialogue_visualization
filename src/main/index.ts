// src/main/index.ts
import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { registerIpc, installLiveStoreQuitHook } from './ipc';
import { restoreAllDirty } from './configGuard';

// Disable GPU shader disk cache to prevent Windows file-lock errors (ERROR:cache_util_win.cc 0x5)
// when restarting Electron multiple times in development mode.
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    // In dev mode electron-vite may start Electron before Vite's HTTP server is
    // ready – retry with back-off until the renderer URL becomes reachable.
    const url = process.env.ELECTRON_RENDERER_URL;
    const tryLoad = (attempt: number): void => {
      win.loadURL(url).catch(() => {
        if (attempt >= 10) {
          console.error('[electron] Vite dev server failed to become reachable after 10 attempts.');
          return;
        }
        const delay = Math.min(500 * attempt, 3000);
        setTimeout(() => tryLoad(attempt + 1), delay);
      });
    };
    tryLoad(1);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// Startup-time self-heal: if a previous run crashed (or the OS killed
// us) mid-capture, the .dialogueviz-active marker is still in place
// and the user's settings.json / config.toml is pointing at a dead
// localhost proxy. Restore before the renderer comes up so the UI
// never observes the polluted state and the CLI tools stay usable.
restoreAllDirty();

app.whenReady().then(() => {
  installLiveStoreQuitHook();
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
