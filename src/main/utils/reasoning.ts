// src/main/utils/reasoning.ts
/**
 * Extract reasoning text from various LLM / Codex response item shapes
 * (strings, array of reasoning_text / summary_text objects, etc.)
 */
export function extractReasoningText(input: unknown): string | null {
  if (!input) return null;

  if (typeof input === 'string') {
    const trimmed = input.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (Array.isArray(input)) {
    // A-11 fix: recurse into nested arrays (some providers emit
    // [summary, [reasoning_text_obj, ...]] shapes). Without this we
    // would return [object Object] for the outer array element.
    const texts: string[] = [];
    for (const b of input) {
      const t = extractReasoningText(b);
      if (t) texts.push(t);
    }
    return texts.length > 0 ? texts.join('\n') : null;
  }

  if (typeof input === 'object') {
    const obj = input as Record<string, any>;
    // Walk the typical reasoning-field chain so we accept Anthropic,
    // OpenAI, and Codex response shapes without forcing callers to know
    // which provider the data came from.
    for (const key of [ 'summary', 'content', 'reasoning', 'text' ]) {
      const v = obj[key];
      if (v == null) continue;
      const nested = extractReasoningText(v);
      if (nested) return nested;
    }
  }

  return null;
}
