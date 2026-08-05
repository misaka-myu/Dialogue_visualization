// src/main/store/persistent-store.ts
// Durable file storage for proxy-live sessions, sitting alongside Claude Code's
// JSONL history under ~/.claude/projects/.
//
// Each live capture is one JSON file with a stable path the renderer can
// re-load by clicking it. Writes are atomic (write .tmp then rename) so a
// crash mid-write never leaves a half-truncated file. Updates overwrite the
// same path; a new capture creates a new file with a fresh timestamp + random
// suffix so old captures remain readable.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'fs';
import { join, basename } from 'path';
import { randomBytes } from 'crypto';
import { Session } from '../model/types';

export interface LiveMeta {
  path: string;
  title: string;
  startedAt: number;
  endedAt?: number;
  requestCount: number;
  conversationCount: number;
  sizeKB: number;
}

export const LIVE_FILE_PREFIX = '.proxy-live-';
export const LIVE_FILE_SUFFIX = '.json';
/** Single-file soft limit. Beyond this we still write, but list/UI can warn. */
export const LIVE_FILE_WARN_BYTES = 50 * 1024 * 1024;

export function generateLiveFileName(now: number = Date.now()): string {
  const ts = now;
  const rand = randomBytes(3).toString('hex');
  return `${LIVE_FILE_PREFIX}${ts}-${rand}${LIVE_FILE_SUFFIX}`;
}

export class PersistentLiveStore {
  /** If `path` is provided, all files live under it. Otherwise callers use
   *  `generateLiveFileName` and the absolute path is supplied to save. */
  constructor(private dir: string) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  /** Persist `session` to the exact `path` (must already include filename).
   *  Atomic: writes `<path>.tmp` then renames over `path`. Returns path. */
  saveSessionAtPath(session: Session, path: string): string {
    const tmp = `${path}.tmp`;
    const json = JSON.stringify(session, null, 2);
    writeFileSync(tmp, json, 'utf-8');
    renameSync(tmp, path);
    return path;
  }

  /** Convenience: pick a fresh file name under the store's dir and save. */
  saveSession(session: Session): string {
    const path = join(this.dir, generateLiveFileName(session.startedAt));
    return this.saveSessionAtPath(session, path);
  }

  /** Read + parse + shape-check. Returns null on any error. */
  loadSession(path: string): Session | null {
    try {
      if (!existsSync(path)) return null;
      const text = readFileSync(path, 'utf-8');
      const obj = JSON.parse(text);
      if (!isValidSessionShape(obj)) return null;
      return obj as Session;
    } catch {
      return null;
    }
  }

  /** Scan the directory for `proxy-live-*` files, return lightweight metadata
   *  sorted by startedAt descending. Files that fail to parse are skipped. */
  listSessions(): LiveMeta[] {
    let entries: string[];
    try { entries = readdirSync(this.dir); } catch { return []; }
    const out: LiveMeta[] = [];
    for (const name of entries) {
      if (!isLiveFileName(name)) continue;
      const path = join(this.dir, name);
      let st: import('fs').Stats;
      try { st = statSync(path); } catch { continue; }
      if (!st.isFile()) continue;
      let session: Session | null = null;
      try {
        const text = readFileSync(path, 'utf-8');
        const obj = JSON.parse(text);
        if (isValidSessionShape(obj)) session = obj as Session;
      } catch { /* skip corrupt file */ }
      if (!session) continue;
      out.push({
        path,
        title: session.title ?? basename(name, LIVE_FILE_SUFFIX),
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        requestCount: session.requests?.length ?? 0,
        conversationCount: session.conversation?.length ?? 0,
        sizeKB: Math.max(1, Math.round(st.size / 1024)),
      });
    }
    out.sort((a, b) => b.startedAt - a.startedAt);
    return out;
  }

  deleteSession(path: string): boolean {
    try {
      if (!existsSync(path)) return false;
      rmSync(path);
      // Also clean up a stray .tmp if one was left behind.
      const tmp = `${path}.tmp`;
      if (existsSync(tmp)) {
        try { rmSync(tmp); } catch { /* ignore */ }
      }
      return true;
    } catch {
      return false;
    }
  }
}

function isLiveFileName(name: string): boolean {
  return name.startsWith(LIVE_FILE_PREFIX) && name.endsWith(LIVE_FILE_SUFFIX);
}

function isValidSessionShape(obj: unknown): obj is Session {
  if (!obj || typeof obj !== 'object') return false;
  const s = obj as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    typeof s.source === 'string' &&
    typeof s.startedAt === 'number' &&
    Array.isArray(s.requests) &&
    Array.isArray(s.conversation)
  );
}
