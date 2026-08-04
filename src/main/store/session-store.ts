// src/main/store/session-store.ts
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Session } from '../model/types';

export class SessionStore {
  constructor(private dir: string) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  private path(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  saveSession(session: Session): string {
    const path = this.path(session.id);
    writeFileSync(path, JSON.stringify(session, null, 2), 'utf-8');
    return path;
  }

  loadSession(id: string): Session | null {
    const path = this.path(id);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8')) as Session;
  }

  listSessions(): string[] {
    return readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''));
  }

  deleteSession(id: string): boolean {
    const path = this.path(id);
    if (!existsSync(path)) return false;
    rmSync(path);
    return true;
  }
}
