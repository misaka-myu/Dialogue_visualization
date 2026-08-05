import { describe, it, expect } from 'vitest';
import { scanClaudeSessions, parseSessionMeta, loadClaudeSession } from '../../src/main/adapters/claude-log';
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
