// src/main/model/normalizer.ts
import { ApiRequest, ApiResponse, ContentBlock, Message, ToolDef } from './types';

type RawBlock = Record<string, any>;

export function normalizeContent(content: unknown): ContentBlock[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  if (Array.isArray(content)) {
    return content.map(normalizeBlock).filter((b): b is ContentBlock => b !== null);
  }
  return [];
}

function normalizeBlock(block: RawBlock | null | undefined): ContentBlock | null {
  if (!block || typeof block !== 'object') return null;
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text ?? '' };
    case 'tool_use':
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
    case 'tool_result':
      return {
        type: 'tool_result',
        toolUseId: block.tool_use_id,
        content: typeof block.content === 'string' ? block.content : normalizeContent(block.content),
        isError: block.is_error,
      };
    case 'image':
      return { type: 'image', source: block.source };
    case 'thinking':
      return { type: 'thinking', thinking: block.thinking ?? '', signature: block.signature };
    default:
      return null;
  }
}

function normalizeSystem(system: unknown): ContentBlock[] {
  if (typeof system === 'string') return [{ type: 'text', text: system }];
  return normalizeContent(system);
}

export function normalizeMessages(messages: unknown): Message[] {
  if (!Array.isArray(messages)) return [];
  return messages.map((m: RawBlock) => ({
    role: m.role,
    content: normalizeContent(m.content),
  }));
}

function normalizeParams(body: RawBlock): { maxTokens: number; temperature?: number; topP?: number } {
  return {
    maxTokens: body.max_tokens ?? 0,
    temperature: body.temperature,
    topP: body.top_p,
  };
}

function normalizeTools(tools: unknown): ToolDef[] | undefined {
  if (!Array.isArray(tools)) return undefined;
  return tools.map((t: RawBlock) => ({
    name: t.name,
    description: t.description ?? '',
    inputSchema: t.input_schema ?? {},
  }));
}

export function normalizeAnthropicRequest(body: RawBlock, timestamp: number, id: string): ApiRequest {
  return {
    id,
    apiRequestId: body.id,
    timestamp,
    model: body.model ?? '',
    system: normalizeSystem(body.system),
    messageCount: normalizeMessages(body.messages).length,
    tools: normalizeTools(body.tools),
    params: normalizeParams(body),
    metadata: body.metadata,
  };
}

export function normalizeAnthropicResponse(body: RawBlock): ApiResponse {
  const usage = body.usage ?? {};
  return {
    content: normalizeContent(body.content),
    stopReason: body.stop_reason ?? '',
    usage: {
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
      model: body.model,
      messageId: body.id,
    },
  };
}

// --- OpenAI Responses API normalizers ---

/** Normalize the `input` array of an OpenAI Responses request body into
 *  our Message[] shape. The Responses API uses `input` (not `messages`)
 *  where each item has a `role` and `content` array with type
 *  `input_text` / `output_text` / etc. */
function normalizeOpenaiInput(input: unknown): Message[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item: RawBlock): Message | null => {
      if (!item || typeof item !== 'object') return null;
      const role = item.role === 'assistant' ? 'assistant'
        : item.role === 'user' ? 'user'
        : item.role === 'developer' || item.role === 'system' ? 'system'
        : null;
      if (!role) return null;
      const blocks = (item.content as RawBlock[])
        ? normalizeCodexContentBlocks(item.content)
        : [];
      return { role, content: blocks };
    })
    .filter((m): m is Message => m !== null);
}

function normalizeCodexContentBlocks(content: unknown): ContentBlock[] {
  if (!Array.isArray(content)) return [];
  return content
    .map((b: RawBlock): ContentBlock | null => {
      if (!b || typeof b !== 'object') return null;
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
    })
    .filter((b): b is ContentBlock => b !== null);
}

/** Normalize an OpenAI Responses API request body (POST /v1/responses)
 *  into our ApiRequest shape. */
export function normalizeOpenaiResponsesRequest(body: RawBlock, timestamp: number, id: string): ApiRequest {
  const inputMessages = normalizeOpenaiInput(body.input);
  return {
    id,
    apiRequestId: body.id ?? body.previous_response_id,
    timestamp,
    model: body.model ?? '',
    system: body.instructions ? [{ type: 'text', text: body.instructions }] : [],
    messageCount: inputMessages.length,
    params: {
      maxTokens: body.max_output_tokens ?? 0,
      temperature: body.temperature,
      topP: body.top_p,
    },
    metadata: body.metadata,
    inputMessages,
  };
}

/** Normalize a non-streaming OpenAI Responses API response body into our
 *  ApiResponse shape. For streaming, use accumulateOpenaiResponsesSse. */
export function normalizeOpenaiResponsesResponse(body: RawBlock): ApiResponse {
  const usage = body.usage ?? {};
  const content: ContentBlock[] = [];
  const output = Array.isArray(body.output) ? body.output : [];
  for (const item of output) {
    if (item.type === 'message') {
      content.push(...normalizeCodexContentBlocks(item.content));
    } else if (item.type === 'reasoning') {
      const text = typeof item.summary === 'string' && item.summary.trim()
        ? item.summary
        : Array.isArray(item.summary)
        ? item.summary.map((s: any) => (typeof s === 'string' ? s : s?.text ?? '')).filter((t: string) => t.trim()).join('\n')
        : Array.isArray(item.content)
        ? item.content.map((c: any) => (typeof c === 'string' ? c : c?.text ?? '')).filter((t: string) => t.trim()).join('\n')
        : typeof item.content === 'string' ? item.content : '';
      if (text.trim()) {
        content.push({ type: 'thinking', thinking: text });
      }
    } else if (item.type === 'function_call') {
      let input: unknown;
      try { input = JSON.parse(item.arguments ?? '{}'); } catch { input = {}; }
      content.push({ type: 'tool_use', id: item.call_id ?? item.id ?? '', name: item.name ?? '', input });
    }
  }
  return {
    content,
    stopReason: body.status ?? '',
    usage: {
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheReadTokens: usage.input_tokens_details?.cached_tokens ?? 0,
      cacheCreationTokens: 0,
      model: body.model,
      messageId: body.id,
    },
  };
}
