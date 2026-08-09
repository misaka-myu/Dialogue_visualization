// src/main/adapters/codex-log.ts
// Adapter for OpenAI Codex CLI / Codex Desktop session rollouts.
//
// Codex stores sessions as JSONL in ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
// (and ~/.codex/archived_sessions/) with an index at ~/.codex/session_index.jsonl.
// Each line is {timestamp, type, payload} where type is session_meta | event_msg |
// response_item | turn_context | world_state. We normalize response_items
// (message / function_call / function_call_output) into our Session shape.
//
// Discovery strategy mirrors cc-switch: walk the sessions/ directory tree
// first (so we catch files not in the index), then overlay thread titles from
// session_index.jsonl.

import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from 'fs';
import { dirname, join, basename } from 'path';
import { Session, ApiRequest, Message, MessageMeta, ContentBlock } from '../model/types';
import { extractReasoningText } from '../utils/reasoning';

const TITLE_MAX_CHARS = 80;

export interface CodexSessionMeta {
  sessionId: string;
  title?: string;
  projectDir?: string;
  createdAt?: number;
  lastActiveAt?: number;
  sourcePath: string;
  originator?: string;
  archived?: boolean;
}

interface CodexLine {
  timestamp: string;
  type: string;
  payload: Record<string, any>;
}

/** Scan ~/.codex/sessions/ + ~/.codex/archived_sessions/ for rollout files,
 *  then overlay thread titles from session_index.jsonl. Mirrors cc-switch's
 *  directory-walk-first approach. */
export function scanCodexSessions(codexHome: string): CodexSessionMeta[] {
  // Step 1: Walk both sessions/ and archived_sessions/ directories.
  const files: string[] = [];
  for (const sub of ['sessions', 'archived_sessions']) {
    const dir = join(codexHome, sub);
    if (existsSync(dir)) {
      files.push(...collectRolloutFiles(dir));
    }
  }

  // Step 2: Quick-parse each file for session metadata (head only).
  const sessions: CodexSessionMeta[] = [];
  const byId = new Map<string, CodexSessionMeta>();
  for (const path of files) {
    const meta = quickParseCodexMeta(path);
    if (!meta) continue;
    sessions.push(meta);
    byId.set(meta.sessionId, meta);
  }

  // Step 3: Overlay thread titles from session_index.jsonl.
  const indexPath = join(codexHome, 'session_index.jsonl');
  if (existsSync(indexPath)) {
    try {
      const text = readFileSync(indexPath, 'utf-8');
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let obj: { id: string; thread_name?: string; updated_at?: string };
        try { obj = JSON.parse(trimmed); } catch { continue; }
        if (!obj.id) continue;
        const existing = byId.get(obj.id);
        if (existing) {
          if (obj.thread_name) existing.title = obj.thread_name.slice(0, TITLE_MAX_CHARS);
          if (obj.updated_at) {
            const ts = Date.parse(obj.updated_at);
            if (Number.isFinite(ts)) existing.lastActiveAt = ts;
          }
        }
      }
    } catch { /* ignore */ }
  }

  sessions.sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0));
  return sessions;
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

/** Quick-parse the first few lines of a rollout to get session metadata.
 *  Skips subagent sessions (payload.source.subagent present). */
function quickParseCodexMeta(path: string): CodexSessionMeta | null {
  try {
    const text = readFileSync(path, 'utf-8');
    const lines = text.split('\n').filter((l) => l.trim()).slice(0, 10);
    const isArchived = path.includes('archived_sessions');
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
      let obj: CodexLine;
      try { obj = JSON.parse(line); } catch { continue; }
      if (obj.type === 'session_meta') {
        const p = obj.payload;
        // Skip subagent sessions (cc-switch does the same).
        if (p.source?.subagent) return null;
        return {
          sessionId: p.session_id ?? p.id ?? basename(path, '.jsonl'),
          title: deriveTitleFromHead(lines),
          projectDir: p.cwd,
          createdAt: p.timestamp ? Date.parse(p.timestamp) : undefined,
          lastActiveAt: p.timestamp ? Date.parse(p.timestamp) : undefined,
          sourcePath: path,
          originator: p.originator,
          archived: isArchived,
        };
      }
    }
  } catch { /* ignore */ }
  return null;
}

/** Try to extract a title from the first real user message in the head lines. */
function deriveTitleFromHead(lines: string[]): string | undefined {
  for (const line of lines) {
    let obj: CodexLine;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type !== 'response_item') continue;
    const p = obj.payload;
    if (p.type !== 'message' || p.role !== 'user') continue;
    if (!Array.isArray(p.content)) continue;
    for (const b of p.content) {
      if (b.type === 'input_text' && b.text?.trim()) {
        // Skip IDE context injections (cc-switch does the same).
        if (b.text.startsWith('# Context from my IDE setup:')) continue;
        if (b.text.startsWith('<environment_context>')) continue;
        if (b.text.startsWith('# AGENTS.md instructions for')) continue;
        return b.text.slice(0, TITLE_MAX_CHARS).replace(/\n/g, ' ');
      }
    }
  }
  return undefined;
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

  // Pending reasoning text, to be attached to the NEXT assistant message
  // (Codex emits reasoning BEFORE the assistant response_item).
  let pendingReasoning: string | null = null;

  // B-4: counter used to throttle JSON.parse-failure warnings.
  let badLineCount = 0;
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    let obj: CodexLine;
    // B-4: rate-limit warnings to avoid spamming the console on a corrupt
    // codex rollout. Cap per-line warnings at 5, then emit one summary.
    // Include the line number so the user can jump to the corrupt row.
    try { obj = JSON.parse(line); } catch (err) {
      badLineCount++;
      if (badLineCount <= 5) {
        console.warn('[codex-log] unparseable JSONL line at ' + (lineIdx + 1) + ' (file ' + path + '):', err);
      }
      continue;
    }
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
      continue;
    }

    // turn_context and world_state carry workspace/shell metadata but no
    // conversation content - skip them without failing.
    if (obj.type === 'turn_context' || obj.type === 'world_state') {
      continue;
    }

    if (obj.type === 'event_msg') {
      const p = obj.payload;
      if (p.type === 'token_count' && p.info) {
        const u = p.info.total_token_usage ?? p.info.last_token_usage;
        if (u && requests.length > 0) {
          const lastReq = requests[requests.length - 1];
          if (lastReq.response) {
            lastReq.response.usage = {
              inputTokens: Number(u.input_tokens) || 0,
              outputTokens: Number(u.output_tokens) || 0,
              cacheReadTokens: Number(u.cached_input_tokens) || 0,
              cacheCreationTokens: Number(u.cache_write_input_tokens) || 0,
              model: lastReq.response.usage.model,
              messageId: lastReq.response.usage.messageId,
            };
          }
        }
        if (u && conversation.length > 0) {
          for (let i = conversation.length - 1; i >= 0; i--) {
            if (conversation[i].role === 'assistant') {
              conversation[i].meta = {
                ...conversation[i].meta,
                outputTokens: Number(u.output_tokens) || undefined,
              };
              break;
            }
          }
        }
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

      // If this is an assistant message and we have pending reasoning,
      // prepend it as a thinking block BEFORE checking if blocks is empty.
      if (role === 'assistant' && pendingReasoning) {
        blocks.unshift({ type: 'thinking', thinking: pendingReasoning });
        pendingReasoning = null;
      }

      if (blocks.length === 0) continue;

      const meta: MessageMeta = {
        timestamp: itemTs,
        model,
        originator,
      };
      conversation.push({ role, content: blocks, meta });

      if (role === 'assistant') {
        const reqId = `${sessionId ?? 'codex'}-${requests.length}`;
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
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
              model,
              messageId: p.id,
            },
          },
        });
      }
      continue;
    }

    if (p.type === 'function_call') {
      let input: unknown;
      try { input = JSON.parse(p.arguments ?? '{}'); } catch { input = {}; }
      const callId = p.call_id ?? p.id;
      const lastMsg = conversation[conversation.length - 1];

      const toolBlock: ContentBlock = { type: 'tool_use', id: callId, name: p.name, input };

      if (lastMsg && lastMsg.role === 'assistant') {
        if (pendingReasoning) {
          lastMsg.content.unshift({ type: 'thinking', thinking: pendingReasoning });
          pendingReasoning = null;
        }
        lastMsg.content.push(toolBlock);
      } else {
        const content: ContentBlock[] = [];
        if (pendingReasoning) {
          content.push({ type: 'thinking', thinking: pendingReasoning });
          pendingReasoning = null;
        }
        content.push(toolBlock);
        conversation.push({
          role: 'assistant',
          content,
          meta: { timestamp: itemTs, model, originator },
        });
      }
      continue;
    }

    if (p.type === 'function_call_output') {
      const callId = p.call_id;
      const output = typeof p.output === 'string' ? p.output : JSON.stringify(p.output ?? '');
      const lastMsg = conversation[conversation.length - 1];
      if (lastMsg && lastMsg.role === 'user') {
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

    // Reasoning items arrive BEFORE the assistant message. Buffer the text
    // and attach it to the next assistant message (handled above).
    // Cap at 1MB to prevent pathological sessions from consuming memory.
    if (p.type === 'reasoning') {
      const reasoningText = extractReasoningText(p);
      if (reasoningText) {
        const MAX_REASONING = 1_000_000;
        if (pendingReasoning) {
          const combined: string = pendingReasoning + '\n' + reasoningText;
          pendingReasoning = combined.length > MAX_REASONING
            ? combined.slice(-MAX_REASONING)
            : combined;
        } else {
          pendingReasoning = reasoningText.slice(0, MAX_REASONING);
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

  // B-4: emit a one-line summary when corruption exceeds the per-line
  // threshold so the user knows the file is bad without flooding the console.
  if (badLineCount >= 5) {
    console.warn('[codex-log] ' + badLineCount + ' total unparseable lines in ' + path + ';');
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
          const t = b.text.trim();
          // Skip IDE context injections.
          if (t.startsWith('# Context from my IDE setup:')) continue;
          if (t.startsWith('<environment_context>')) continue;
          if (t.startsWith('# AGENTS.md instructions for')) continue;
          return t.slice(0, TITLE_MAX_CHARS).replace(/\n/g, ' ');
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