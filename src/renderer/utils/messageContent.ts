// src/renderer/utils/messageContent.ts
// Shared content-block → text/JSON projection used by the chat-flow view,
// the conversation directory, and the copy menu. Single source of truth so
// the three call sites render the same string for the same message.

import type { ContentBlock } from '../../main/model/types';

/** Concatenate the text-bearing parts of a message's content blocks into a
 *  single plain-text string. Used for token estimation, copy-to-clipboard,
 *  and any other display that needs a human-readable view of the message. */
export function extractMessageText(content: ContentBlock[]): string {
  return content
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
}

/** Same projection as `extractMessageText` but with blank-line separators
 *  between blocks — better for human paste/readability. The token estimator
 *  uses the compact form to avoid counting inserted whitespace. */
export function extractMessageTextForDisplay(content: ContentBlock[]): string {
  return content
    .map((b) => {
      if (b.type === 'text') return b.text;
      if (b.type === 'thinking') return b.thinking;
      if (b.type === 'tool_use') return `[${b.name}] ${JSON.stringify(b.input)}`;
      if (b.type === 'tool_result') {
        return typeof b.content === 'string' ? b.content : JSON.stringify(b.content, null, 2);
      }
      return '';
    })
    .filter((s) => s.length > 0)
    .join('\n\n');
}