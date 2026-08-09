import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startProxyServer, ProxyServer } from '../../src/main/proxy/server';

/**
 * The proxy enforces a shared-secret guard on every capture endpoint.
 * These tests pin the 403 contract: requests without the matching
 * x-dialogueviz-key header are rejected at the auth middleware before
 * any handler runs, regardless of upstream reachability.
 *
 * We point the proxy at an unreachable upstream on purpose — if the
 * auth gate ever regresses, the test would surface a 502 (upstream
 * failure) rather than the expected 403.
 */
describe('proxy captureAuth middleware', () => {
  let server: ProxyServer;
  let port: number;

  beforeAll(async () => {
    // No real upstream needed — auth middleware should reject before any
    // outbound request fires.
    server = await startProxyServer(0, 'http://127.0.0.1:1', 'test-secret-abc');
    port = server.port;
  });

  afterAll(async () => {
    await server.stop();
  });

  async function post(path: string, headers: Record<string, string> = {}): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ model: 'm', messages: [] }),
    });
  }

  it('rejects POST /v1/messages without x-dialogueviz-key', async () => {
    const res = await post('/v1/messages');
    expect(res.status).toBe(403);
    const body = await res.json() as { error?: string };
    expect(body.error).toMatch(/forbidden/i);
  });

  it('rejects POST /v1/messages with a wrong key', async () => {
    const res = await post('/v1/messages', { 'x-dialogueviz-key': 'wrong-key' });
    expect(res.status).toBe(403);
  });

  it('lets POST /v1/messages past auth with the correct key', async () => {
    // We expect a non-403 — the upstream is intentionally unreachable so
    // this resolves to 502 (upstream error). What we care about is that
    // the auth middleware passed the request through.
    const res = await post('/v1/messages', { 'x-dialogueviz-key': 'test-secret-abc' });
    expect(res.status).not.toBe(403);
  });

  it('rejects POST /v1/responses without the header', async () => {
    const res = await post('/v1/responses');
    expect(res.status).toBe(403);
  });

  it('rejects POST /v1/messages/count_tokens without the header', async () => {
    const res = await post('/v1/messages/count_tokens');
    expect(res.status).toBe(403);
  });

  it('lets GET /v1/models through without the header (passthrough, no auth)', async () => {
    // /v1/models is intentionally NOT behind captureAuth — it's a
    // harmless listing endpoint. Verify it bypasses the gate so we
    // don't accidentally over-restrict future additions.
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`);
    // Upstream unreachable so we get 502 — the point is "not 403".
    expect(res.status).not.toBe(403);
  });
});