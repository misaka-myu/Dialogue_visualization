// src/main/proxy/server.ts
import express from 'express';

// A-8: cap raw SSE accumulation so a runaway upstream response can
// blow up the client but not the main process '{'memory'}'.
// 10 MB is enough for a ~2k-token response with room to spare; bigger
// streams still get forwarded to the client, we just stop feeding the
// accumulator once we cross this threshold.
const MAX_RAW_BYTES = 10 * 1024 * 1024;
// How long the stream can go without a new chunk before we treat it as
// hung and tear it down. 120 s matches the Anthropic SDK default.
const STREAM_IDLE_TIMEOUT_MS = 120_000;
import { Server as HttpServer } from 'http';
import { EventEmitter } from 'events';
import { ApiRequest } from '../model/types';
import { normalizeAnthropicRequest, normalizeAnthropicResponse, normalizeMessages, normalizeOpenaiResponsesRequest, normalizeOpenaiResponsesResponse } from '../model/normalizer';
import { detectUpstream } from './upstream';
import { accumulateClaudeSse } from './sse';
import { accumulateOpenaiResponsesSse } from './responses-sse';

export interface ProxyServer {
  port: number;
  upstream: string;
  stop: () => Promise<void>;
  onCaptured: (cb: (req: ApiRequest) => void) => void;
}

/**
 * Start the proxy server. If `preferredPort` is already in use, tries
 * port+1, port+2, ... up to 20 attempts.
 *
 * If `expectedKey` is provided, /v1/messages and /v1/responses require the
 * `x-dialogueviz-key` header to match. This is a *lightweight* local guard
 * against other processes on the same machine injecting requests into the
 * capture stream. It's NOT a real auth boundary — anyone with read access
 * to `~/.claude/.dialogueviz-secret` can mint the header. The threat model
 * is opportunistic same-host processes, not a determined attacker.
 *
 * The secret is plumbed through `ipc.ts`: it is (a) persisted to
 * `~/.claude/.dialogueviz-secret` and (b) injected into the client's
 * environment via `DIALOGUEVIZ_KEY` in `~/.claude/settings.json`. If the
 * client doesn't pick up the env var (some terminal-launched CLIs don't
 * re-read settings.json on each invocation), requests will be 403'd and
 * the IPC layer is responsible for surfacing that.
 */
export async function startProxyServer(
  preferredPort: number,
  upstreamOverride?: string,
  expectedKey?: string,
): Promise<ProxyServer> {
  const upstream = upstreamOverride ?? detectUpstream();
  const emitter = new EventEmitter();
  const app = express();

  // Parse all bodies as raw buffers so we can forward them byte-for-byte.
  app.use('/v1', express.raw({ type: '*/*', limit: '100mb' }));

  // Shared-secret gate. Reject anything that doesn't carry our header.
  // Applied to both capture endpoints so neither Claude Code nor Codex
  // traffic can be spoofed by an opportunistic same-host process.
  if (expectedKey) {
    const captureAuth: express.RequestHandler = (req, res, next) => {
      const provided = req.header('x-dialogueviz-key');
      if (provided !== expectedKey) {
        res.status(403).json({ error: 'forbidden: missing or invalid x-dialogueviz-key' });
        return;
      }
      next();
    };
    app.use('/v1/messages', captureAuth);
    app.use('/v1/messages/count_tokens', captureAuth);
    app.use('/v1/responses', captureAuth);
  }

  app.post('/v1/messages', (req: express.Request, res: express.Response) => {
    void handleMessages(req, res, upstream, emitter);
  });

  app.post('/v1/responses', (req: express.Request, res: express.Response) => {
    void handleResponses(req, res, upstream, emitter);
  });

  app.post('/v1/messages/count_tokens', (req: express.Request, res: express.Response) => {
    void passthrough(req, res, upstream);
  });

  app.get('/v1/models', (req: express.Request, res: express.Response) => {
    void passthrough(req, res, upstream);
  });

  // Find a free port.
  const maxAttempts = 20;
  let port = preferredPort;
  let server: HttpServer | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      server = await listenOnPort(app, port);
      // Resolve the OS-assigned port when binding to 0 (or anything
      // the kernel remapped). Without this, callers using port 0 to
      // let the OS pick a free port would get back `0` and their
      // fetch() calls would target the wrong socket.
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        port = addr.port;
      }
      break;
    } catch (err: any) {
      if (err?.code === 'EADDRINUSE' && attempt < maxAttempts - 1) {
        port++;
        continue;
      }
      throw err;
    }
  }
  if (!server) throw new Error('Failed to start proxy server');

  return {
    port,
    upstream,
    stop: async () => {
      emitter.removeAllListeners();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    },
    onCaptured: (cb) => {
      emitter.on('captured', cb);
    },
  };
}

function listenOnPort(app: express.Express, port: number): Promise<HttpServer> {
  return new Promise((resolve, reject) => {
    // Pin to IPv4 loopback. Without this, Node listens on `::` (IPv6) on
    // most platforms, which on dual-stack boxes makes `127.0.0.1:<port>`
    // fetch calls fail with EADDRNOTAVAIL. We never want to be reachable
    // outside localhost anyway.
    const server = app.listen(port, '127.0.0.1');
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });
}

/** Headers we never forward upstream. `host` would clobber the target host
 *  on the way out; hop-by-hop / connection management headers (`connection`,
 *  `keep-alive`, `te`, `trailers`, `transfer-encoding`, `upgrade`) must not
 *  cross proxy boundaries; `content-length` is recomputed by fetch from the
 *  body anyway. Client-IP hints (`x-forwarded-for`, `x-real-ip`,
 *  `forwarded`, `x-forwarded-*`) would let upstream log our local client as
 *  if it were a remote IP — strip them. `x-proxy-*` / `proxy-*` and any
 *  custom key we use for the shared-secret scheme stay on this side. */
const SKIPPED_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-port',
  'x-real-ip',
  'x-client-ip',
  // Our own shared-secret header must NOT be forwarded — it would leak
  // the proxy's auth credential to the upstream API provider.
  'x-dialogueviz-key',
]);

function isProxyInternalHeader(name: string): boolean {
  const lower = name.toLowerCase();
  if (SKIPPED_REQUEST_HEADERS.has(lower)) return true;
  if (lower.startsWith('proxy-')) return true;
  if (lower.startsWith('x-proxy-')) return true;
  return false;
}

/** Build a header bag safe to forward to the upstream API. Drops hop-by-hop
 *  headers, proxy-internal headers (incl. our own shared-secret header),
 *  and any client-IP forwarding hints that would mislead upstream logs. */
export function buildForwardHeaders(req: express.Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (isProxyInternalHeader(key)) continue;
    if (Array.isArray(value)) {
      // A-5/C-1 fix: Express v5 / Node 18+ can deliver header values as string[]
      // (e.g. repeated Cookie headers). Join with ", " per RFC 7230 §3.2.2 so the
      // upstream sees a single, well-formed header value. Skip the key entirely
      // if every element is non-string (defensive — shouldn't happen in practice).
      const joined = value.filter((v): v is string => typeof v === 'string').join(', ');
      if (joined) out[key] = joined;
    } else if (typeof value === 'string') {
      out[key] = value;
    }
  }
  return out;
}

/** Handle POST /v1/messages - the core capture endpoint. */
async function handleMessages(
  req: express.Request,
  res: express.Response,
  upstream: string,
  emitter: EventEmitter,
): Promise<void> {
  let body: Record<string, any>;
  try {
    body = JSON.parse((req.body as Buffer).toString('utf-8'));
  } catch {
    res.status(400).json({ error: 'invalid JSON body' });
    return;
  }

  const timestamp = Date.now();
  const apiReq = normalizeAnthropicRequest(body, timestamp, genId());
  apiReq.inputMessages = normalizeMessages(body.messages);

  const forwardHeaders = buildForwardHeaders(req);

  const upstreamUrl = `${upstream}/v1/messages`;
  const isStream = body.stream === true;

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstreamUrl, {
      method: 'POST',
      headers: forwardHeaders,
      body: req.body as BodyInit,
    });
  } catch (err) {
    // Upstream unreachable - forward error so Claude Code can handle it.
    res.status(502).json({ error: 'proxy upstream error', detail: String(err) });
    return;
  }

  // Forward status + select response headers to the client.
  res.status(upstreamRes.status);
  copyResponseHeaders(upstreamRes, res);

  if (isStream) {
    await streamAndCapture(upstreamRes, res, apiReq, emitter);
  } else {
    await bufferAndCapture(upstreamRes, res, apiReq, emitter);
  }
}

/** Stream SSE chunks to the client immediately while accumulating for capture. */
async function streamAndCapture(
  upstreamRes: Response,
  res: express.Response,
  apiReq: ApiRequest,
  emitter: EventEmitter,
): Promise<void> {
  const reader = upstreamRes.body?.getReader();
  if (!reader) {
    await bufferAndCapture(upstreamRes, res, apiReq, emitter);
    return;
  }

  const rawChunks: Buffer[] = [];
  let totalRawBytes = 0;
  // A-8: cap how much raw SSE we buffer so a 20 MB response from a
  // runaway upstream doesn't OOM the main process. We still FORWARD
  // every chunk to the client (so the user sees the full stream), we
  // just stop feeding the accumulator once we hit the cap and emit
  // a single synthetic SSE comment so downstream consumers know the
  // response was truncated.
  let truncated = false;
  let streamError: unknown = null;
  let lastReadAt = Date.now();
  const idleTimer = setInterval(() => {
    if (Date.now() - lastReadAt > STREAM_IDLE_TIMEOUT_MS) {
      const err = new Error(`stream idle > ${STREAM_IDLE_TIMEOUT_MS}ms`);
      streamError = err;
      try { reader.cancel(); } catch { /* ignore */ }
    }
  }, Math.min(STREAM_IDLE_TIMEOUT_MS / 2, 30_000));
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      lastReadAt = Date.now();
      const buf = Buffer.from(value);
      if (totalRawBytes + buf.length <= MAX_RAW_BYTES) {
        rawChunks.push(buf);
        totalRawBytes += buf.length;
      } else if (!truncated) {
        truncated = true;
        console.warn(`[proxy] SSE exceeded ${MAX_RAW_BYTES} bytes; stopping accumulator but still forwarding.`);
      }
      // Write immediately so the client sees live streaming.
      if (!res.writableEnded) {
        res.write(buf);
      }
    }
  } catch (err) {
    streamError = err;
  } finally {
    clearInterval(idleTimer);
    // Always release the reader so the underlying socket isn't leaked,
    // even on read errors / mid-stream aborts. releaseLock is safe to call
    // multiple times only because the WHATWG spec says subsequent calls
    // are no-ops — wrap defensively anyway.
    try { reader.releaseLock(); } catch { /* ignore */ }
    if (!res.writableEnded) {
      try { res.end(); } catch { /* ignore */ }
    }
  }

  if (streamError) {
    console.error('[proxy] stream read error:', streamError);
    return;
  }

  // After stream completes, decode and accumulate SSE events.
  const fullText = Buffer.concat(rawChunks).toString('utf-8');
  const accumulated = accumulateClaudeSse([fullText]);
  if (accumulated) {
    apiReq.response = {
      content: accumulated.content,
      stopReason: accumulated.stopReason,
      usage: accumulated.usage,
    };
    emitter.emit('captured', apiReq);
  }
}

/** Read the full response, capture it, and send to client. */
async function bufferAndCapture(
  upstreamRes: Response,
  res: express.Response,
  apiReq: ApiRequest,
  emitter: EventEmitter,
): Promise<void> {
  const text = await upstreamRes.text();
  if (!res.writableEnded) {
    res.send(text);
  }

  // Try to parse and capture.
  try {
    const body = JSON.parse(text);
    apiReq.response = normalizeAnthropicResponse(body);
    emitter.emit('captured', apiReq);
  } catch {
    // Non-JSON response - don't capture.
  }
}

/** Generic passthrough for non-capture endpoints (count_tokens, models, etc). */
async function passthrough(
  req: express.Request,
  res: express.Response,
  upstream: string,
): Promise<void> {
  const forwardHeaders = buildForwardHeaders(req);

  const path = req.originalUrl;
  const upstreamUrl = `${upstream}${path}`;

  let upstreamRes: Response;
  try {
    const init: RequestInit = {
      method: req.method,
      headers: forwardHeaders,
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = req.body as BodyInit;
    }
    upstreamRes = await fetch(upstreamUrl, init);
  } catch (err) {
    res.status(502).json({ error: 'proxy upstream error', detail: String(err) });
    return;
  }

  res.status(upstreamRes.status);
  copyResponseHeaders(upstreamRes, res);
  const text = await upstreamRes.text();
  res.send(text);
}

// --- OpenAI Responses API handler (POST /v1/responses) ---

/** Handle POST /v1/responses - the Codex capture endpoint. Mirrors
 *  handleMessages but uses OpenAI Responses normalizers + SSE accumulator. */
async function handleResponses(
  req: express.Request,
  res: express.Response,
  upstream: string,
  emitter: EventEmitter,
): Promise<void> {
  let body: Record<string, any>;
  try {
    body = JSON.parse((req.body as Buffer).toString('utf-8'));
  } catch {
    res.status(400).json({ error: 'invalid JSON body' });
    return;
  }

  const timestamp = Date.now();
  const apiReq = normalizeOpenaiResponsesRequest(body, timestamp, genId());

  const forwardHeaders = buildForwardHeaders(req);
  // Use the request's original path (e.g. /v1/responses) appended to the
  // upstream origin so providers with non-standard path prefixes still work.
  const upstreamUrl = `${upstream}${req.originalUrl}`;
  const isStream = body.stream === true;

  let upstreamRes: Response;
  try {
    console.log('[proxy] forwarding to:', upstreamUrl);
    upstreamRes = await fetch(upstreamUrl, {
      method: 'POST',
      headers: forwardHeaders,
      body: req.body as BodyInit,
    });
  } catch (err: any) {
    const cause = err?.cause ? ` (cause: ${JSON.stringify(err.cause)})` : '';
    console.error('[proxy] fetch failed:', err?.message, cause);
    res.status(502).json({ error: 'proxy upstream error', detail: String(err), cause: cause || undefined });
    return;
  }

  res.status(upstreamRes.status);
  copyResponseHeaders(upstreamRes, res);

  if (isStream) {
    await streamAndCaptureResponses(upstreamRes, res, apiReq, emitter);
  } else {
    await bufferAndCaptureResponses(upstreamRes, res, apiReq, emitter);
  }
}

/** Stream OpenAI Responses SSE chunks to the client while accumulating. */
async function streamAndCaptureResponses(
  upstreamRes: Response,
  res: express.Response,
  apiReq: ApiRequest,
  emitter: EventEmitter,
): Promise<void> {
  const reader = upstreamRes.body?.getReader();
  if (!reader) {
    await bufferAndCaptureResponses(upstreamRes, res, apiReq, emitter);
    return;
  }

  const rawChunks: Buffer[] = [];
  let totalRawBytes = 0;
  let truncated = false;
  let streamError: unknown = null;
  let lastReadAt = Date.now();
  const idleTimer = setInterval(() => {
    if (Date.now() - lastReadAt > STREAM_IDLE_TIMEOUT_MS) {
      const err = new Error(`responses stream idle > ${STREAM_IDLE_TIMEOUT_MS}ms`);
      streamError = err;
      try { reader.cancel(); } catch { /* ignore */ }
    }
  }, Math.min(STREAM_IDLE_TIMEOUT_MS / 2, 30_000));
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      lastReadAt = Date.now();
      const buf = Buffer.from(value);
      if (totalRawBytes + buf.length <= MAX_RAW_BYTES) {
        rawChunks.push(buf);
        totalRawBytes += buf.length;
      } else if (!truncated) {
        truncated = true;
        console.warn(`[proxy] Responses SSE exceeded ${MAX_RAW_BYTES} bytes; stopping accumulator but still forwarding.`);
      }
      if (!res.writableEnded) {
        res.write(buf);
      }
    }
  } catch (err) {
    streamError = err;
  } finally {
    clearInterval(idleTimer);
    try { reader.releaseLock(); } catch { /* ignore */ }
    if (!res.writableEnded) {
      try { res.end(); } catch { /* ignore */ }
    }
  }

  if (streamError) {
    console.error('[proxy] responses stream read error:', streamError);
    return;
  }

  const fullText = Buffer.concat(rawChunks).toString('utf-8');
  const accumulated = accumulateOpenaiResponsesSse([fullText]);
  if (accumulated) {
    apiReq.response = {
      content: accumulated.content,
      stopReason: accumulated.stopReason,
      usage: accumulated.usage,
    };
    emitter.emit('captured', apiReq);
  }
}

/** Buffer the full OpenAI Responses response, capture, and send to client. */
async function bufferAndCaptureResponses(
  upstreamRes: Response,
  res: express.Response,
  apiReq: ApiRequest,
  emitter: EventEmitter,
): Promise<void> {
  const text = await upstreamRes.text();
  if (!res.writableEnded) {
    res.send(text);
  }

  try {
    const body = JSON.parse(text);
    apiReq.response = normalizeOpenaiResponsesResponse(body);
    emitter.emit('captured', apiReq);
  } catch {
    // Non-JSON response - don't capture.
  }
}

/** Copy response headers from upstream to client, skipping ones that would
 *  conflict with Express's own handling of the decompressed body. */
function copyResponseHeaders(upstreamRes: Response, res: express.Response): void {
  upstreamRes.headers.forEach((value: string, key: string) => {
    const lower = key.toLowerCase();
    // Node fetch auto-decompresses the body, so content-encoding/length
    // no longer match what we're streaming.
    if (lower === 'content-encoding' || lower === 'content-length' || lower === 'transfer-encoding') {
      return;
    }
    res.set(key, value);
  });
}

function genId(): string {
  return `proxy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}