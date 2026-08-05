// src/renderer/utils/tokens.ts
import type { Message } from '../../main/model/types';

/** Returns token info for a message: real count if the API reported one
 *  (assistant only), else an estimate from text length (chars / 4). The
 *  `real` flag controls the ✓/≈ glyph shown in the UI. */
export function getMessageTokenInfo(m: Message): { count: number; real: boolean } {
  if (m.role === 'assistant' && m.meta?.outputTokens != null) {
    return { count: m.meta.outputTokens, real: true };
  }
  const text = m.content
    .map((b) => {
      if (b.type === 'text') return b.text;
      if (b.type === 'thinking') return b.thinking;
      if (b.type === 'tool_use') return b.name + ' ' + JSON.stringify(b.input);
      if (b.type === 'tool_result') {
        return typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
      }
      return '';
    })
    .join('');
  return { count: Math.ceil(text.length / 4), real: false };
}

export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}