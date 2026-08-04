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
  it('把 assistant 消息重建为请求的响应，messages 累积', () => {
    const session = loadClaudeSession(resolve(fixturesDir, 'simple-session.jsonl'));
    expect(session.client).toBe('claude-code');
    expect(session.source).toBe('claude-code-log');
    // 2 个 assistant 消息 -> 2 个 ApiRequest
    expect(session.requests).toHaveLength(2);

    // 第 1 个请求：messages = [user "帮我修 bug"]，response = "我来看看"
    expect(session.requests[0].messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: '帮我修 bug' }] },
    ]);
    expect(session.requests[0].response?.content).toEqual([{ type: 'text', text: '我来看看' }]);

    // 第 2 个请求：messages 累积了第 1 个 assistant，response = "找到问题了"
    expect(session.requests[1].messages).toHaveLength(2);
    expect(session.requests[1].messages[1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: '我来看看' }] });
    expect(session.requests[1].response?.content).toEqual([{ type: 'text', text: '找到问题了' }]);
  });

  it('tool_result 在 user 消息里被重分类为 tool 角色', () => {
    const session = loadClaudeSession(resolve(fixturesDir, 'tool-use-session.jsonl'));
    expect(session.requests).toHaveLength(2);
    // 第 1 个请求的 messages = [user "读文件"]
    // 第 2 个请求的 messages = [user, assistant(带 tool_use), tool(tool_result)]
    const req2 = session.requests[1];
    expect(req2.messages[2].role).toBe('tool');
    expect(req2.messages[2].content[0]).toMatchObject({ type: 'tool_result', toolUseId: 'tu_1' });
  });

  it('日志不含 system/tools/params，这些字段为空或默认', () => {
    const session = loadClaudeSession(resolve(fixturesDir, 'simple-session.jsonl'));
    expect(session.requests[0].system).toEqual([]);
    expect(session.requests[0].tools).toBeUndefined();
    expect(session.requests[0].model).toBe('');
  });
});
