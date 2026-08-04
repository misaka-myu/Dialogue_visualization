// tests/model/normalizer.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeAnthropicRequest, normalizeAnthropicResponse, normalizeContent } from '../../src/main/model/normalizer';

describe('normalizeContent', () => {
  it('把字符串 content 归一成单元素 text 数组', () => {
    expect(normalizeContent('hello')).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('把数组 content 归一成 ContentBlock[]', () => {
    const input = [{ type: 'text', text: 'hi' }];
    expect(normalizeContent(input)).toEqual([{ type: 'text', text: 'hi' }]);
  });

  it('把 tool_use 块的 tool_use_id 转成 toolUseId', () => {
    const input = [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'result' }];
    expect(normalizeContent(input)).toEqual([
      { type: 'tool_result', toolUseId: 'tu_1', content: 'result', isError: undefined },
    ]);
  });

  it('忽略未知类型的块', () => {
    expect(normalizeContent([{ type: 'unknown' }])).toEqual([]);
  });
});

describe('normalizeAnthropicRequest', () => {
  it('归一 system 字符串、messages、params（snake_case 转驼峰）', () => {
    const body = {
      model: 'claude-sonnet-5',
      system: '你是 Claude Code',
      messages: [{ role: 'user', content: '帮我修 bug' }],
      max_tokens: 8192,
      temperature: 1.0,
    };
    const req = normalizeAnthropicRequest(body, 1000, 'r1');
    expect(req.model).toBe('claude-sonnet-5');
    expect(req.system).toEqual([{ type: 'text', text: '你是 Claude Code' }]);
    expect(req.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: '帮我修 bug' }] }]);
    expect(req.params).toEqual({ maxTokens: 8192, temperature: 1.0 });
    expect(req.tools).toBeUndefined();
  });

  it('归一 system 数组形式', () => {
    const body = { model: 'm', system: [{ type: 'text', text: 'sys' }], messages: [], max_tokens: 100 };
    const req = normalizeAnthropicRequest(body, 0, 'r2');
    expect(req.system).toEqual([{ type: 'text', text: 'sys' }]);
  });

  it('归一 tools 定义（input_schema -> inputSchema）', () => {
    const body = {
      model: 'm', system: '', messages: [], max_tokens: 100,
      tools: [{ name: 'Read', description: '读文件', input_schema: { type: 'object' } }],
    };
    const req = normalizeAnthropicRequest(body, 0, 'r3');
    expect(req.tools).toEqual([{ name: 'Read', description: '读文件', inputSchema: { type: 'object' } }]);
  });
});

describe('normalizeAnthropicResponse', () => {
  it('归一响应的 content 和 usage（snake_case 转驼峰）', () => {
    const body = {
      id: 'msg_123', model: 'claude-sonnet-5', stop_reason: 'end_turn',
      content: [{ type: 'text', text: '答案' }],
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 20, cache_creation_input_tokens: 10 },
    };
    const res = normalizeAnthropicResponse(body);
    expect(res.stopReason).toBe('end_turn');
    expect(res.content).toEqual([{ type: 'text', text: '答案' }]);
    expect(res.usage).toEqual({
      inputTokens: 100, outputTokens: 50, cacheReadTokens: 20, cacheCreationTokens: 10,
      model: 'claude-sonnet-5', messageId: 'msg_123',
    });
  });
});
