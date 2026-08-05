// src/main/ipc.ts
import { ipcMain, dialog, BrowserWindow } from 'electron';
import { scanClaudeSessions, loadClaudeSession, SessionMeta } from './adapters/claude-log';
import { join } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { Session } from './model/types';
import { startProxyServer, ProxyServer } from './proxy/server';

function claudeProjectsDir(): string {
  return join(homedir(), '.claude', 'projects');
}

let proxyServer: ProxyServer | null = null;

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
      proxyServer = await startProxyServer(8787);
      proxyServer.onCaptured((apiRequest) => {
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
          windows[0].webContents.send('proxy:live-update', apiRequest);
        }
      });
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
  });

  ipcMain.handle('proxy:launch-claude', async (_e, port: number): Promise<{ pid: number } | null> => {
    const env = {
      ...process.env,
      ANTHROPIC_BASE_URL: `http://localhost:${port}`,
    };
    try {
      // On Windows, `claude` is typically claude.cmd; shell:true lets us find it.
      const child = spawn('claude', { stdio: 'inherit', shell: true, env });
      return { pid: child.pid ?? -1 };
    } catch (err) {
      console.error('[proxy] failed to launch claude:', err);
      return null;
    }
  });
}
