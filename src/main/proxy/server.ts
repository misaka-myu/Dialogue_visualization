// src/main/proxy/server.ts
import express from 'express';
import { Server as HttpServer } from 'http';
import { EventEmitter } from 'events';
import { ApiRequest } from '../model/types';
import { normalizeAnthropicRequest, normalizeAnthropicResponse } from '../model/normalizer';
import { detectUpstream } from './upstream';
import { accumulateClaudeSse } from './sse';

export interface ProxyServer {
  port: number;
  upstream: string;
  stop: () => Promise<void>;
  onCaptured: (cb: (req: ApiRequest) => void) => void;
}

/**
 * Start the proxy server. If `preferredPort` is already in use, tries
 * port+1, port+2, ... up to 20 attempts.
 */
export async function startProxyServer(preferredPort: number): Promise<ProxyServer> {
  const upstream = detectUpstream();
  const emitter = new EventEmitter();
  const app = express();

  // Parse all bodies as raw buffers so we can forward them byte-for-byte.
  app.use('/v1', express.raw({ type: '*/*', limit: '100mb' }));

  app.post('/v1/messages', (req: express.Request, res: express.Response) => {
    void handleMessages(req, res, upstream, emitter);
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

  // Build forwarded headers - copy everything except host (let fetch set it).
  const forwardHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (key.toLowerCase() === 'host') continue;
    if (typeof value === 'string') {
      forwardHeaders[key] = value;
    }
  }

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
  } catch {
    // Stream error - end the response if not already ended.
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
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
  const forwardHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (key.toLowerCase() === 'host') continue;
    if (typeof value === 'string') {
      forwardHeaders[key] = value;
    }
  }

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
