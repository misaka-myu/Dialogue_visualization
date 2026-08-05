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

/** Durable storage for the REAL original upstream, so we can recover if
 *  settings.json was polluted (left pointing at a previous proxy) by a
 *  capture that wasn't stopped. */
function storedUpstreamPath(): string {
  return join(homedir(), '.claude', '.dialogueviz-upstream');
}

function readStoredUpstream(): string | null {
  try {
    if (existsSync(storedUpstreamPath())) {
      const v = readFileSync(storedUpstreamPath(), 'utf-8').trim();
      return v || null;
    }
  } catch { /* ignore */ }
  return null;
}

function writeStoredUpstream(url: string): void {
  try { writeFileSync(storedUpstreamPath(), url); } catch { /* ignore */ }
}

function isLocalhostUrl(u: string): boolean {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u);
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
      // Determine the REAL original upstream BEFORE rewriting settings.json.
      // If settings.json is already pointing at a localhost proxy (left over
      // from a previous capture that wasn't stopped), recover the real original
      // from durable storage instead of using the stale localhost URL.
      const settingsPath = claudeSettingsPath();
      let settings: any = {};
      let currentBaseUrl: string | undefined;
      if (existsSync(settingsPath)) {
        try {
          settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
          settings.env = settings.env ?? {};
          if (typeof settings.env.ANTHROPIC_BASE_URL === 'string') {
            currentBaseUrl = settings.env.ANTHROPIC_BASE_URL;
          }
        } catch { /* corrupt settings - leave as-is */ }
      }

      let upstream: string;
      if (currentBaseUrl && !isLocalhostUrl(currentBaseUrl)) {
        // Clean real upstream - use it and persist for future recovery.
        upstream = currentBaseUrl;
        writeStoredUpstream(currentBaseUrl);
      } else {
        // Polluted (localhost) or absent - recover from durable storage, else default.
        const stored = readStoredUpstream();
        upstream = stored ?? 'https://api.anthropic.com';
      }
      savedBaseUrl = upstream;

      // Start proxy with the real upstream.
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
    // Restore settings.json to the REAL original upstream (savedBaseUrl).
    if (savedBaseUrl !== null) {
      const settingsPath = claudeSettingsPath();
      if (existsSync(settingsPath)) {
        try {
          const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
          settings.env = settings.env ?? {};
          if (savedBaseUrl === undefined) {
            delete settings.env.ANTHROPIC_BASE_URL;
          } else {
            settings.env.ANTHROPIC_BASE_URL = savedBaseUrl;
          }
          writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
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
