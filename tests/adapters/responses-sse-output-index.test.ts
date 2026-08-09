import { describe, it, expect } from 'vitest';
import { accumulateOpenaiResponsesSse } from '../../src/main/proxy/responses-sse';

// P1-1: when two function_calls share the same output_index, deltas
// should attach to the FIRST-registered call, not overwrite the
// routing map and pollute the second call. The synthetic-key branch
// (no call_id) is the realistic trigger for this: a provider that
// always sets output_index but forgets call_id.
//
// Done events are routed to the same first-registered key, so in
// practice the second call stays open (and would be closed by
// either a later done carrying its own call_id, or by the SSE
// stream ending). The test asserts the realistic behaviour.
describe('accumulateOpenaiResponsesSse (P1-1: shared output_index)', () => {
  it('routes deltas to the first-registered call when two share output_index', () => {
    // Split the JSON across the two deltas so concatenation is valid:
    // '{"a":' + '1,"shared":true}' => '{"a":1,"shared":true}'.
    const sse = [
      'data: ' + JSON.stringify({ type: 'response.created', response: { id: 'r', model: 'gpt-5' } }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'response.output_item.added', item: { type: 'function_call', name: 'tool_a', output_index: 0 } }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'response.output_item.added', item: { type: 'function_call', name: 'tool_b', output_index: 0 } }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'response.function_call_arguments.delta', item: { output_index: 0 }, delta: '{"a":' }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'response.function_call_arguments.delta', item: { output_index: 0 }, delta: '1,"shared":true}' }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'response.function_call_arguments.done', item: { output_index: 0 } }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'response.completed', response: { id: 'r', model: 'gpt-5', usage: {} } }) + '\n\n',
    ].join('');
    const result = accumulateOpenaiResponsesSse([sse]);
    expect(result).not.toBeNull();
    const toolUses = result!.content.filter((b) => b.type === 'tool_use');
    // tool_a was closed by the done event -> emitted as a tool_use.
    // tool_b never received a done event for itself -> NOT emitted.
    // The P1-1 invariant: tool_b is NOT polluted with tool_a's args.
    expect(toolUses.length).toBe(1);
    if (toolUses[0].type === 'tool_use') {
      expect(toolUses[0].name).toBe('tool_a');
      expect(toolUses[0].input).toEqual({ a: 1, shared: true });
    }
  });

  it('a second output_item.added with its own call_id is routed correctly even on a shared output_index', () => {
    // Provider bug: both calls share output_index=0, but the second
    // call DOES carry its own call_id. P1-1 should let the call_id
    // path take precedence and route deltas to the right slot.
    const sse = [
      'data: ' + JSON.stringify({ type: 'response.created', response: { id: 'r', model: 'gpt-5' } }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'response.output_item.added', item: { type: 'function_call', call_id: 'call-A', name: 'tool_a', output_index: 0 } }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'response.output_item.added', item: { type: 'function_call', call_id: 'call-B', name: 'tool_b', output_index: 0 } }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'response.function_call_arguments.delta', item: { call_id: 'call-A' }, delta: '{"a":' }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'response.function_call_arguments.delta', item: { call_id: 'call-B' }, delta: '{"b":' }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'response.function_call_arguments.delta', item: { call_id: 'call-A' }, delta: '1}' }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'response.function_call_arguments.delta', item: { call_id: 'call-B' }, delta: '2}' }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'response.function_call_arguments.done', item: { call_id: 'call-A' } }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'response.function_call_arguments.done', item: { call_id: 'call-B' } }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'response.completed', response: { id: 'r', model: 'gpt-5', usage: {} } }) + '\n\n',
    ].join('');
    const result = accumulateOpenaiResponsesSse([sse]);
    expect(result).not.toBeNull();
    const toolUses = result!.content.filter((b) => b.type === 'tool_use');
    expect(toolUses.length).toBe(2);
    const a = toolUses.find((b) => b.type === 'tool_use' && b.name === 'tool_a') as any;
    const b = toolUses.find((b) => b.type === 'tool_use' && b.name === 'tool_b') as any;
    expect(a?.input).toEqual({ a: 1 });
    expect(b?.input).toEqual({ b: 2 });
  });
});
