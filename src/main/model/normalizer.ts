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
