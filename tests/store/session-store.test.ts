// tests/store/session-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionStore } from '../../src/main/store/session-store';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { Session } from '../../src/main/model/types';

const tmpDir = resolve(__dirname, '../.tmp-store-test');

describe('SessionStore', () => {
  beforeEach(() => mkdirSync(tmpDir, { recursive: true }));
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('saveSession 写一个 JSON 文件，loadSession 读回来', () => {
    const store = new SessionStore(tmpDir);
    const session: Session = {
      id: 's1', source: 'proxy-live', client: 'claude-code',
      startedAt: 1000, title: 'test', requests: [],
    };
    const path = store.saveSession(session);
    expect(existsSync(path)).toBe(true);

    const loaded = store.loadSession('s1');
    expect(loaded).toEqual(session);
  });

  it('listSessions 返回所有已存会话的 id', () => {
    const store = new SessionStore(tmpDir);
    store.saveSession({ id: 'a', source: 'proxy-live', client: 'claude-code', startedAt: 1, requests: [] });
    store.saveSession({ id: 'b', source: 'proxy-live', client: 'claude-code', startedAt: 2, requests: [] });
    expect(store.listSessions().sort()).toEqual(['a', 'b']);
  });

  it('deleteSession 删除文件', () => {
    const store = new SessionStore(tmpDir);
    store.saveSession({ id: 'x', source: 'proxy-live', client: 'claude-code', startedAt: 1, requests: [] });
    expect(store.deleteSession('x')).toBe(true);
    expect(store.loadSession('x')).toBeNull();
  });
});
