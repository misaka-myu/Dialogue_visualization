// src/main/proxy/sse.ts
import { ContentBlock, TokenUsage } from '../model/types';
import { emptyUsage } from '../model/types';

/**
 * Accumulate a list of raw SSE data payloads (each already parsed from
 * `data: <json>`) into a full response shape matching the non-streaming
 * Anthropic messages response.
 *
 * Supported events:
 *  - message_start        -> model, message id, input usage tokens
 *  - content_block_start  -> new block (text / tool_use / thinking)
 *  - content_block_delta  -> append text / thinking / tool_use input json fragment
 *  - content_block_stop   -> finalize current block
 *  - message_delta        -> stop_reason, output usage tokens
 *  - message_stop         -> end of stream
 *  - ping / error         -> ignored (error logged)
 *
 * For tool_use blocks, Anthropic streams the `input` as a JSON fragment via
 * `input_json_delta` deltas. We concatenate the raw string fragments and
 * JSON.parse them at finalization. If the full `input` is already present in
 * content_block_start (some providers do this), we use it directly.
 *
 * Returns null if no message_start was seen (not a valid Claude SSE stream).
 */
export function accumulateClaudeSse(
  chunks: string[],
): { content: ContentBlock[]; stopReason: string; usage: TokenUsage } | null {
  const events = parseSseEvents(chunks);
  if (events.length === 0) return null;

  const content: ContentBlock[] = [];
  const usage = emptyUsage();
  let stopReason = '';
  let sawMessageStart = false;

  // Track blocks currently being assembled by index.
  // Each entry holds the partial state until content_block_stop.
  const blockBuilders = new Map<
    number,
    {
      type: string;
      text: string;
      thinking: string;
      signature?: string;
      toolId: string;
      toolName: string;
      toolInputRaw: string;
      toolInput?: unknown;
    }
  >();

  for (const event of events) {
    const type = event.type as string | undefined;
    if (!type) continue;

    switch (type) {
      case 'message_start': {
        sawMessageStart = true;
        const message = event.message as Record<string, any> | undefined;
        if (message) {
          const msgUsage = message.usage as Record<string, any> | undefined;
          if (msgUsage) {
            usage.inputTokens = num(msgUsage.input_tokens) ?? usage.inputTokens;
            usage.cacheReadTokens =
              num(msgUsage.cache_read_input_tokens) ?? usage.cacheReadTokens;
            usage.cacheCreationTokens =
              num(msgUsage.cache_creation_input_tokens) ?? usage.cacheCreationTokens;
          }
          if (message.model) usage.model = message.model;
          if (message.id) usage.messageId = message.id;
        }
        break;
      }

      case 'content_block_start': {
        const idx = num(event.index);
        const block = event.content_block as Record<string, any> | undefined;
        if (idx === null || !block) break;
        const builder = {
          type: (block.type as string) ?? 'text',
          text: (block.text as string) ?? '',
          thinking: (block.thinking as string) ?? '',
          signature: block.signature as string | undefined,
          toolId: (block.id as string) ?? '',
          toolName: (block.name as string) ?? '',
          toolInputRaw: '',
          toolInput: block.input as unknown | undefined,
        };
        blockBuilders.set(idx, builder);
        break;
      }

      case 'content_block_delta': {
        const idx = num(event.index);
        const delta = event.delta as Record<string, any> | undefined;
        if (idx === null || !delta) break;
        const builder = blockBuilders.get(idx);
        if (!builder) break;

        const deltaType = delta.type as string | undefined;
        switch (deltaType) {
          case 'text_delta':
            builder.text += (delta.text as string) ?? '';
            break;
          case 'thinking_delta':
            builder.thinking += (delta.thinking as string) ?? '';
            break;
          case 'signature_delta':
            builder.signature =
              (builder.signature ?? '') + ((delta.signature as string) ?? '');
            break;
          case 'input_json_delta':
            builder.toolInputRaw += (delta.partial_json as string) ?? '';
            break;
          default:
            // Unknown delta type - ignore.
            break;
        }
        break;
      }

      case 'content_block_stop': {
        const idx = num(event.index);
        if (idx === null) break;
        const builder = blockBuilders.get(idx);
        if (!builder) break;

        let block: ContentBlock | null = null;
        switch (builder.type) {
          case 'text':
            block = { type: 'text', text: builder.text };
            break;
          case 'thinking':
            block = {
              type: 'thinking',
              thinking: builder.thinking,
              signature: builder.signature,
            };
            break;
          case 'tool_use': {
            let input: unknown = builder.toolInput;
            if (input === undefined && builder.toolInputRaw) {
              try {
                input = JSON.parse(builder.toolInputRaw);
              } catch {
                input = builder.toolInputRaw;
              }
            }
            block = {
              type: 'tool_use',
              id: builder.toolId,
              name: builder.toolName,
              input: input ?? {},
            };
            break;
          }
          default:
            // Unknown block type - skip.
            break;
        }
        if (block) content.push(block);
        blockBuilders.delete(idx);
        break;
      }

      case 'message_delta': {
        const delta = event.delta as Record<string, any> | undefined;
        if (delta && delta.stop_reason) {
          stopReason = delta.stop_reason as string;
        }
        const deltaUsage = event.usage as Record<string, any> | undefined;
        if (deltaUsage) {
          if (num(deltaUsage.output_tokens) !== null) {
            usage.outputTokens = num(deltaUsage.output_tokens)!;
          }
          // Some providers report corrected input/cache tokens in message_delta.
          const dInput = num(deltaUsage.input_tokens);
          if (dInput !== null) {
            // Prefer delta input when it's a smaller positive correction
            // (some Anthropic-compatible providers send fresh input here).
            if (usage.inputTokens === 0 || dInput < usage.inputTokens) {
              usage.inputTokens = dInput;
              if (num(deltaUsage.cache_read_input_tokens) !== null) {
                usage.cacheReadTokens = num(deltaUsage.cache_read_input_tokens)!;
              }
              if (num(deltaUsage.cache_creation_input_tokens) !== null) {
                usage.cacheCreationTokens = num(deltaUsage.cache_creation_input_tokens)!;
              }
            }
          }
        }
        break;
      }

      case 'message_stop':
      case 'ping':
      case 'error':
        // error events are not fatal to accumulation - just ignore here.
        break;

      default:
        break;
    }
  }

  if (!sawMessageStart) return null;

  return { content, stopReason, usage };
}

/** Parse raw SSE text chunks into a flat list of parsed JSON event objects. */
function parseSseEvents(chunks: string[]): Record<string, any>[] {
  const events: Record<string, any>[] = [];
  // Join all chunks then split on double-newline boundaries.
  const raw = chunks.join('');
  // SSE events are separated by \n\n. Each event may have event:/data: lines.
  const rawEvents = raw.split(/\r?\n\r?\n/);
  for (const rawEvent of rawEvents) {
    const dataLines: string[] = [];
    for (const line of rawEvent.split(/\r?\n/)) {
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
      // event: lines are informational - we rely on the `type` field in data.
    }
    if (dataLines.length === 0) continue;
    const dataStr = dataLines.join('\n');
    if (dataStr === '[DONE]') continue;
    try {
      const parsed = JSON.parse(dataStr);
      if (parsed && typeof parsed === 'object') {
        events.push(parsed);
      }
    } catch {
      // ignore non-JSON data lines
    }
  }
  return events;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && !isNaN(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (!isNaN(n)) return n;
  }
  return null;
}
