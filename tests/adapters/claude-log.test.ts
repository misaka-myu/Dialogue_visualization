import { describe, it, expect } from 'vitest';
import { scanClaudeSessions, parseSessionMeta } from '../../src/main/adapters/claude-log';
import { resolve } from 'path';

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
