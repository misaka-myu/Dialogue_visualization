// src/main/proxy/server.ts
import express from 'express';
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
 * If `expectedKey` is provided, /v1/messages requires the
 * `x-dialogueviz-key` header to match. This is a *lightweight* local guard
 * against other processes on the same machine injecting requests into the
 * capture stream. It's NOT a real auth boundary — anyone with read access
 * to `~/.claude/.dialogueviz-secret` can mint the header. The threat model
 * is opportunistic same-host processes, not a determined attacker.
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

  // Shared-secret check for the capture endpoint. Only enforced when the
  // caller actually generated a key (i.e. we wrote one to settings.json).
  // passthrough routes (count_tokens, models) stay open — they don't write
  // anything to the capture.
  const captureAuth = expectedKey
    ? (req: express.Request, res: express.Response, next: express.NextFunction): void => {
        const got = req.headers['x-dialogueviz-key'];
        if (typeof got !== 'string' || got !== expectedKey) {
          res.status(403).json({ error: 'forbidden: missing or invalid x-dialogueviz-key' });
          return;
        }
        next();
      }
    : (_req: express.Request, _res: express.Response, next: express.NextFunction): void => next();

  app.post('/v1/messages', captureAuth, (req: express.Request, res: express.Response) => {
    void handleMessages(req, res, upstream, emitter);
  });

  app.post('/v1/responses', captureAuth, (req: express.Request, res: express.Response) => {
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
    const server = app.listen(port);
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
function buildForwardHeaders(req: express.Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (isProxyInternalHeader(key)) continue;
    if (typeof value === 'string') {
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
  let streamError: unknown = null;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const buf = Buffer.from(value);
      rawChunks.push(buf);
      // Write immediately so the client sees live streaming.
      if (!res.writableEnded) {
        res.write(buf);
      }
    }
  } catch (err) {
    streamError = err;
  } finally {
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
  let streamError: unknown = null;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const buf = Buffer.from(value);
      rawChunks.push(buf);
      if (!res.writableEnded) {
        res.write(buf);
      }
    }
  } catch (err) {
    streamError = err;
  } finally {
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
