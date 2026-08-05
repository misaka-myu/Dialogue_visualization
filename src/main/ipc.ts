// src/main/ipc.ts
import { ipcMain, dialog, BrowserWindow } from 'electron';
import { scanClaudeSessions, loadClaudeSession, SessionMeta } from './adapters/claude-log';
import { join } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { Session } from './model/types';
import { startProxyServer, ProxyServer } from './proxy/server';

function claudeProjectsDir(): string {
  return join(homedir(), '.claude', 'projects');
}

function claudeSettingsPath(): string {
  return join(homedir(), '.claude', 'settings.json');
}

let proxyServer: ProxyServer | null = null;
let savedBaseUrl: string | undefined | null = null;  // null = not captured yet; undefined = key absent

export function registerIpc(): void {
  ipcMain.handle('sessions:list', async (): Promise<SessionMeta[]> => {
    return scanClaudeSessions(claudeProjectsDir());
  });

  ipcMain.handle('sessions:load', async (_e, sourcePath: string): Promise<Session | null> => {
    try {
      return loadClaudeSession(sourcePath);
    } catch {
      return null;
    }
  });

  ipcMain.handle('proxy:start', async (): Promise<{ port: number; upstream: string } | null> => {
    if (proxyServer) {
      return { port: proxyServer.port, upstream: proxyServer.upstream };
    }
    try {
      // Read original ANTHROPIC_BASE_URL from settings.json BEFORE rewriting.
      const settingsPath = claudeSettingsPath();
      let upstream = 'https://api.anthropic.com';
      let settings: any = {};
      if (existsSync(settingsPath)) {
        try {
          settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
          const env = settings.env ?? (settings.env = {});
          if (typeof env.ANTHROPIC_BASE_URL === 'string') {
            savedBaseUrl = env.ANTHROPIC_BASE_URL;
            upstream = env.ANTHROPIC_BASE_URL;
          } else {
            savedBaseUrl = undefined;
          }
        } catch { /* corrupt settings - leave as-is */ }
      }

      // Start proxy first (with the original upstream), so it's ready when claude connects.
      proxyServer = await startProxyServer(8787, upstream);
      proxyServer.onCaptured((apiRequest) => {
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
          windows[0].webContents.send('proxy:live-update', apiRequest);
        }
      });

      // Rewrite settings.json to point claude at our proxy.
      const proxyUrl = `http://localhost:${proxyServer.port}`;
      settings.env = settings.env ?? {};
      settings.env.ANTHROPIC_BASE_URL = proxyUrl;
      try {
        writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      } catch (err) {
        console.error('[proxy] failed to rewrite settings.json:', err);
      }

      return { port: proxyServer.port, upstream: proxyServer.upstream };
    } catch (err) {
      console.error('[proxy] failed to start:', err);
      return null;
    }
  });

  ipcMain.handle('proxy:stop', async (): Promise<void> => {
    if (proxyServer) {
      await proxyServer.stop();
      proxyServer = null;
    }
    // Restore settings.json to original state.
    if (savedBaseUrl !== null) {
      const settingsPath = claudeSettingsPath();
      if (existsSync(settingsPath)) {
        try {
          const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
          if (settings.env) {
            if (savedBaseUrl === undefined) {
              delete settings.env.ANTHROPIC_BASE_URL;
            } else {
              settings.env.ANTHROPIC_BASE_URL = savedBaseUrl;
            }
            writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
          }
        } catch (err) {
          console.error('[proxy] failed to restore settings.json:', err);
        }
      }
      savedBaseUrl = null;
    }
  });

  ipcMain.handle('proxy:launch-claude', async (_e, port: number): Promise<{ pid: number } | null> => {
    const env = {
      ...process.env,
      ANTHROPIC_BASE_URL: `http://localhost:${port}`,
    };
    try {
      // Open a new console window running `claude` so the user can interact with it.
      // The new window inherits `env` (carrying ANTHROPIC_BASE_URL).
      // On Windows: `start "title" cmd /k claude` opens a persistent cmd window.
      const child = spawn('cmd', ['/c', 'start', 'DialogueViz-Capture', 'cmd', '/k', 'claude'], { env, shell: false });
      return { pid: child.pid ?? -1 };
    } catch (err) {
      console.error('[proxy] failed to launch claude:', err);
      return null;
    }
  });
}
