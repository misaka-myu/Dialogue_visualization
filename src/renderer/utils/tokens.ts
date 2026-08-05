// src/renderer/utils/tokens.ts
import type { Message } from '../../main/model/types';
import { extractMessageText } from './messageContent';

/** Returns token info for a message: real count if the API reported one
 *  (assistant only), else an estimate from text length (chars / 4). The
 *  `real` flag controls the ✓/≈ glyph shown in the UI. */
export function getMessageTokenInfo(m: Message): { count: number; real: boolean } {
  if (m.role === 'assistant' && m.meta?.outputTokens != null) {
    return { count: m.meta.outputTokens, real: true };
  }
  return { count: Math.ceil(extractMessageText(m.content).length / 4), real: false };
}

export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}