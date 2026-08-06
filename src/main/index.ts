// src/main/index.ts
import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { registerIpc, installLiveStoreQuitHook } from './ipc';

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
        const delay = Math.min(500 * attempt, 3000);
        setTimeout(() => tryLoad(attempt + 1), delay);
      });
    };
    tryLoad(1);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

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
