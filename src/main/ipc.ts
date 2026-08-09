// src/main/ipc.ts
import { ipcMain, dialog, BrowserWindow, app } from 'electron';
import { scanClaudeSessions, loadClaudeSession, deleteClaudeSession, exportClaudeSession, SessionMeta } from './adapters/claude-log';
import { scanCodexSessions, loadCodexSession, deleteCodexSession, exportCodexSession, CodexSessionMeta } from './adapters/codex-log';
import { join } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { ApiRequest, Session } from './model/types';
import { startProxyServer, ProxyServer } from './proxy/server';
import { PersistentLiveStore, LiveMeta, generateLiveFileName, LIVE_FILE_WARN_BYTES } from './store/persistent-store';
import { backupIfNeeded, restoreOnStop, restoreAllOnStop } from './configGuard';

function claudeProjectsDir(): string {
  return join(homedir(), '.claude', 'projects');
}

function claudeSettingsPath(): string {
  return join(homedir(), '.claude', 'settings.json');
}

function codexHome(): string {
  return join(homedir(), '.codex');
}

function codexConfigPath(): string {
  return join(codexHome(), 'config.toml');
}

function codexBackupPath(): string {
  return join(codexHome(), '.dialogueviz-backup');
}

/** Durable storage for the REAL original Codex base_url, so we can recover
 *  if config.toml was polluted (left pointing at localhost) by a capture
 *  that wasn't stopped. Mirrors the Claude Code .dialogueviz-upstream. */
function codexUpstreamPath(): string {
  return join(codexHome(), '.dialogueviz-upstream');
}

function readStoredCodexUpstream(): string | null {
  try {
    if (existsSync(codexUpstreamPath())) {
      const v = readFileSync(codexUpstreamPath(), 'utf-8').trim();
      return v || null;
    }
  } catch { /* ignore */ }
  return null;
}

function writeStoredCodexUpstream(url: string): void {
  try { writeFileSync(codexUpstreamPath(), url); } catch { /* ignore */ }
}

function isLocalhostUrl(u: string): boolean {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u);
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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let proxyServer: ProxyServer | null = null;
let savedBaseUrl: string | undefined | null = null;  // null = not captured yet; undefined = key absent
let savedSecret: string | null = null;

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

  // --- Codex sessions (scan / load / delete / export) ---

  ipcMain.handle('codex:list', async (): Promise<CodexSessionMeta[]> => {
    return scanCodexSessions(codexHome());
  });

  ipcMain.handle('codex:load', async (_e, sourcePath: string): Promise<Session | null> => {
    try {
      return loadCodexSession(sourcePath);
    } catch {
      return null;
    }
  });

  ipcMain.handle('codex:delete', async (_e, sourcePath: string): Promise<boolean> => {
    return deleteCodexSession(sourcePath);
  });

  ipcMain.handle('codex:export', async (_e, sourcePath: string, exportPath: string): Promise<string | null> => {
    return exportCodexSession(sourcePath, exportPath);
  });

  // --- Codex proxy lifecycle (config.toml rewrite) ---

  ipcMain.handle('codex:start', async (): Promise<{ port: number; upstream: string } | null> => {
    if (proxyServer) {
      // A capture is already running - don't clobber its liveRuntime.
      return null;
    }
    try {
      const configPath = codexConfigPath();
      if (!existsSync(configPath)) {
        console.error('[codex] config.toml not found at', configPath);
        return null;
      }
      const originalConfig = readFileSync(configPath, 'utf-8');

      // Parse model_provider to find the active provider's base_url
      const providerMatch = originalConfig.match(/^model_provider\s*=\s*"([^"]+)"/m);
      if (!providerMatch) {
        console.error('[codex] cannot find model_provider in config.toml');
        return null;
      }
      const activeProvider = providerMatch[1];

      // Find the [model_providers.<activeProvider>] section and its base_url
      const sectionRegex = new RegExp(
        `\\[model_providers\\.${escapeRegex(activeProvider)}\\]([\\s\\S]*?)(?=\\n\\[|$)`,
      );
      const sectionMatch = originalConfig.match(sectionRegex);
      if (!sectionMatch) {
        console.error(`[codex] cannot find [model_providers.${activeProvider}] section`);
        return null;
      }
      const baseUrlMatch = sectionMatch[1].match(/^base_url\s*=\s*"([^"]+)"/m);
      if (!baseUrlMatch) {
        console.error('[codex] cannot find base_url in provider section');
        return null;
      }
      const originalBaseUrl = baseUrlMatch[1];

      // If config.toml is already pointing at localhost (left over from a
      // previous capture that wasn't stopped), recover the real upstream
      // from durable storage instead of using the stale localhost URL.
      let realBaseUrl = originalBaseUrl;
      if (isLocalhostUrl(originalBaseUrl)) {
        const stored = readStoredCodexUpstream();
        if (stored && !isLocalhostUrl(stored)) {
          realBaseUrl = stored;
        } else {
          console.error('[codex] config.toml is pointing at localhost and no durable upstream found');
          return null;
        }
      } else {
        // Save the real upstream durably for future recovery.
        writeStoredCodexUpstream(originalBaseUrl);
      }

      // Save original config for restore on stop. backupIfNeeded
// unifies backup + marker management with Claude Code: writes
// .dialogueviz-config.bak only if no capture is currently active,
// and drops a .dialogueviz-active marker that startup-time self-heal
// can detect after a crash.
      backupIfNeeded('codex');
      if (!existsSync(codexConfigPath())) {
        // No config to back up — first-ever run is fine.
      } else {
        // We just attempted backup; verify it actually wrote. If not,
        // we'd be rewriting config.toml without a snapshot to fall
        // back to on crash.
        const backedUp = existsSync(join(codexHome(), '.dialogueviz-config.bak'));
        if (!backedUp) {
          console.warn(
            '[codex] failed to back up config.toml before starting capture;',
            'config may be unrecoverable if the app crashes before stop.',
          );
        }
      }

      // Start proxy with the real upstream. Strip to origin (e.g.
      // "https://api.minimaxi.com/v1" -> "https://api.minimaxi.com") so
      // handleResponses can reconstruct the full URL as origin + req.path.
      const upstreamOrigin = new URL(realBaseUrl).origin;
      proxyServer = await startProxyServer(8787, upstreamOrigin);

      proxyServer.onCaptured((apiRequest) => {
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
          windows[0].webContents.send('proxy:live-update', apiRequest);
        }
        pushCapturedRequest(apiRequest);
      });

      // Allocate live session
      const store = ensureLiveStore();
      const now = Date.now();
      const liveSession: Session = {
        id: `codex-live-${now}`,
        source: 'proxy-live',
        client: 'codex',
        startedAt: now,
        title: `Codex 捕获 (port ${proxyServer.port})`,
        requests: [],
        conversation: [],
      };
      const path = join(claudeProjectsDir(), generateLiveFileName(now));
      liveRuntime = { session: liveSession, path, saveTimer: null, lastSize: 0 };
      try { store.saveSessionAtPath(liveSession, path); } catch (err) {
        console.error('[codex] initial save failed:', err);
      }

      // Rewrite config.toml: replace base_url with proxy URL.
      // Keep the /v1 suffix so Codex sends to /v1/responses (matching our
      // Express route). The upstream is stripped to origin only - the full
      // path is reconstructed from req.originalUrl in handleResponses.
      const proxyUrl = `http://localhost:${proxyServer.port}/v1`;
      const newConfig = originalConfig.replace(
        sectionRegex,
        (full) => full.replace(baseUrlMatch[0], `base_url = "${proxyUrl}"`),
      );
      writeFileSync(configPath, newConfig, 'utf-8');

      return { port: proxyServer.port, upstream: proxyServer.upstream };
    } catch (err) {
      console.error('[codex] failed to start:', err);
      return null;
    }
  });

  ipcMain.handle('codex:stop', async (): Promise<void> => {
    if (proxyServer) {
      await proxyServer.stop();
      proxyServer = null;
    }
    // Restore config.toml from backup. Prefer the new .bak path
    // written by configGuard, but fall back to the legacy
    // .dialogueviz-backup for users who started a capture under an
    // older version. If the backup itself is broken (pointing at
    // localhost), patch it with the durable upstream file.
    const codexDir = join(codexHome());
    const newBackup = join(codexDir, '.dialogueviz-config.bak');
    const legacyBackup = codexBackupPath();
    const backupPath = existsSync(newBackup) ? newBackup
      : existsSync(legacyBackup) ? legacyBackup
      : null;
    if (backupPath) {
      try {
        let original = readFileSync(backupPath, 'utf-8');
        if (original.includes('base_url = "http://localhost')) {
          const stored = readStoredCodexUpstream();
          if (stored) {
            original = original.replace(
              /base_url = "http:\/\/localhost[^"]*"/,
              `base_url = "${stored}"`,
            );
          }
        }
        writeFileSync(codexConfigPath(), original, 'utf-8');
      } catch (err) {
        console.error('[codex] failed to restore config.toml:', err);
      }
    }
    // Drop the active marker regardless of whether we successfully
    // restored, so a corrupt backup doesn't keep us in "needs heal"
    // state forever. Self-heal on next boot will surface a stale
    // marker but the file will have been overwritten by the write
    // above (or left alone if no backup existed).
    restoreOnStop('codex');
    // Flush the live session with endedAt
    if (liveRuntime) {
      liveRuntime.session = { ...liveRuntime.session, endedAt: Date.now() };
      flushLiveSave();
      liveRuntime = null;
    }
  });

  // --- Proxy lifecycle ---
  ipcMain.handle('proxy:start', async (): Promise<{ port: number; upstream: string } | null> => {
    if (proxyServer) {
      return null;
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
      // Provision (or reuse) a per-machine shared secret. Persisted across
      // restarts so a long-running Claude Code session doesn't get a new
      // key mid-capture. The key is also injected into the Claude Code
      // settings env below, so the client can mint the matching header.
      const existingSecret = readStoredSecret();
      const secret = existingSecret ?? randomUUID();
      if (!existingSecret) writeStoredSecret(secret);
      savedSecret = secret;

      // Snapshot the current (un-polluted) settings.json BEFORE we
      // start the proxy. backupIfNeeded is a no-op when the active
      // marker already exists — meaning we're already inside a
      // crashed/never-restored capture, and the existing backup is
      // still the real original we want to keep. Doing this before
      // startProxyServer matches the order used in codex:start and
      // shrinks the window where the proxy is live but the marker
      // hasn't been written yet.
      const backedUp = backupIfNeeded('claude-code');
      if (!backedUp && existsSync(settingsPath)) {
        // The config exists on disk but we couldn't snapshot it.
        // Proceeding would still rewrite the user's settings; if we
        // crash before stop, the next-boot self-heal has nothing to
        // restore from. Warn loudly so the failure mode is visible.
        console.warn(
          '[proxy] failed to back up settings.json before starting capture;',
          'settings may be unrecoverable if the app crashes before stop.',
        );
      }

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
      // Inject the shared-secret so the Claude Code CLI can mint the
      // matching x-dialogueviz-key header. The proxy refuses requests
      // without it.
      settings.env.DIALOGUEVIZ_KEY = secret;
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
    // Restore settings.json from the snapshot we took on proxy:start.
    // ConfigGuard handles the marker dance: if the backup is missing
    // (e.g. start never reached the backup step) the marker is still
    // cleared so we don't trigger a self-heal on next boot for no
    // reason. The runtime fields (savedBaseUrl, savedSecret) are
    // intentionally left untouched — they're only used by proxy:start.
    restoreOnStop('claude-code');
    // Final flush of the live capture so the on-disk file reflects the full
    // session, including `endedAt`.
    if (liveRuntime) {
      liveRuntime.session = { ...liveRuntime.session, endedAt: Date.now() };
      flushLiveSave();
      liveRuntime = null;
    }
    savedSecret = null;
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

// Auto-register the quit hook so we never lose a capture to a hard close,
// and always restore the user's settings.json / config.toml before exit.
// Startup-time self-heal (see index.ts) covers the SIGKILL case; this
// hook is the fast-path for normal exits.
let quitHookInstalled = false;
export function installLiveStoreQuitHook(): void {
  if (quitHookInstalled) return;
  quitHookInstalled = true;
  app.on('before-quit', () => {
    flushPendingLiveSession();
    restoreAllOnStop();
  });
}
