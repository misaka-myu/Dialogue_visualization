// src/main/adapters/claude-log.ts
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { Session, ApiRequest, Message, emptyUsage } from '../model/types';
import { normalizeContent } from '../model/normalizer';

const TITLE_MAX_CHARS = 80;
const HEAD_LINES = 10;
const TAIL_LINES = 30;

export interface SessionMeta {
  sessionId: string;
  title?: string;
  projectDir?: string;
  createdAt?: number;
  lastActiveAt?: number;
  sourcePath: string;
}

export function scanClaudeSessions(rootDir: string): SessionMeta[] {
  if (!existsDir(rootDir)) return [];
  const files: string[] = [];
  collectJsonlFiles(rootDir, files);
  const sessions: SessionMeta[] = [];
  for (const path of files) {
    if (isAgentSession(path)) continue;
    const meta = parseSessionMeta(path);
    if (meta) sessions.push(meta);
  }
  return sessions;
}

function existsDir(p: string): boolean {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function collectJsonlFiles(dir: string, out: string[]): void {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      collectJsonlFiles(full, out);
    } else if (name.endsWith('.jsonl')) {
      out.push(full);
    }
  }
}

function isAgentSession(path: string): boolean {
  return basename(path).startsWith('agent-');
}

function readHeadTailLines(path: string, head: number, tail: number): { head: string[]; tail: string[] } {
  const text = readFileSync(path, 'utf-8');
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  return {
    head: lines.slice(0, head),
    tail: lines.slice(-tail),
  };
}

function parseTimestampToMs(ts: unknown): number | undefined {
  if (typeof ts !== 'string') return undefined;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? undefined : ms;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + '...';
}

export function parseSessionMeta(path: string): SessionMeta | null {
  let head: string[], tail: string[];
  try { ({ head, tail } = readHeadTailLines(path, HEAD_LINES, TAIL_LINES)); }
  catch { return null; }

  let sessionId: string | undefined;
  let projectDir: string | undefined;
  let createdAt: number | undefined;
  let firstUserMessage: string | undefined;

  for (const line of head) {
    let obj: any;
    try { obj = JSON.parse(line); } catch { continue; }
    if (sessionId === undefined && typeof obj.sessionId === 'string') sessionId = obj.sessionId;
    if (projectDir === undefined && typeof obj.cwd === 'string') projectDir = obj.cwd;
    if (createdAt === undefined) createdAt = parseTimestampToMs(obj.timestamp);
    if (firstUserMessage === undefined) {
      const isUser = obj.type === 'user' || obj.message?.role === 'user';
      if (isUser) {
        const text = extractText(obj.message?.content);
        const trimmed = text.trim();
        if (trimmed && !trimmed.includes('<local-command-caveat>') && !trimmed.startsWith('<command-name>')) {
          firstUserMessage = trimmed;
        }
      }
    }
    if (sessionId && projectDir && createdAt && firstUserMessage) break;
  }

  let lastActiveAt: number | undefined;
  for (const line of [...tail].reverse()) {
    let obj: any;
    try { obj = JSON.parse(line); } catch { continue; }
    if (lastActiveAt === undefined) lastActiveAt = parseTimestampToMs(obj.timestamp);
    if (lastActiveAt !== undefined) break;
  }

  if (!sessionId) sessionId = basename(path).replace(/\.jsonl$/, '');
  if (!sessionId) return null;

  const title = firstUserMessage
    ? truncate(firstUserMessage, TITLE_MAX_CHARS)
    : projectDir ? basename(projectDir) : undefined;

  return { sessionId, title, projectDir, createdAt, lastActiveAt, sourcePath: path };
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b: any) => b?.type === 'text' ? b.text : '')
      .join('');
  }
  return '';
}

interface JsonlLine {
  type?: string;
  message?: { role?: string; content?: unknown; usage?: Record<string, unknown>; model?: string; id?: string };
  sessionId?: string;
  cwd?: string;
  timestamp?: string;
  isMeta?: boolean;
  customTitle?: string;
}

interface ConvoMessage {
  role: 'user' | 'assistant' | 'tool';
  content: import('../model/types').ContentBlock[];
  ts?: number;
  usage?: Record<string, unknown>;
  model?: string;
  messageId?: string;
}

export function loadClaudeSession(path: string): Session {
  const text = readFileSync(path, 'utf-8');
  const lines = text.split('\n').filter((l) => l.trim().length > 0);

  const convo: ConvoMessage[] = [];
  let sessionId: string | undefined;
  let cwd: string | undefined;
  let firstTs: number | undefined;
  let lastTs: number | undefined;

  for (const line of lines) {
    let obj: JsonlLine;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.isMeta) continue;
    if (obj.sessionId) sessionId = obj.sessionId;
    if (obj.cwd) cwd = obj.cwd;
    const ts = parseTimestampToMs(obj.timestamp);
    if (ts !== undefined) {
      if (firstTs === undefined) firstTs = ts;
      lastTs = ts;
    }
    const msg = obj.message;
    if (!msg || !msg.role) continue;
    const content = normalizeContent(msg.content);
    if (content.length === 0) continue;
    let role = msg.role as ConvoMessage['role'];
    if (role === 'user' && content.every((b) => b.type === 'tool_result')) {
      role = 'tool';
    }
    convo.push({ role, content, ts, usage: msg.usage, model: msg.model, messageId: msg.id });
  }

  const conversation: Message[] = [];
  const requests: ApiRequest[] = [];
  for (const m of convo) {
    if (m.role === 'assistant') {
      const reqId = `${sessionId ?? 'sess'}-${requests.length}`;
      const u = m.usage ?? {};
      requests.push({
        id: reqId,
        timestamp: m.ts ?? lastTs ?? Date.now(),
        model: m.model ?? '',
        system: [],
        messageCount: conversation.length,
        params: { maxTokens: 0 },
        response: {
          content: m.content,
          stopReason: '',
          usage: {
            inputTokens: Number(u.input_tokens) || 0,
            outputTokens: Number(u.output_tokens) || 0,
            cacheReadTokens: Number(u.cache_read_input_tokens) || 0,
            cacheCreationTokens: Number(u.cache_creation_input_tokens) || 0,
            model: m.model,
            messageId: m.messageId,
          },
        },
      });
      conversation.push({ role: 'assistant', content: m.content });
    } else {
      conversation.push({ role: m.role, content: m.content });
    }
  }

  const meta = parseSessionMeta(path);
  return {
    id: sessionId ?? basename(path),
    source: 'claude-code-log',
    client: 'claude-code',
    startedAt: firstTs ?? Date.now(),
    endedAt: lastTs,
    title: meta?.title,
    projectDir: cwd ?? meta?.projectDir,
    requests,
    conversation,
  };
}
