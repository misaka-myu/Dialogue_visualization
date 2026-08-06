// src/main/adapters/codex-log.ts
// Adapter for OpenAI Codex CLI / Codex Desktop session rollouts.
//
// Codex stores sessions as JSONL in ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
// with an index at ~/.codex/session_index.jsonl. Each line is
// {timestamp, type, payload} where type is session_meta | event_msg |
// response_item | turn_context | world_state. We normalize response_items
// (message / function_call / function_call_output) into our Session shape.

import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from 'fs';
import { dirname, join, basename } from 'path';
import { Session, ApiRequest, Message, MessageMeta, ContentBlock } from '../model/types';

const TITLE_MAX_CHARS = 80;

export interface CodexSessionMeta {
  sessionId: string;
  title?: string;
  projectDir?: string;
  createdAt?: number;
  lastActiveAt?: number;
  sourcePath: string;
  originator?: string;
}

interface CodexLine {
  timestamp: string;
  type: string;
  payload: Record<string, any>;
}

/** Scan ~/.codex/session_index.jsonl for session metadata. Falls back to
 *  a recursive directory walk if the index is missing. */
export function scanCodexSessions(codexHome: string): CodexSessionMeta[] {
  const indexPath = join(codexHome, 'session_index.jsonl');
  const sessions: CodexSessionMeta[] = [];

  if (existsSync(indexPath)) {
    try {
      const text = readFileSync(indexPath, 'utf-8');
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let obj: { id: string; thread_name?: string; updated_at?: string };
        try { obj = JSON.parse(trimmed); } catch { continue; }
        if (!obj.id) continue;
        const path = findRolloutPath(codexHome, obj.id);
        if (!path) continue;
        const updated = obj.updated_at ? Date.parse(obj.updated_at) : undefined;
        sessions.push({
          sessionId: obj.id,
          title: obj.thread_name?.slice(0, TITLE_MAX_CHARS),
          lastActiveAt: Number.isFinite(updated) ? updated : undefined,
          sourcePath: path,
        });
      }
    } catch { /* fall through to dir walk */ }
  }

  // Fallback: walk sessions/ directory for rollout files not in the index.
  if (sessions.length === 0) {
    const sessionsDir = join(codexHome, 'sessions');
    if (existsSync(sessionsDir)) {
      const files = collectRolloutFiles(sessionsDir);
      for (const path of files) {
        const meta = quickParseCodexMeta(path);
        if (meta) sessions.push(meta);
      }
    }
  }

  sessions.sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0));
  return sessions;
}

/** Find the rollout file for a session id by walking sessions/YYYY/MM/DD/. */
function findRolloutPath(codexHome: string, sessionId: string): string | null {
  const sessionsDir = join(codexHome, 'sessions');
  if (!existsSync(sessionsDir)) return null;
  // The filename pattern is rollout-<ISO>-<sessionId>.jsonl
  const files = collectRolloutFiles(sessionsDir);
  return files.find((f) => f.includes(sessionId)) ?? null;
}

function collectRolloutFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return results; }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      results.push(...collectRolloutFiles(full));
    } else if (name.startsWith('rollout-') && name.endsWith('.jsonl')) {
      results.push(full);
    }
  }
  return results;
}

/** Quick-parse the first few lines of a rollout to get session metadata. */
function quickParseCodexMeta(path: string): CodexSessionMeta | null {
  try {
    const text = readFileSync(path, 'utf-8');
    const lines = text.split('\n').filter((l) => l.trim()).slice(0, 5);
    for (const line of lines) {
      let obj: CodexLine;
      try { obj = JSON.parse(line); } catch { continue; }
      if (obj.type === 'session_meta') {
        const p = obj.payload;
        return {
          sessionId: p.session_id ?? p.id ?? basename(path, '.jsonl'),
          title: p.base_instructions?.text?.slice(0, TITLE_MAX_CHARS),
          projectDir: p.cwd,
          createdAt: p.timestamp ? Date.parse(p.timestamp) : undefined,
          lastActiveAt: p.timestamp ? Date.parse(p.timestamp) : undefined,
          sourcePath: path,
          originator: p.originator,
        };
      }
    }
  } catch { /* ignore */ }
  return null;
}

/** Full-parse a Codex rollout JSONL into a Session. */
export function loadCodexSession(path: string): Session {
  const text = readFileSync(path, 'utf-8');
  const lines = text.split('\n').filter((l) => l.trim().length > 0);

  const rawLines: unknown[] = [];
  const conversation: Message[] = [];
  const requests: ApiRequest[] = [];
  let systemBlocks: ContentBlock[] = [];
  let sessionId: string | undefined;
  let cwd: string | undefined;
  let firstTs: number | undefined;
  let lastTs: number | undefined;
  let originator: string | undefined;
  let model: string | undefined;
  let lastTokenUsage: Record<string, any> | undefined;

  // Track function_call id -> {name, input} for matching function_call_output
  const pendingToolCalls = new Map<string, { id: string; name: string; input: unknown }>();

  for (const line of lines) {
    let obj: CodexLine;
    try { obj = JSON.parse(line); } catch { continue; }
    rawLines.push(obj);

    const ts = obj.timestamp ? Date.parse(obj.timestamp) : undefined;
    if (ts !== undefined && Number.isFinite(ts)) {
      if (firstTs === undefined) firstTs = ts;
      lastTs = ts;
    }

    if (obj.type === 'session_meta') {
      const p = obj.payload;
      sessionId = p.session_id ?? p.id;
      cwd = p.cwd;
      originator = p.originator;
      if (p.base_instructions?.text) {
        systemBlocks = [{ type: 'text', text: p.base_instructions.text }];
      }
      if (p.git) {
        // We'll attach git to messages via meta
      }
      continue;
    }

    if (obj.type === 'event_msg') {
      const p = obj.payload;
      if (p.type === 'token_count' && p.info) {
        lastTokenUsage = p.info.total_token_usage ?? p.info.last_token_usage;
      }
      continue;
    }

    if (obj.type !== 'response_item') continue;

    const p = obj.payload;
    const itemTs = ts;

    if (p.type === 'message') {
      const role = mapCodexRole(p.role);
      if (!role) continue;
      const blocks = normalizeCodexContent(p.content);
      if (blocks.length === 0) continue;
      const meta: MessageMeta = {
        timestamp: itemTs,
        model,
        originator,
      };
      // Attach git branch if available from session_meta
      conversation.push({ role, content: blocks, meta });

      if (role === 'assistant') {
        // Create an ApiRequest for this assistant turn
        const reqId = `${sessionId ?? 'codex'}-${requests.length}`;
        const u = lastTokenUsage ?? {};
        requests.push({
          id: reqId,
          timestamp: itemTs ?? lastTs ?? Date.now(),
          model: model ?? '',
          system: requests.length === 0 ? systemBlocks : [],
          messageCount: conversation.length - 1,
          params: { maxTokens: 0 },
          response: {
            content: blocks,
            stopReason: '',
            usage: {
              inputTokens: Number(u.input_tokens) || 0,
              outputTokens: Number(u.output_tokens) || 0,
              cacheReadTokens: Number(u.cached_input_tokens) || 0,
              cacheCreationTokens: Number(u.cache_write_input_tokens) || 0,
              model,
              messageId: p.id,
            },
          },
        });
        lastTokenUsage = undefined; // reset for next turn
      }
      continue;
    }

    if (p.type === 'function_call') {
      // Tool call - attach as tool_use block to the last assistant message,
      // or create a synthetic assistant message if none exists.
      let input: unknown;
      try { input = JSON.parse(p.arguments ?? '{}'); } catch { input = {}; }
      const callId = p.call_id ?? p.id;
      pendingToolCalls.set(callId, { id: callId, name: p.name, input });
      // Append tool_use to last assistant message, or push as a tool role
      const lastMsg = conversation[conversation.length - 1];
      if (lastMsg && lastMsg.role === 'assistant') {
        lastMsg.content.push({ type: 'tool_use', id: callId, name: p.name, input });
      } else {
        // Standalone tool_use (no preceding assistant text) - push as assistant
        conversation.push({
          role: 'assistant',
          content: [{ type: 'tool_use', id: callId, name: p.name, input }],
          meta: { timestamp: itemTs, model, originator },
        });
      }
      continue;
    }

    if (p.type === 'function_call_output') {
      // Tool result
      const callId = p.call_id;
      const output = typeof p.output === 'string' ? p.output : JSON.stringify(p.output ?? '');
      const lastMsg = conversation[conversation.length - 1];
      if (lastMsg && lastMsg.role === 'user') {
        // Codex sometimes batches tool results as user messages; append
        lastMsg.content.push({ type: 'tool_result', toolUseId: callId, content: output });
      } else {
        conversation.push({
          role: 'tool',
          content: [{ type: 'tool_result', toolUseId: callId, content: output }],
          meta: { timestamp: itemTs },
        });
      }
      continue;
    }

    if (p.type === 'reasoning') {
      // Reasoning item - attach as thinking block to last assistant or skip
      const text = p.summary ?? p.content ?? '';
      if (text) {
        const lastMsg = conversation[conversation.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') {
          lastMsg.content.unshift({ type: 'thinking', thinking: typeof text === 'string' ? text : JSON.stringify(text) });
        }
      }
      continue;
    }
  }

  // If no requests were built (edge case), create a dummy request to hold system
  if (requests.length === 0 && systemBlocks.length > 0) {
    requests.push({
      id: `${sessionId ?? 'codex'}-0`,
      timestamp: firstTs ?? Date.now(),
      model: '',
      system: systemBlocks,
      messageCount: 0,
      params: { maxTokens: 0 },
    });
  }

  return {
    id: sessionId ?? basename(path, '.jsonl'),
    source: 'codex-log',
    client: 'codex',
    startedAt: firstTs ?? Date.now(),
    endedAt: lastTs,
    title: deriveTitle(conversation),
    projectDir: cwd,
    requests,
    conversation,
    rawLines,
  };
}

function mapCodexRole(role: string): Message['role'] | null {
  switch (role) {
    case 'user': return 'user';
    case 'assistant': return 'assistant';
    case 'developer': return 'system';
    case 'system': return 'system';
    default: return null;
  }
}

function normalizeCodexContent(content: unknown): ContentBlock[] {
  if (!Array.isArray(content)) return [];
  return content.map((b: Record<string, any>): ContentBlock | null => {
    switch (b.type) {
      case 'input_text':
      case 'output_text':
        return { type: 'text', text: b.text ?? '' };
      case 'reasoning':
      case 'reasoning_text':
        return { type: 'thinking', thinking: b.text ?? b.summary ?? '' };
      default:
        return null;
    }
  }).filter((b): b is ContentBlock => b !== null);
}

function deriveTitle(conversation: Message[]): string | undefined {
  for (const m of conversation) {
    if (m.role === 'user') {
      for (const b of m.content) {
        if (b.type === 'text' && b.text.trim()) {
          return b.text.slice(0, TITLE_MAX_CHARS).replace(/\n/g, ' ');
        }
      }
    }
  }
  return undefined;
}

/** Delete a Codex session rollout file. Returns true on success. */
export function deleteCodexSession(sourcePath: string): boolean {
  try {
    if (!existsSync(sourcePath)) return false;
    rmSync(sourcePath);
    return true;
  } catch {
    return false;
  }
}

/** Copy a Codex session to an export path. Returns the path or null. */
export function exportCodexSession(sourcePath: string, exportPath: string): string | null {
  try {
    if (!existsSync(sourcePath)) return null;
    copyFileSync(sourcePath, exportPath);
    return exportPath;
  } catch {
    return null;
  }
}
