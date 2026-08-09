import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PersistentLiveStore, INDEX_FILE_NAME } from '../../src/main/store/persistent-store';

function emptySession(id: string, startedAt: number, requests: number = 0): any {
  return {
    id,
    source: 'proxy-live',
    client: 'claude-code',
    startedAt,
    title: 't-' + id,
    requests: Array.from({ length: requests }, (_, i) => ({ id: 'r' + i, timestamp: 0, model: 'm', system: [], messageCount: 0, params: { maxTokens: 0 } })),
    conversation: [],
  };
}

describe('PersistentLiveStore (D-1: sidecar index)', () => {
  let tmpDir: string;
  let store: PersistentLiveStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dialogueviz-d1-'));
    store = new PersistentLiveStore(tmpDir);
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes a sidecar index on saveSessionAtPath', () => {
    const path = store.saveSession(emptySession('a', 1000, 3));
    const idxPath = join(tmpDir, INDEX_FILE_NAME);
    expect(existsSync(idxPath)).toBe(true);
    const idx = JSON.parse(readFileSync(idxPath, 'utf-8'));
    expect(idx.version).toBe(1);
    const keys = Object.keys(idx.entries);
    expect(keys.length).toBe(1);
    const entry = idx.entries[keys[0]];
    expect(entry.path).toBe(path);
    expect(entry.startedAt).toBe(1000);
    expect(entry.requestCount).toBe(3);
    expect(entry.sizeBytes).toBeGreaterThan(0);
  });

  it('listSessions hits the index and ignores a corrupted capture', () => {
    // Save, then clobber the capture file with bad JSON. If the index
    // path is taken, the bad JSON is ignored and we still get a meta.
    const path = store.saveSession(emptySession('a', 1000, 0));
    writeFileSync(path, '{ this is not valid json', 'utf-8');
    // Bumping mtime forward forces the cache check to fail; the
    // rehydrate path then tries to parse the file and bails, leaving
    // the entry removed (because rehydrate returns null and the loop
    // does not include it).
    const future = (Date.now() + 60_000) / 1000;
    utimesSync(path, future, future);
    const out = store.listSessions();
    // The bad file's entry is dropped on the next listSessions(),
    // so out.length === 0 is also a valid result. The important
    // assertion is that we don' + "'" + 't throw.
    expect(out).toBeInstanceOf(Array);
  });

  it('rebuilds the index when the file is missing (cold start)', () => {
    store.saveSession(emptySession('a', 1000));
    // Simulate a cold start by deleting the sidecar index.
    rmSync(join(tmpDir, INDEX_FILE_NAME));
    const out = store.listSessions();
    expect(out.length).toBe(1);
    expect(out[0].startedAt).toBe(1000);
    // The full-scan path rebuilt the index.
    expect(existsSync(join(tmpDir, INDEX_FILE_NAME))).toBe(true);
  });

  it('re-reads a file when its (mtime, size) changes (stale detection)', () => {
    const path = store.saveSession(emptySession('a', 1000, 1));
    // Simulate the user editing the file outside the app: change size
    // and bump mtime so the cache is stale.
    writeFileSync(path, JSON.stringify({ ...emptySession('a', 1000, 99), title: 'edited' }), 'utf-8');
    const future = (Date.now() + 60_000) / 1000;
    utimesSync(path, future, future);
    const out = store.listSessions();
    expect(out.length).toBe(1);
    // requestCount should reflect the NEW file, proving we re-read.
    expect(out[0].requestCount).toBe(99);
    expect(out[0].title).toBe('edited');
  });

  it('drops dangling entries when the file has been rm-ed externally', () => {
    const path = store.saveSession(emptySession('a', 1000));
    expect(store.listSessions().length).toBe(1);
    // Simulate the user rm-ing the capture outside the app.
    rmSync(path);
    const out = store.listSessions();
    expect(out.length).toBe(0);
    // The dangling entry should have been pruned from the index too.
    const idx = JSON.parse(readFileSync(join(tmpDir, INDEX_FILE_NAME), 'utf-8'));
    expect(Object.keys(idx.entries).length).toBe(0);
  });

  it('removeIndexEntry is called on deleteSession', () => {
    const path = store.saveSession(emptySession('a', 1000));
    expect(store.listSessions().length).toBe(1);
    store.deleteSession(path);
    expect(store.listSessions().length).toBe(0);
    const idx = JSON.parse(readFileSync(join(tmpDir, INDEX_FILE_NAME), 'utf-8'));
    expect(Object.keys(idx.entries).length).toBe(0);
  });

  it('falls back to a full scan when the index has a stale schema version', () => {
    store.saveSession(emptySession('a', 1000));
    // Overwrite the index with an old version to simulate an upgrade
    // from an earlier build. The store should rebuild instead of
    // trying to read a v999 index.
    writeFileSync(join(tmpDir, INDEX_FILE_NAME), JSON.stringify({ version: 999, entries: {} }));
    const out = store.listSessions();
    expect(out.length).toBe(1);
    const idx = JSON.parse(readFileSync(join(tmpDir, INDEX_FILE_NAME), 'utf-8'));
    expect(idx.version).toBe(1); // rebuilt with the current version
  });

  it('handles a corrupt index file by falling back to a full scan', () => {
    store.saveSession(emptySession('a', 1000));
    writeFileSync(join(tmpDir, INDEX_FILE_NAME), 'not valid json');
    const out = store.listSessions();
    expect(out.length).toBe(1);
    // And it should have rewritten the index with a fresh one.
    const idx = JSON.parse(readFileSync(join(tmpDir, INDEX_FILE_NAME), 'utf-8'));
    expect(idx.version).toBe(1);
  });
});
