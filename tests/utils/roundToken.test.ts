import { describe, it, expect } from 'vitest';
import { buildRoundTokenSeries } from '../../src/renderer/utils/roundToken';
import type { Session, ApiRequest, Message } from '../../src/main/model/types';

function makeSession(requests: ApiRequest[], conversation: Message[]): Session {
  return {
    id: 's1',
    source: 'claude-code-log',
    client: 'claude-code',
    startedAt: 0,
    requests,
    conversation,
  };
}

describe('buildRoundTokenSeries', () => {
  it('returns an empty array for an empty session', () => {
    expect(buildRoundTokenSeries(makeSession([], []))).toEqual([]);
  });

  it('estimates from message length when no ApiRequest has a usage block', () => {
    // 1 user turn + 1 assistant turn, no captured usage data.
    const conversation: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'a'.repeat(400) }] },
      { role: 'assistant', content: [{ type: 'text', text: 'b'.repeat(800) }] },
    ];
    const series = buildRoundTokenSeries(makeSession([], conversation));
    expect(series).toHaveLength(1);
    expect(series[0].source).toBe('estimate');
    expect(series[0].inputTokens).toBe(100); // 400 / 4
    expect(series[0].outputTokens).toBe(200); // 800 / 4
    expect(series[0].cacheReadTokens).toBe(0);
  });

  it('prefers real usage when any request in the round has it', () => {
    const conversation: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'q' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'a' }] },
    ];
    const requests: ApiRequest[] = [
      {
        id: 'r1',
        timestamp: 1,
        model: 'claude-3-5-sonnet',
        system: [],
        messageCount: 2,
        params: { maxTokens: 0 },
        response: {
          content: [],
          stopReason: '',
          usage: {
            inputTokens: 100,
            outputTokens: 200,
            cacheReadTokens: 30,
            cacheCreationTokens: 5,
            model: 'claude-3-5-sonnet',
          },
        },
      },
    ];
    const series = buildRoundTokenSeries(makeSession(requests, conversation));
    expect(series).toHaveLength(1);
    expect(series[0].source).toBe('real');
    expect(series[0].inputTokens).toBe(100);
    expect(series[0].outputTokens).toBe(200);
    expect(series[0].cacheReadTokens).toBe(30);
    expect(series[0].cacheCreationTokens).toBe(5);
    expect(series[0].model).toBe('claude-3-5-sonnet');
  });

  it('sums multiple requests within the same round', () => {
    // user -> asst (req1) -> tool result -> asst (req2) -> user (next round)
    const conversation: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'q' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'Bash', input: {} }] },
      { role: 'tool', content: [{ type: 'tool_result', toolUseId: 't', content: 'out' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'final' }] },
      { role: 'user', content: [{ type: 'text', text: 'q2' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'a2' }] },
    ];
    const requests: ApiRequest[] = [
      {
        id: 'r1',
        timestamp: 1, model: 'm', system: [], messageCount: 4,
        params: { maxTokens: 0 },
        response: { content: [], stopReason: '', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0 } },
      },
      {
        id: 'r2',
        timestamp: 2, model: 'm', system: [], messageCount: 5,
        params: { maxTokens: 0 },
        response: { content: [], stopReason: '', usage: { inputTokens: 20, outputTokens: 8, cacheReadTokens: 0, cacheCreationTokens: 0 } },
      },
      {
        id: 'r3',
        timestamp: 3, model: 'm', system: [], messageCount: 6,
        params: { maxTokens: 0 },
        response: { content: [], stopReason: '', usage: { inputTokens: 30, outputTokens: 12, cacheReadTokens: 0, cacheCreationTokens: 0 } },
      },
    ];
    const series = buildRoundTokenSeries(makeSession(requests, conversation));
    expect(series).toHaveLength(2);
    // Round 0: r1 (messageCount=4) belongs to round 0 (covers up to
    // message [3], the last asst of round 0). r2/r3 messageCount >=
    // 5 means they were sent *after* user q2, i.e. they belong to
    // round 1 even though they reference earlier messages.
    expect(series[0].source).toBe('real');
    expect(series[0].inputTokens).toBe(10);
    expect(series[0].outputTokens).toBe(5);
    // Round 1: r2 + r3.
    expect(series[1].inputTokens).toBe(20 + 30);
    expect(series[1].outputTokens).toBe(8 + 12);
  });

  it('caps estimation at the next round (does not include other rounds)', () => {
    const conversation: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'q1' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'a1' }] },
      { role: 'user', content: [{ type: 'text', text: 'q2' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'a2' }] },
    ];
    const series = buildRoundTokenSeries(makeSession([], conversation));
    expect(series).toHaveLength(2);
    // Round 0 should include only q1 + a1, not q2 + a2.
    expect(series[0].inputTokens + series[0].outputTokens).toBe(2); // q1 (1 tok) + a1 (1 tok)
    expect(series[1].inputTokens + series[1].outputTokens).toBe(2); // q2 + a2
  });

  it('estimates image blocks at 1000 tokens each (vision session sanity)', () => {
    // extractMessageText returns '' for image blocks, so without the
    // image estimate the round would count as 0 tokens. ~1000/image
    // matches Anthropic's published per-image token equivalents.
    const conversation: Message[] = [
      { role: 'user', content: [
        { type: 'text', text: 'what is this' },
        { type: 'image', source: { type: 'base64', mediaType: 'image/png' } },
        { type: 'image', source: { type: 'base64', mediaType: 'image/png' } },
      ] },
      { role: 'assistant', content: [{ type: 'text', text: 'cat' }] },
    ];
    const series = buildRoundTokenSeries(makeSession([], conversation));
    expect(series).toHaveLength(1);
    // "what is this" (12 chars / 4 = 3) + 2 images * 1000 = 2003 input.
    expect(series[0].inputTokens).toBe(2003);
    expect(series[0].source).toBe('estimate');
  });

  it('preserves real cache_read > input split (long-session shape)', () => {
    // On long sessions Anthropic's prompt cache hits can exceed new
    // input tokens. buildRoundTokenSeries should sum them faithfully
    // and not let cache_read zero out the input total.
    const conversation: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'q' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'a' }] },
    ];
    const requests: ApiRequest[] = [
      {
        id: 'r1', timestamp: 1, model: 'm', system: [], messageCount: 2,
        params: { maxTokens: 0 },
        response: { content: [], stopReason: '', usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 9999, cacheCreationTokens: 0 } },
      },
    ];
    const series = buildRoundTokenSeries(makeSession(requests, conversation));
    expect(series).toHaveLength(1);
    expect(series[0].cacheReadTokens).toBe(9999);
    expect(series[0].inputTokens).toBe(100);
    expect(series[0].source).toBe('real');
  });

  it('falls back to estimate when only some requests in a round have usage', () => {
    // Two requests, only the first has real usage. The second is
    // dropped (messageCount too high for round 0, so it doesn't
    // count). End state: source is 'real' (because at least one
    // request in the round had a usage block).
    const conversation: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'q' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'a' }] },
    ];
    const requests: ApiRequest[] = [
      {
        id: 'r1', timestamp: 1, model: 'm', system: [], messageCount: 2,
        params: { maxTokens: 0 },
        response: { content: [], stopReason: '', usage: { inputTokens: 5, outputTokens: 3, cacheReadTokens: 0, cacheCreationTokens: 0 } },
      },
    ];
    const series = buildRoundTokenSeries(makeSession(requests, conversation));
    expect(series).toHaveLength(1);
    expect(series[0].source).toBe('real');
    expect(series[0].inputTokens).toBe(5);
  });
});