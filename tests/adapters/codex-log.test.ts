import { describe, it, expect } from 'vitest';
import { loadCodexSession } from '../../src/main/adapters/codex-log';
import { resolve } from 'path';

const fixturesDir = resolve(__dirname, '../fixtures');

describe('loadCodexSession', () => {
  const session = loadCodexSession(resolve(fixturesDir, 'codex-rollout.jsonl'));

  it('sets source and client to codex', () => {
    expect(session.source).toBe('codex-log');
    expect(session.client).toBe('codex');
  });

  it('extracts session_id and cwd from session_meta', () => {
    expect(session.id).toBe('019fadaa-2859-7851-94e6-f1fc37f23df9');
    expect(session.projectDir).toBe('c:\\Users\\test\\project');
  });

  it('builds conversation with user + assistant + tool messages', () => {
    expect(session.conversation.length).toBeGreaterThanOrEqual(3);
    const user = session.conversation.find((m) => m.role === 'user');
    expect(user).toBeDefined();
    expect(user!.content[0]).toEqual({ type: 'text', text: 'hello world' });

    const assistant = session.conversation.find((m) => m.role === 'assistant');
    expect(assistant).toBeDefined();
    expect(assistant!.content.some((b) => b.type === 'text' && b.text.includes('How can I help'))).toBe(true);
  });

  it('maps function_call to tool_use block on assistant message', () => {
    const assistant = session.conversation.find((m) => m.role === 'assistant');
    const toolUse = assistant!.content.find((b) => b.type === 'tool_use');
    expect(toolUse).toBeDefined();
    expect(toolUse!.type).toBe('tool_use');
    if (toolUse!.type === 'tool_use') {
      expect(toolUse.id).toBe('call-1');
      expect(toolUse.name).toBe('read_file');
      expect(toolUse.input).toEqual({ path: '/tmp/test.txt' });
    }
  });

  it('maps function_call_output to tool_result', () => {
    const toolResult = session.conversation.find((m) =>
      m.content.some((b) => b.type === 'tool_result'),
    );
    expect(toolResult).toBeDefined();
    const block = toolResult!.content.find((b) => b.type === 'tool_result');
    if (block!.type === 'tool_result') {
      expect(block.toolUseId).toBe('call-1');
      expect(block.content).toBe('file contents here');
    }
  });

  it('derives title from first user message', () => {
    expect(session.title).toBe('hello world');
  });

  it('populates requests with usage from token_count event', () => {
    expect(session.requests.length).toBeGreaterThanOrEqual(1);
    const req = session.requests[0];
    expect(req.response).toBeDefined();
    expect(req.response!.usage.inputTokens).toBe(100);
    expect(req.response!.usage.outputTokens).toBe(50);
    expect(req.response!.usage.cacheReadTokens).toBe(10);
  });

  it('stores all parsed lines in rawLines', () => {
    expect(session.rawLines.length).toBe(10);
  });

  it('ignores turn_context and world_state without error', () => {
    // If these were not ignored, they'd either error or pollute conversation.
    // Verify conversation only has user/assistant/tool roles.
    for (const m of session.conversation) {
      expect(['user', 'assistant', 'tool', 'system']).toContain(m.role);
    }
  });
});
