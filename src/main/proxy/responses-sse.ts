// src/main/proxy/responses-sse.ts
// Accumulate OpenAI Responses API SSE events into a normalized response
// shape. The Responses API (POST /v1/responses) streams events prefixed
// with `response.`:
//   response.created            - response metadata (model, id)
//   response.output_item.added  - new output item (message / function_call)
//   response.content_part.added - new content part within a message
//   response.output_text.delta  - text delta
//   response.output_text.done   - text complete
//   response.function_call_arguments.delta - tool call args delta
//   response.function_call_arguments.done   - tool call args complete
//   response.completed          - final, carries response.usage
//   response.failed / response.error - error
//
// We accumulate text/function_call fragments and build ContentBlock[] +
// TokenUsage, mirroring how accumulateClaudeSse works for Anthropic.

import { ContentBlock, TokenUsage } from '../model/types';
import { emptyUsage } from '../model/types';

export function accumulateOpenaiResponsesSse(
  chunks: string[],
): { content: ContentBlock[]; stopReason: string; usage: TokenUsage } | null {
  const events = parseSseEvents(chunks);
  if (events.length === 0) return null;

  const content: ContentBlock[] = [];
  const usage = emptyUsage();
  let stopReason = '';
  let sawResponse = false;

  // Track text being accumulated for the current message output
  let currentText = '';
  let hasText = false;
  let currentReasoning = '';
  let hasReasoning = false;

  // Track function call arguments by call_id (stable across events even
  // if output_index is missing or duplicated).
  const functionCallArgs = new Map<string, { id: string; name: string; args: string }>();

  for (const evt of events) {
    const type: string = evt.type ?? '';

    if (type === 'response.created' || type === 'response.in_progress') {
      sawResponse = true;
      // Keep the first non-null value - don't let a later event with an
      // empty id/model overwrite a good one.
      if (evt.response?.model && !usage.model) usage.model = evt.response.model;
      if (evt.response?.id && !usage.messageId) usage.messageId = evt.response.id;
      continue;
    }

    if (type === 'response.output_item.added') {
      const item = evt.item;
      if (!item) continue;
      if (item.type === 'message') {
        // Start accumulating text for this message
        currentText = '';
        hasText = false;
      } else if (item.type === 'reasoning') {
        currentReasoning = '';
        hasReasoning = false;
      } else if (item.type === 'function_call') {
        const key = item.call_id ?? item.id ?? '';
        if (!key) {
          console.warn('[sse] function_call without call_id/item.id, skipping');
          continue;
        }
        functionCallArgs.set(key, {
          id: key,
          name: item.name ?? '',
          args: '',
        });
      }
      continue;
    }

    if (
      type === 'response.reasoning.delta' ||
      type === 'response.reasoning_text.delta' ||
      type === 'response.summary_text.delta'
    ) {
      currentReasoning += evt.delta ?? '';
      hasReasoning = true;
      continue;
    }

    if (
      type === 'response.reasoning.done' ||
      type === 'response.reasoning_text.done' ||
      type === 'response.summary_text.done'
    ) {
      if (hasReasoning) {
        content.push({ type: 'thinking', thinking: currentReasoning });
        currentReasoning = '';
        hasReasoning = false;
      }
      continue;
    }

    if (type === 'response.output_text.delta') {
      currentText += evt.delta ?? '';
      hasText = true;
      continue;
    }

    if (type === 'response.output_text.done') {
      // Finalize the text block
      if (hasText) {
        content.push({ type: 'text', text: currentText });
        currentText = '';
        hasText = false;
      }
      continue;
    }

    if (type === 'response.function_call_arguments.delta') {
      // Match by item reference if available, else by output_index -> call_id lookup
      const itemId = evt.item?.call_id ?? evt.item?.id;
      const fc = itemId ? functionCallArgs.get(itemId) : null;
      if (fc) fc.args += evt.delta ?? '';
      continue;
    }

    if (type === 'response.function_call_arguments.done') {
      const itemId = evt.item?.call_id ?? evt.item?.id;
      const fc = itemId ? functionCallArgs.get(itemId) : null;
      if (fc) {
        let input: unknown;
        try { input = JSON.parse(fc.args || '{}'); } catch { input = {}; }
        content.push({ type: 'tool_use', id: fc.id, name: fc.name, input });
        functionCallArgs.delete(itemId!);
      }
      continue;
    }

    if (type === 'response.completed') {
      sawResponse = true;
      const resp = evt.response;
      if (resp) {
        stopReason = resp.status ?? '';
        const u = resp.usage;
        if (u) {
          usage.inputTokens = num(u.input_tokens) ?? usage.inputTokens;
          usage.outputTokens = num(u.output_tokens) ?? usage.outputTokens;
          usage.cacheReadTokens = num(u.input_tokens_details?.cached_tokens) ?? usage.cacheReadTokens;
        }
      }
      continue;
    }

    if (type === 'response.failed' || type === 'response.error') {
      sawResponse = true;
      stopReason = 'error';
      continue;
    }
  }

  // If we have accumulated reasoning or text that wasn't finalized with .done, push them
  if (hasReasoning && currentReasoning) {
    content.push({ type: 'thinking', thinking: currentReasoning });
  }

  if (hasText && currentText) {
    content.push({ type: 'text', text: currentText });
  }

  if (!sawResponse) return null;
  return { content, stopReason, usage };
}

/** Parse raw SSE text chunks into a flat list of parsed JSON event objects.
 *  Shared with the Anthropic accumulator. */
function parseSseEvents(chunks: string[]): Record<string, any>[] {
  const events: Record<string, any>[] = [];
  const raw = chunks.join('');
  const rawEvents = raw.split(/\r?\n\r?\n/);
  for (const rawEvent of rawEvents) {
    const dataLines: string[] = [];
    for (const line of rawEvent.split(/\r?\n/)) {
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length === 0) continue;
    const dataStr = dataLines.join('\n');
    if (dataStr === '[DONE]') continue;
    try {
      const parsed = JSON.parse(dataStr);
      if (parsed && typeof parsed === 'object') {
        events.push(parsed);
      }
    } catch { /* ignore non-JSON data lines */ }
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
