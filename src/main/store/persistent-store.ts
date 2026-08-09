// src/main/store/persistent-store.ts
// Durable file storage for proxy-live sessions, sitting alongside Claude Code's
// JSONL history under ~/.claude/projects/.
//
// Each live capture is one JSON file with a stable path the renderer can
// re-load by clicking it. Writes are atomic (write .tmp then rename) so a
// crash mid-write never leaves a half-truncated file. Updates overwrite the
// same path; a new capture creates a new file with a fresh timestamp + random
// suffix so old captures remain readable.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'fs';
import { dirname, join, basename } from 'path';
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

/** D-1: sidecar index file that lets listSessions() skip the per-file
 *  readFileSync + JSON.parse for the common case. We only re-read a
 *  capture file when its (mtimeMs, size) tuple in the index is stale.
 *  The file is rewritten atomically on every save / delete / rename
 *  so a torn write can never leave us with a half-truncated index. */
export const INDEX_FILE_NAME = '.proxy-live-index.json';
/** Current index schema version. Bump if the layout changes so old
 *  indices are rebuilt from scratch rather than misread. */
const INDEX_VERSION = 1;

interface IndexEntry {
  path: string;
  title: string;
  startedAt: number;
  endedAt?: number;
  requestCount: number;
  conversationCount: number;
  sizeKB: number;
  /** statSync values captured at index-write time. */
  mtimeMs: number;
  sizeBytes: number;
}

interface Index {
  version: number;
  entries: Record<string, IndexEntry>;
}

export function generateLiveFileName(now: number = Date.now()): string {
  const ts = now;
  const rand = randomBytes(3).toString('hex');
  return `${LIVE_FILE_PREFIX}${ts}-${rand}${LIVE_FILE_SUFFIX}`;
}

export class PersistentLiveStore {
  /** If `path` is provided, all files live under it. Otherwise callers use
   *  `generateLiveFileName` and the absolute path is supplied to save. */
  constructor(private dir: string) {
    if (!existsSync(dir)) mkdirSync(dir, 'recursive');
  }

  // --- Sidecar index helpers (D-1) ---

  private indexPath(): string {
    return join(this.dir, INDEX_FILE_NAME);
  }

  /** Read the sidecar index. Returns null if the file is missing,
   *  unreadable, or carries an incompatible version (forces a rebuild). */
  private loadIndex(): Index | null {
    const p = this.indexPath();
    if (!existsSync(p)) return null;
    try {
      const obj = JSON.parse(readFileSync(p, 'utf-8'));
      if (!obj || typeof obj !== 'object') return null;
      const idx = obj as Index;
      if (idx.version !== INDEX_VERSION) return null;
      if (!idx.entries || typeof idx.entries !== 'object') return null;
      return idx;
    } catch {
      return null;
    }
  }

  /** Atomic write of the sidecar index. */
  private saveIndex(idx: Index): void {
    const p = this.indexPath();
    const tmp = p + '.tmp';
    try {
      writeFileSync(tmp, JSON.stringify(idx), 'utf-8');
      renameSync(tmp, p);
    } catch (err) {
      console.warn('[persistent-store] index write failed:', err);
      try { if (existsSync(tmp)) rmSync(tmp); } catch { /* ignore */ }
    }
  }

  /** Insert or replace an entry for `path`, capturing mtime / size
   *  from the file we just wrote. */
  private updateIndexEntry(path: string, session: Session): void {
    const idx = this.loadIndex() ?? {
    version: INDEX_VERSION,
    entries: {},
  };
    let st: import('fs').Stats;
    try { st = statSync(path); } catch { return; }
    idx.entries[basename(path)] = {
      path,
      title: session.title ?? basename(path, LIVE_FILE_SUFFIX),
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      requestCount: session.requests?.length ?? 0,
      conversationCount: session.conversation?.length ?? 0,
      sizeKB: Math.max(1, Math.round(st.size / 1024)),
      mtimeMs: st.mtimeMs,
      sizeBytes: st.size,
    };
    this.saveIndex(idx);
  }

  /** Drop the entry for `path` (called from deleteSession). */
  private removeIndexEntry(path: string): void {
    const idx = this.loadIndex();
    if (!idx) return;
    if (delete idx.entries[basename(path)]) {
      this.saveIndex(idx);
    }
  }

  /** Persist `session` to the exact `path` (must already include filename).
   *  Atomic: writes `<path>.tmp` then renames over `path`. Returns path. */
  saveSessionAtPath(session: Session, path: string): string {
    const tmp = `${path}.tmp`;
    const json = JSON.stringify(session, null, 2);
    writeFileSync(tmp, json, 'utf-8');
    renameSync(tmp, path);
    // D-1: refresh the sidecar index so listSessions() doesn't
    // have to readFileSync + JSON.parse this file again.
    this.updateIndexEntry(path, session);
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

  /** D-1: prefer the sidecar index so we avoid reading every file.
   *  Falls back to a directory walk when the index is missing,
   *  unreadable, or built with an older schema. */
  listSessions(): LiveMeta[] {
    const idx = this.loadIndex();
    if (idx) {
      return this.listSessionsFromIndex(idx);
    }
    return this.listSessionsFullScan();
  }

  /** D-1: walk the index, but re-read any file whose (mtimeMs, size)
   *  no longer matches the cached values. Files that no longer exist
   *  on disk are silently dropped from the index (self-heal for the
   *  case where the user rm'd a capture outside the app). */
  private listSessionsFromIndex(idx: Index): LiveMeta[] {
    const out: LiveMeta[] = [];
    const removed: string[] = [];
    for (const name of Object.keys(idx.entries)) {
      const e = idx.entries[name];
      let st: import('fs').Stats;
      try { st = statSync(e.path); } catch {
        removed.push(name);
        delete idx.entries[name];
        continue;
      }
      if (!st.isFile()) continue;
      if (st.mtimeMs === e.mtimeMs && st.size === e.sizeBytes) {
        out.push(this.entryToMeta(e));
        continue;
      }
      const refreshed = this.rehydrateEntry(e.path, st);
      if (refreshed) {
        out.push(refreshed.meta);
        idx.entries[name] = refreshed.entry;
      }
    }
    if (removed.length > 0) {
      this.saveIndex(idx);
    }
    out.sort((a, b) => b.startedAt - a.startedAt);
    return out;
  }

  /** D-1: cold-start full scan. Used when the index is missing / corrupt
   *  and we need to rebuild it. Also writes a fresh index on the way out
   *  so the next listSessions() call hits the cache. */
  private listSessionsFullScan(): LiveMeta[] {
    let entries: string[];
    try { entries = readdirSync(this.dir); } catch { return []; }
    const out: LiveMeta[] = [];
    const idx: Index = {
    version: INDEX_VERSION,
    entries: {} };
    for (const name of entries) {
      if (!isLiveFileName(name)) continue;
      const path = join(this.dir, name);
      let st: import('fs').Stats;
      try { st = statSync(path); } catch { continue; }
      if (!st.isFile()) continue;
      const session = this.readSessionFile(path);
      if (!session) continue;
      const entry: IndexEntry = {
        path,
        title: session.title ?? basename(name, LIVE_FILE_SUFFIX),
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        requestCount: session.requests?.length ?? 0,
        conversationCount: session.conversation?.length ?? 0,
        sizeKB: Math.max(1, Math.round(st.size / 1024)),
        mtimeMs: st.mtimeMs,
        sizeBytes: st.size,
      };
      out.push(this.entryToMeta(entry));
      idx.entries[name] = entry;
    }
    out.sort((a, b) => b.startedAt - a.startedAt);
    this.saveIndex(idx);
    return out;
  }

  /** D-1: read a capture file (returns null on any failure). */
  private readSessionFile(path: string): Session | null {
    try {
      const obj = JSON.parse(readFileSync(path, 'utf-8'));
      if (!isValidSessionShape(obj)) return null;
      return obj as Session;
    } catch {
      return null;
    }
  }

  /** D-1: re-read a capture file when its (mtime, size) is stale.
   *  Returns null if the file is gone / corrupt; otherwise returns
   *  the new meta + the new index entry. */
  private rehydrateEntry(path: string, st: import('fs').Stats): { meta: LiveMeta; entry: IndexEntry } | null {
    const session = this.readSessionFile(path);
    if (!session) return null;
    const entry: IndexEntry = {
      path,
      title: session.title ?? basename(path, LIVE_FILE_SUFFIX),
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      requestCount: session.requests?.length ?? 0,
      conversationCount: session.conversation?.length ?? 0,
      sizeKB: Math.max(1, Math.round(st.size / 1024)),
      mtimeMs: st.mtimeMs,
      sizeBytes: st.size,
    };
    return { meta: this.entryToMeta(entry), entry };
  }

  /** D-1: shared shape conversion IndexEntry -> LiveMeta. */
  private entryToMeta(e: IndexEntry): LiveMeta {
    return {
      path: e.path,
      title: e.title,
      startedAt: e.startedAt,
      endedAt: e.endedAt,
      requestCount: e.requestCount,
      conversationCount: e.conversationCount,
      sizeKB: e.sizeKB,
    };
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
      // D-1: drop the entry so the next listSessions() doesn't
      // return a dangling row.
      this.removeIndexEntry(path);
      return true;
    } catch {
      return false;
    }
  }

  /** Update the in-place title of the session at `path`. File name is NOT
   *  changed (we keep the path stable so open-session references still work).
   *  Atomic write, same guarantee as `saveSessionAtPath`. Returns the new
   *  title on success, or null if the file is missing/invalid/IO failed. */
  renameSession(path: string, newTitle: string): string | null {
    try {
      if (!existsSync(path)) return null;
      const text = readFileSync(path, 'utf-8');
      const obj = JSON.parse(text);
      if (!isValidSessionShape(obj)) return null;
      const next: Session = { ...(obj as Session), title: newTitle };
      this.saveSessionAtPath(next, path);
      return newTitle;
    } catch {
      return null;
    }
  }

  /** Copy the session file at `path` to `exportPath` (an absolute path the
   *  caller chose via a save dialog). The source file is left untouched.
   *  Creates the parent directory if needed. Returns the export path on
   *  success, null on failure. */
  exportSession(path: string, exportPath: string): string | null {
    try {
      if (!existsSync(path)) return null;
      const parent = dirname(exportPath);
      if (parent && !existsSync(parent)) {
        mkdirSync(parent, { recursive: true });
      }
      copyFileSync(path, exportPath);
      return exportPath;
    } catch {
      return null;
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
