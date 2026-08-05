import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { scanClaudeSessions, parseSessionMeta, loadClaudeSession, deleteClaudeSession, exportClaudeSession } from '../../src/main/adapters/claude-log';
import { resolve } from 'path';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';

const fixturesDir = resolve(__dirname, '../fixtures');

describe('parseSessionMeta', () => {
  it('从头尾行提取 sessionId、cwd、首条用户消息当标题', () => {
    const meta = parseSessionMeta(resolve(fixturesDir, 'simple-session.jsonl'));
    expect(meta).not.toBeNull();
    expect(meta!.sessionId).toBe('sess-1');
    expect(meta!.projectDir).toBe('/tmp/project');
    expect(meta!.title).toBe('帮我修 bug');
    expect(meta!.createdAt).toBe(1785578400000);
  });

  it('无用户消息时回退到目录名作标题', () => {
    const meta = parseSessionMeta(resolve(fixturesDir, 'no-user-session.jsonl'));
    // 夹具见步骤 4 补充
    expect(meta!.title).toBe('project');
  });
});

describe('scanClaudeSessions', () => {
  it('递归收集 .jsonl，跳过 agent- 开头的会话', () => {
    const sessions = scanClaudeSessions(fixturesDir);
    const ids = sessions.map((s) => s.sessionId);
    expect(ids).toContain('sess-1');
    // agent-session.jsonl 应被跳过
    expect(ids).not.toContain('agent-sess');
  });
});

describe('loadClaudeSession', () => {
  it('把 assistant 消息重建为请求的响应，conversation 线性累积', () => {
    const session = loadClaudeSession(resolve(fixturesDir, 'simple-session.jsonl'));
    expect(session.client).toBe('claude-code');
    expect(session.source).toBe('claude-code-log');
    // 2 个 assistant 消息 -> 2 个 ApiRequest
    expect(session.requests).toHaveLength(2);

    // conversation 扁平数组，3 条消息（user + 2 assistant）
    expect(session.conversation).toHaveLength(3);
    expect(session.conversation[0]).toMatchObject({ role: 'user', content: [{ type: 'text', text: '帮我修 bug' }] });
    expect(session.conversation[1]).toMatchObject({ role: 'assistant', content: [{ type: 'text', text: '我来看看' }] });

    // 第 1 个请求：messageCount = 1（conversation 前 1 条 = [user]），response = "我来看看"
    expect(session.requests[0].messageCount).toBe(1);
    expect(session.requests[0].response?.content).toEqual([{ type: 'text', text: '我来看看' }]);

    // 第 2 个请求：messageCount = 2（累积了第 1 个 assistant），response = "找到问题了"
    expect(session.requests[1].messageCount).toBe(2);
    expect(session.requests[1].response?.content).toEqual([{ type: 'text', text: '找到问题了' }]);
  });

  it('tool_result 在 user 消息里被重分类为 tool 角色', () => {
    const session = loadClaudeSession(resolve(fixturesDir, 'tool-use-session.jsonl'));
    expect(session.requests).toHaveLength(2);
    // conversation 第 3 条（index 2）是 tool 角色，含 tool_result
    expect(session.conversation[2].role).toBe('tool');
    expect(session.conversation[2].content[0]).toMatchObject({ type: 'tool_result', toolUseId: 'tu_1' });
    // 第 2 个请求的 messageCount = 3（user + assistant + tool）
    expect(session.requests[1].messageCount).toBe(3);
  });

  it('日志不含 system/tools/params，这些字段为空或默认', () => {
    const session = loadClaudeSession(resolve(fixturesDir, 'simple-session.jsonl'));
    expect(session.requests[0].system).toEqual([]);
    expect(session.requests[0].tools).toBeUndefined();
    expect(session.requests[0].model).toBe('');
  });
});

describe('deleteClaudeSession', () => {
  const tmpDir = resolve(__dirname, '../.tmp-delete-test');

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('removes the .jsonl file', () => {
    const src = resolve(tmpDir, 'a.jsonl');
    copyFileSync(resolve(fixturesDir, 'simple-session.jsonl'), src);
    expect(existsSync(src)).toBe(true);
    expect(deleteClaudeSession(src)).toBe(true);
    expect(existsSync(src)).toBe(false);
  });

  it('also removes same-basename sidecar files in the same directory', () => {
    const src = resolve(tmpDir, 'b.jsonl');
    copyFileSync(resolve(fixturesDir, 'simple-session.jsonl'), src);
    // Sidecars sharing the basename "b" (basename = id without .jsonl).
    const lock = resolve(tmpDir, 'b.lock');
    const meta = resolve(tmpDir, 'b.meta.json');
    const otherSession = resolve(tmpDir, 'ba.jsonl'); // different session id, must not be deleted
    const subdir = resolve(tmpDir, 'b'); // directory with same name as base — must not be touched
    writeFileSync(lock, 'lock data', 'utf-8');
    writeFileSync(meta, '{}', 'utf-8');
    writeFileSync(otherSession, '{}', 'utf-8');
    mkdirSync(subdir, { recursive: true });
    writeFileSync(resolve(subdir, 'inside.txt'), 'data', 'utf-8');

    expect(deleteClaudeSession(src)).toBe(true);

    expect(existsSync(src)).toBe(false);
    expect(existsSync(lock)).toBe(false);
    expect(existsSync(meta)).toBe(false);
    // A different session id (`ba.jsonl`) shares a string prefix with `b`
    // but must NOT be deleted.
    expect(existsSync(otherSession)).toBe(true);
    // A subdirectory whose name equals the base must not be followed into.
    expect(existsSync(subdir)).toBe(true);
    expect(existsSync(resolve(subdir, 'inside.txt'))).toBe(true);
  });

  it('returns false for a missing file', () => {
    expect(deleteClaudeSession(resolve(tmpDir, 'nope.jsonl'))).toBe(false);
  });
});

describe('exportClaudeSession', () => {
  const tmpDir = resolve(__dirname, '../.tmp-export-test');

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('copies the JSONL to the export path and leaves the original', () => {
    const src = resolve(tmpDir, 'orig.jsonl');
    copyFileSync(resolve(fixturesDir, 'simple-session.jsonl'), src);
    const dest = resolve(tmpDir, 'exported.jsonl');
    const result = exportClaudeSession(src, dest);
    expect(result).toBe(dest);
    expect(existsSync(dest)).toBe(true);
    expect(existsSync(src)).toBe(true);
    expect(readFileSync(dest, 'utf-8')).toBe(readFileSync(src, 'utf-8'));
  });

  it('returns null for a missing source', () => {
    expect(exportClaudeSession(resolve(tmpDir, 'gone.jsonl'), resolve(tmpDir, 'out.jsonl'))).toBeNull();
  });
});
