// src/main/ipc.ts
import { ipcMain, dialog, BrowserWindow, app } from 'electron';
import { scanClaudeSessions, loadClaudeSession, deleteClaudeSession, exportClaudeSession, SessionMeta } from './adapters/claude-log';
import { join } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { ApiRequest, Session } from './model/types';
import { startProxyServer, ProxyServer } from './proxy/server';
import { PersistentLiveStore, LiveMeta, generateLiveFileName, LIVE_FILE_WARN_BYTES } from './store/persistent-store';

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

/** Durable storage for the shared-secret used to authenticate capture
 *  requests. Mirrors the durable-upstream pattern: persisted next to the
 *  upstream file so we don't regenerate (and orphan old captures') keys on
 *  every restart. */
function storedSecretPath(): string {
  return join(homedir(), '.claude', '.dialogueviz-secret');
}

function readStoredSecret(): string | null {
  try {
    if (existsSync(storedSecretPath())) {
      const v = readFileSync(storedSecretPath(), 'utf-8').trim();
      return v || null;
    }
  } catch { /* ignore */ }
  return null;
}

function writeStoredSecret(secret: string): void {
  try { writeFileSync(storedSecretPath(), secret); } catch { /* ignore */ }
}

function isLocalhostUrl(u: string): boolean {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u);
}

let proxyServer: ProxyServer | null = null;
let savedBaseUrl: string | undefined | null = null;  // null = not captured yet; undefined = key absent

// --- Live-capture persistence state (module scope; single capture at a time) ---
let liveStore: PersistentLiveStore | null = null;
interface LiveRuntime {
  session: Session;
  /** Absolute file path the session is being persisted to (stable for the
   *  duration of a capture so successive saves overwrite the same file). */
  path: string;
  /** Trailing-edge debounce timer for batched writes. */
  saveTimer: NodeJS.Timeout | null;
  /** Last known file size in bytes — used to warn when a file grows large. */
  lastSize: number;
}
let liveRuntime: LiveRuntime | null = null;
const SAVE_DEBOUNCE_MS = 500;

function ensureLiveStore(): PersistentLiveStore {
  if (!liveStore) liveStore = new PersistentLiveStore(claudeProjectsDir());
  return liveStore;
}

/** Apply `req` to the in-memory live session, then schedule a debounced save. */
function pushCapturedRequest(req: ApiRequest): void {
  const rt = liveRuntime;
  if (!rt) return;
  const requests = [...rt.session.requests, req];
  let conversation = rt.session.conversation;
  if (req.inputMessages && req.inputMessages.length > 0) {
    conversation = [...req.inputMessages];
    if (req.response) {
      const u = req.response.usage;
      conversation = [
        ...conversation,
        {
          role: 'assistant',
          content: req.response.content,
          meta: {
            outputTokens: u?.outputTokens || undefined,
            model: u?.model,
          },
        },
      ];
    }
  }
  rt.session = { ...rt.session, requests, conversation };
  scheduleLiveSave();
}

function scheduleLiveSave(): void {
  const rt = liveRuntime;
  if (!rt) return;
  if (rt.saveTimer) clearTimeout(rt.saveTimer);
  rt.saveTimer = setTimeout(() => {
    rt.saveTimer = null;
    flushLiveSave();
  }, SAVE_DEBOUNCE_MS);
}

/** Write the current live session to disk synchronously. Safe to call from
 *  before-quit: clear any pending debounce first so we don't race the timer. */
function flushLiveSave(): void {
  const rt = liveRuntime;
  if (!rt) return;
  if (rt.saveTimer) {
    clearTimeout(rt.saveTimer);
    rt.saveTimer = null;
  }
  // Skip persistence if nothing was actually captured. If a previous save
  // already created the file, remove it so the empty capture doesn't linger.
  if (rt.session.requests.length === 0 && rt.session.conversation.length === 0) {
    try {
      const { existsSync, unlinkSync } = require('fs') as typeof import('fs');
      if (existsSync(rt.path)) unlinkSync(rt.path);
    } catch { /* best-effort */ }
    return;
  }
  try {
    const store = ensureLiveStore();
    store.saveSessionAtPath(rt.session, rt.path);
    try {
      const { statSync } = require('fs') as typeof import('fs');
      rt.lastSize = statSync(rt.path).size;
      if (rt.lastSize > LIVE_FILE_WARN_BYTES) {
        console.warn(`[live-store] file ${rt.path} is ${rt.lastSize} bytes (>${LIVE_FILE_WARN_BYTES}); consider rotating.`);
      }
    } catch { /* size probe is best-effort */ }
  } catch (err) {
    console.error('[live-store] save failed:', err);
  }
}

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

  // --- Live capture history IPC ---
  ipcMain.handle('live:list', async (): Promise<LiveMeta[]> => {
    try {
      return ensureLiveStore().listSessions();
    } catch (err) {
      console.error('[live-store] list failed:', err);
      return [];
    }
  });

  ipcMain.handle('live:load', async (_e, path: string): Promise<Session | null> => {
    return ensureLiveStore().loadSession(path);
  });

  ipcMain.handle('live:save', async (_e, session: Session): Promise<string> => {
    const store = ensureLiveStore();
    // Overwrite the current capture's file if one is active for this session.
    if (liveRuntime && liveRuntime.session.id === session.id) {
      const next: Session = { ...session, endedAt: session.endedAt ?? Date.now() };
      liveRuntime.session = next;
      store.saveSessionAtPath(next, liveRuntime.path);
      return liveRuntime.path;
    }
    // Otherwise treat as a new save with a fresh path.
    return store.saveSession(session);
  });

  ipcMain.handle('live:delete', async (_e, path: string): Promise<boolean> => {
    return ensureLiveStore().deleteSession(path);
  });

  ipcMain.handle('live:rename', async (_e, path: string, newTitle: string): Promise<string | null> => {
    try {
      return ensureLiveStore().renameSession(path, newTitle);
    } catch (err) {
      console.error('[live-store] rename failed:', err);
      return null;
    }
  });

  ipcMain.handle('live:export', async (_e, path: string, exportPath: string): Promise<string | null> => {
    try {
      return ensureLiveStore().exportSession(path, exportPath);
    } catch (err) {
      console.error('[live-store] export failed:', err);
      return null;
    }
  });

  // --- Claude Code history (destructive) IPC ---
  ipcMain.handle('claude:delete', async (_e, sourcePath: string): Promise<boolean> => {
    try {
      return deleteClaudeSession(sourcePath);
    } catch (err) {
      console.error('[claude-log] delete failed:', err);
      return false;
    }
  });

  ipcMain.handle('claude:export', async (_e, sourcePath: string, exportPath: string): Promise<string | null> => {
    try {
      return exportClaudeSession(sourcePath, exportPath);
    } catch (err) {
      console.error('[claude-log] export failed:', err);
      return null;
    }
  });

  ipcMain.handle('claude:pickExportPath', async (_e, defaultName: string): Promise<string | null> => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows[0];
    const res = win
      ? await dialog.showSaveDialog(win, { title: '导出会话', defaultPath: defaultName })
      : await dialog.showSaveDialog({ title: '导出会话', defaultPath: defaultName });
    if (res.canceled || !res.filePath) return null;
    return res.filePath;
  });

  // --- Proxy lifecycle ---
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

      // Start proxy with the real upstream. Generate a fresh shared secret (or
      // reuse the persisted one) so /v1/messages requires x-dialogueviz-key.
      const secret = readStoredSecret() ?? randomUUID();
      writeStoredSecret(secret);
      proxyServer = await startProxyServer(8787, upstream, secret);
      proxyServer.onCaptured((apiRequest) => {
        // Stream to renderer.
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
          windows[0].webContents.send('proxy:live-update', apiRequest);
        }
        // Persist to disk (debounced).
        pushCapturedRequest(apiRequest);
      });

      // Allocate a file path for this capture session BEFORE the first
      // request arrives, so every captured request overwrites the same file.
      const store = ensureLiveStore();
      const now = Date.now();
      const liveSession: Session = {
        id: `proxy-live-${now}`,
        source: 'proxy-live',
        client: 'claude-code',
        startedAt: now,
        title: `实时捕获 (port ${proxyServer.port})`,
        requests: [],
        conversation: [],
      };
      const path = join(claudeProjectsDir(), generateLiveFileName(now));
      liveRuntime = { session: liveSession, path, saveTimer: null, lastSize: 0 };
      // Write the empty initial session so the file is visible in history
      // even if the user kills the app before any request lands.
      try { store.saveSessionAtPath(liveSession, path); } catch (err) {
        console.error('[live-store] initial save failed:', err);
      }

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
          // Drop the proxy's shared-secret env var too — it has no use
          // outside an active capture and shouldn't linger in settings.
          delete settings.env.DIALOGUEVIZ_KEY;
          writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        } catch (err) {
          console.error('[proxy] failed to restore settings.json:', err);
        }
      }
      savedBaseUrl = null;
    }
    // Final flush of the live capture so the on-disk file reflects the full
    // session, including `endedAt`.
    if (liveRuntime) {
      liveRuntime.session = { ...liveRuntime.session, endedAt: Date.now() };
      flushLiveSave();
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

/** Best-effort flush called when the app is about to quit, so an in-flight
 *  capture isn't lost if the user closes the app without stopping first. */
export function flushPendingLiveSession(): void {
  if (liveRuntime) {
    liveRuntime.session = { ...liveRuntime.session, endedAt: Date.now() };
    flushLiveSave();
  }
}

// Auto-register the quit hook so we never lose a capture to a hard close.
let quitHookInstalled = false;
export function installLiveStoreQuitHook(): void {
  if (quitHookInstalled) return;
  quitHookInstalled = true;
  app.on('before-quit', () => {
    flushPendingLiveSession();
  });
}
