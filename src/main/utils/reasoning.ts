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
    const texts = input
      .map((b: any) => {
        if (!b) return '';
        if (typeof b === 'string') return b;
        if (typeof b === 'object') {
          return b.text ?? b.summary ?? b.reasoning ?? '';
        }
        return '';
      })
      .filter((t: string) => typeof t === 'string' && t.trim().length > 0);

    return texts.length > 0 ? texts.join('\n') : null;
  }

  if (typeof input === 'object') {
    const obj = input as Record<string, any>;
    if (obj.summary) {
      const summaryText = extractReasoningText(obj.summary);
      if (summaryText) return summaryText;
    }
    if (obj.content) {
      const contentText = extractReasoningText(obj.content);
      if (contentText) return contentText;
    }
    if (typeof obj.text === 'string' && obj.text.trim()) {
      return obj.text.trim();
    }
  }

  return null;
}
