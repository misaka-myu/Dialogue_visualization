import { describe, it, expect } from 'vitest';
import { accumulateOpenaiResponsesSse } from '../../src/main/proxy/responses-sse';

/** Build a single SSE chunk string from a list of event objects. */
function sseChunk(events: { type: string; [key: string]: any }[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
}

describe('accumulateOpenaiResponsesSse', () => {
  it('returns null for empty input', () => {
    expect(accumulateOpenaiResponsesSse([])).toBeNull();
  });

  it('accumulates text deltas into a text block', () => {
    const sse = sseChunk([
      { type: 'response.created', response: { id: 'resp-1', model: 'gpt-5' } },
      { type: 'response.output_item.added', item: { type: 'message', id: 'msg-1' } },
      { type: 'response.output_text.delta', delta: 'Hello ' },
      { type: 'response.output_text.delta', delta: 'world' },
      { type: 'response.output_text.done' },
      { type: 'response.completed', response: { id: 'resp-1', model: 'gpt-5', status: 'completed', usage: { input_tokens: 10, output_tokens: 5 } } },
    ]);
    const result = accumulateOpenaiResponsesSse([sse]);
    expect(result).not.toBeNull();
    expect(result!.content.length).toBe(1);
    expect(result!.content[0]).toEqual({ type: 'text', text: 'Hello world' });
    expect(result!.usage.model).toBe('gpt-5');
    expect(result!.usage.messageId).toBe('resp-1');
    expect(result!.usage.inputTokens).toBe(10);
    expect(result!.usage.outputTokens).toBe(5);
  });

  it('accumulates function_call arguments into a tool_use block', () => {
    const sse = sseChunk([
      { type: 'response.created', response: { id: 'resp-2', model: 'gpt-5' } },
      { type: 'response.output_item.added', item: { type: 'function_call', id: 'fc-1', call_id: 'call-1', name: 'read_file' } },
      { type: 'response.function_call_arguments.delta', item: { call_id: 'call-1' }, delta: '{"path":"' },
      { type: 'response.function_call_arguments.delta', item: { call_id: 'call-1' }, delta: '/tmp/test.txt"}' },
      { type: 'response.function_call_arguments.done', item: { call_id: 'call-1' } },
      { type: 'response.completed', response: { id: 'resp-2', model: 'gpt-5', usage: { input_tokens: 20, output_tokens: 10 } } },
    ]);
    const result = accumulateOpenaiResponsesSse([sse]);
    expect(result).not.toBeNull();
    const toolUse = result!.content.find((b) => b.type === 'tool_use');
    expect(toolUse).toBeDefined();
    if (toolUse!.type === 'tool_use') {
      expect(toolUse.id).toBe('call-1');
      expect(toolUse.name).toBe('read_file');
      expect(toolUse.input).toEqual({ path: '/tmp/test.txt' });
    }
  });

  it('keeps first non-null model/id when multiple events provide it', () => {
    const sse = sseChunk([
      { type: 'response.created', response: { id: 'resp-1', model: 'gpt-5' } },
      { type: 'response.in_progress', response: { id: '', model: '' } },
      { type: 'response.completed', response: { id: 'resp-1', model: 'gpt-5', usage: {} } },
    ]);
    const result = accumulateOpenaiResponsesSse([sse]);
    expect(result).not.toBeNull();
    expect(result!.usage.model).toBe('gpt-5');
    expect(result!.usage.messageId).toBe('resp-1');
  });

  it('handles multiple function_calls without index collision', () => {
    const sse = sseChunk([
      { type: 'response.created', response: { id: 'resp-3', model: 'gpt-5' } },
      { type: 'response.output_item.added', item: { type: 'function_call', id: 'fc-1', call_id: 'call-A', name: 'tool_a' } },
      { type: 'response.output_item.added', item: { type: 'function_call', id: 'fc-2', call_id: 'call-B', name: 'tool_b' } },
      { type: 'response.function_call_arguments.delta', item: { call_id: 'call-A' }, delta: '{"x":1}' },
      { type: 'response.function_call_arguments.delta', item: { call_id: 'call-B' }, delta: '{"y":2}' },
      { type: 'response.function_call_arguments.done', item: { call_id: 'call-A' } },
      { type: 'response.function_call_arguments.done', item: { call_id: 'call-B' } },
      { type: 'response.completed', response: { id: 'resp-3', model: 'gpt-5', usage: {} } },
    ]);
    const result = accumulateOpenaiResponsesSse([sse]);
    expect(result).not.toBeNull();
    const toolUses = result!.content.filter((b) => b.type === 'tool_use');
    expect(toolUses.length).toBe(2);
    const names = toolUses.map((b) => (b.type === 'tool_use' ? b.name : ''));
    expect(names).toContain('tool_a');
    expect(names).toContain('tool_b');
  });

  it('returns stopReason from response.completed status', () => {
    const sse = sseChunk([
      { type: 'response.created', response: { id: 'resp-4', model: 'gpt-5' } },
      { type: 'response.completed', response: { id: 'resp-4', model: 'gpt-5', status: 'completed', usage: {} } },
    ]);
    const result = accumulateOpenaiResponsesSse([sse]);
    expect(result).not.toBeNull();
    expect(result!.stopReason).toBe('completed');
  });
});
