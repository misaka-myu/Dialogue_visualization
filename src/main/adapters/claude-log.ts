// src/main/adapters/claude-log.ts
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { Session, emptyUsage } from '../model/types';
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
