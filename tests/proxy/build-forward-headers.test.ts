import { describe, it, expect } from 'vitest';
import { buildForwardHeaders } from '../../src/main/proxy/server';

// A-5/C-1: Node 18+ / Express v5 can deliver header values as string[]
// for repeated headers (e.g. multiple `Cookie` or `X-Forwarded-For`).
// The old code did `typeof value === 'string'` and silently dropped
// array values, causing upstream to see a missing header. The new
// implementation joins with `, ` per RFC 7230 §3.2.2.
describe('buildForwardHeaders', () => {
  function makeReq(headers: Record<string, string | string[] | undefined>) {
    return { headers } as any;
  }

  it('passes a plain string header through unchanged', () => {
    const out = buildForwardHeaders(makeReq({ authorization: 'Bearer x' }));
    expect(out.authorization).toBe('Bearer x');
  });

  it('joins string[] values with `, `', () => {
    const out = buildForwardHeaders(
      makeReq({ cookie: ['a=1', 'b=2', 'c=3'] }),
    );
    expect(out.cookie).toBe('a=1, b=2, c=3');
  });

  it('strips hop-by-hop and proxy-internal headers', () => {
    const out = buildForwardHeaders(
      makeReq({
        authorization: 'Bearer x',
        host: 'evil.example',
        connection: 'close',
        'x-dialogueviz-key': 'leak',
        cookie: ['a=1', 'b=2'],
      }),
    );
    expect(out.authorization).toBe('Bearer x');
    expect(out.cookie).toBe('a=1, b=2');
    expect(out.host).toBeUndefined();
    expect(out.connection).toBeUndefined();
    expect(out['x-dialogueviz-key']).toBeUndefined();
  });

  it('skips a key whose array is empty after string filtering', () => {
    const out = buildForwardHeaders(
      makeReq({ 'x-garbage': [123 as any, 456 as any] }),
    );
    expect(out['x-garbage']).toBeUndefined();
  });
});
