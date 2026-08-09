import { describe, it, expect } from 'vitest';
import { accumulateOpenaiResponsesSse } from '../../src/main/proxy/responses-sse';

// G-3 regression: when a tool-call's arguments arrive as a string the
// upstream provider couldn't (or wouldn't) JSON.parse, the accumulator
// must keep the raw string instead of discarding it. Old code silently
// returned {} and the user lost every hint of what the model tried to call.
describe('accumulateOpenaiResponsesSse (G-3: malformed tool args)', () => {
  it('preserves the raw args string when JSON.parse fails', () => {
    const sse = [
      'data: ' + JSON.stringify({ type: 'response.created', response: { id: 'r', model: 'gpt-5' } }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'response.output_item.added', item: { type: 'function_call', call_id: 'c1', name: 'broken' } }) + '\n\n',
      // Malformed JSON (missing closing brace).
      'data: ' + JSON.stringify({ type: 'response.function_call_arguments.delta', item: { call_id: 'c1' }, delta: '{"path":' }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'response.function_call_arguments.done', item: { call_id: 'c1' } }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'response.completed', response: { id: 'r', model: 'gpt-5', usage: {} } }) + '\n\n',
    ].join('');
    const result = accumulateOpenaiResponsesSse([sse]);
    expect(result).not.toBeNull();
    const tool = result!.content.find((b) => b.type === 'tool_use');
    expect(tool).toBeDefined();
    if (tool!.type === 'tool_use') {
      // We keep the raw string so the renderer can show "model produced
      // malformed JSON" rather than a silently empty input.
      expect(tool.input).toBe('{"path":');
    }
  });

  it('still parses cleanly when JSON is valid', () => {
    const sse = [
      'data: ' + JSON.stringify({ type: 'response.created', response: { id: 'r', model: 'gpt-5' } }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'response.output_item.added', item: { type: 'function_call', call_id: 'c1', name: 'ok' } }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'response.function_call_arguments.delta', item: { call_id: 'c1' }, delta: '{"a":1}' }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'response.function_call_arguments.done', item: { call_id: 'c1' } }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'response.completed', response: { id: 'r', model: 'gpt-5', usage: {} } }) + '\n\n',
    ].join('');
    const result = accumulateOpenaiResponsesSse([sse]);
    const tool = result!.content.find((b) => b.type === 'tool_use');
    if (tool!.type === 'tool_use') {
      expect(tool.input).toEqual({ a: 1 });
    }
  });
});
