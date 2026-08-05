// tests/store/persistent-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PersistentLiveStore, generateLiveFileName, LIVE_FILE_PREFIX, LIVE_FILE_SUFFIX } from '../../src/main/store/persistent-store';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'fs';
import { resolve } from 'path';
import { Session } from '../../src/main/model/types';

const tmpDir = resolve(__dirname, '../.tmp-persistent-test');

function emptySession(id: string, startedAt: number): Session {
  return {
    id,
    source: 'proxy-live',
    client: 'claude-code',
    startedAt,
    title: `cap ${id}`,
    requests: [],
    conversation: [],
  };
}

describe('generateLiveFileName', () => {
  it('produces names with prefix, timestamp, random, and suffix', () => {
    const name = generateLiveFileName(1700000000000);
    expect(name.startsWith(LIVE_FILE_PREFIX)).toBe(true);
    expect(name.endsWith(LIVE_FILE_SUFFIX)).toBe(true);
    expect(name).toContain('1700000000000');
  });

  it('produces distinct names for the same timestamp', () => {
    const a = generateLiveFileName(1700000000000);
    const b = generateLiveFileName(1700000000000);
    expect(a).not.toBe(b);
  });
});

describe('PersistentLiveStore', () => {
  beforeEach(() => mkdirSync(tmpDir, { recursive: true }));
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('saveSessionAtPath writes to the exact path atomically', () => {
    const store = new PersistentLiveStore(tmpDir);
    const path = resolve(tmpDir, 'manual.json');
    const session = emptySession('m1', 1000);
    const returned = store.saveSessionAtPath(session, path);
    expect(returned).toBe(path);
    expect(existsSync(path)).toBe(true);
    expect(existsSync(path + '.tmp')).toBe(false);
    const onDisk = JSON.parse(readFileSync(path, 'utf-8'));
    expect(onDisk.id).toBe('m1');
  });

  it('saveSession picks a fresh filename under the dir', () => {
    const store = new PersistentLiveStore(tmpDir);
    const path = store.saveSession(emptySession('a', 1));
    expect(path.startsWith(tmpDir)).toBe(true);
    expect(path).toContain(LIVE_FILE_PREFIX);
  });

  it('loadSession round-trips a saved session', () => {
    const store = new PersistentLiveStore(tmpDir);
    const path = store.saveSession(emptySession('r1', 1234));
    const loaded = store.loadSession(path);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe('r1');
    expect(loaded!.title).toBe('cap r1');
  });

  it('loadSession returns null for missing file', () => {
    const store = new PersistentLiveStore(tmpDir);
    expect(store.loadSession(resolve(tmpDir, 'nope.json'))).toBeNull();
  });

  it('loadSession returns null for malformed JSON', () => {
    const store = new PersistentLiveStore(tmpDir);
    const path = resolve(tmpDir, 'bad.json');
    require('fs').writeFileSync(path, '{ this is not json', 'utf-8');
    expect(store.loadSession(path)).toBeNull();
  });

  it('loadSession returns null when shape is invalid', () => {
    const store = new PersistentLiveStore(tmpDir);
    const path = resolve(tmpDir, 'wrong.json');
    require('fs').writeFileSync(path, JSON.stringify({ id: 1 }), 'utf-8');
    expect(store.loadSession(path)).toBeNull();
  });

  it('listSessions returns proxy-live files sorted newest first, with metadata', () => {
    const store = new PersistentLiveStore(tmpDir);
    const oldPath = store.saveSession(emptySession('old', 1000));
    const newPath = store.saveSession(emptySession('new', 2000));

    const list = store.listSessions();
    const paths = list.map((m) => m.path);
    expect(paths).toEqual([newPath, oldPath]);
    expect(list[0].requestCount).toBe(0);
    expect(list[0].conversationCount).toBe(0);
    expect(list[0].sizeKB).toBeGreaterThanOrEqual(1);
    expect(list[0].title).toBe('cap new');
  });

  it('listSessions ignores non-live files and corrupt entries', () => {
    const store = new PersistentLiveStore(tmpDir);
    store.saveSession(emptySession('keep', 1));
    require('fs').writeFileSync(resolve(tmpDir, 'other.json'), '{}', 'utf-8');
    require('fs').writeFileSync(resolve(tmpDir, `${LIVE_FILE_PREFIX}broken.json`), '{bad', 'utf-8');
    const list = store.listSessions();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('cap keep');
  });

  it('deleteSession removes the file and any stray .tmp', () => {
    const store = new PersistentLiveStore(tmpDir);
    const path = store.saveSession(emptySession('d1', 1));
    require('fs').writeFileSync(path + '.tmp', 'leftover', 'utf-8');
    expect(store.deleteSession(path)).toBe(true);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(path + '.tmp')).toBe(false);
  });

  it('deleteSession returns false for missing file', () => {
    const store = new PersistentLiveStore(tmpDir);
    expect(store.deleteSession(resolve(tmpDir, 'missing.json'))).toBe(false);
  });

  it('overwriting the same path reflects the latest content', () => {
    const store = new PersistentLiveStore(tmpDir);
    const path = store.saveSessionAtPath(emptySession('v1', 1), resolve(tmpDir, 'a.json'));
    const bigger: Session = { ...emptySession('v1', 1), title: 'updated', requests: [{ id: 'r', timestamp: 1, model: 'm', system: [], messageCount: 0, params: { maxTokens: 0 } } as any] };
    store.saveSessionAtPath(bigger, path);
    const loaded = store.loadSession(path);
    expect(loaded?.title).toBe('updated');
    expect(loaded?.requests.length).toBe(1);
    expect(statSync(path).size).toBeGreaterThan(0);
  });
});
