// src/main/ipc.ts
import { ipcMain, dialog } from 'electron';
import { scanClaudeSessions, loadClaudeSession, SessionMeta } from './adapters/claude-log';
import { join } from 'path';
import { homedir } from 'os';
import { Session } from './model/types';

function claudeProjectsDir(): string {
  return join(homedir(), '.claude', 'projects');
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
}
