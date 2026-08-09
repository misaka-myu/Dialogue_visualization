import { describe, it, expect } from 'vitest';
import { extractMessageTextForDisplay } from '../../src/renderer/utils/messageContent';
import { toCopyJSON } from '../../src/renderer/utils/messageCopy';
import { Message } from '../../src/main/model/types';

describe('HoverCopyBar helpers', () => {
  const mockMsg: Message = {
    role: 'user',
    content: [
      { type: 'text', text: 'Hello AI world' },
    ],
  };

  it('extracts display text correctly for copy', () => {
    const text = extractMessageTextForDisplay(mockMsg.content);
    expect(text).toBe('Hello AI world');
  });

  it('formats copy JSON correctly', () => {
    const json = toCopyJSON(mockMsg);
    expect(JSON.parse(json)).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'Hello AI world' }],
      meta: null,
    });
  });
});
