import { describe, it, expect } from 'vitest';
import { buildRounds, fmtChars, toolInputPreview } from '../../src/renderer/components/ConversationDirectory';
import type { Message } from '../../src/main/model/types';

describe('ConversationDirectory helpers', () => {
  describe('fmtChars', () => {
    it('formats numbers correctly', () => {
      expect(fmtChars(500)).toBe('500');
      expect(fmtChars(1500)).toBe('1.5k');
      expect(fmtChars(2500000)).toBe('2.5M');
    });
  });

  describe('toolInputPreview', () => {
    it('extracts command, path, or query fields correctly', () => {
      expect(toolInputPreview({ command: 'git status' })).toBe('git status');
      expect(toolInputPreview({ file_path: '/src/main.ts' })).toBe('/src/main.ts');
      expect(toolInputPreview({ query: 'search keyword' })).toBe('search keyword');
      expect(toolInputPreview({ unknownField: 123 })).toBe('{"unknownField":123}');
    });
  });

  describe('buildRounds', () => {
    it('correctly structures standard USER -> ASSISTANT -> TOOL -> ASSISTANT flow', () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Hello, help me fix a bug' }],
        },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Let me inspect the directory first' },
            { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls -la' } },
          ],
        },
        {
          role: 'tool',
          content: [
            { type: 'tool_result', toolUseId: 'tool-1', content: 'file1.ts file2.ts' },
          ],
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'I found the files.' }],
        },
      ];

      const rounds = buildRounds(messages);
      expect(rounds).toHaveLength(1);
      expect(rounds[0].roundNumber).toBe(1);
      expect(rounds[0].userIndex).toBe(0);
      expect(rounds[0].steps).toHaveLength(4);

      expect(rounds[0].steps[0]).toEqual({
        messageIndex: 1,
        kind: 'thinking',
        preview: '',
        charCount: 34,
      });

      expect(rounds[0].steps[1]).toEqual({
        messageIndex: 1,
        kind: 'tool_call',
        toolName: 'Bash',
        preview: 'ls -la',
      });

      expect(rounds[0].steps[2]).toEqual({
        messageIndex: 2,
        kind: 'tool_result',
        toolName: 'Bash',
        preview: 'file1.ts file2.ts',
        charCount: 17,
      });

      expect(rounds[0].steps[3]).toEqual({
        messageIndex: 3,
        kind: 'response',
        preview: 'I found the files.',
        charCount: 18,
      });
    });

    it('handles leading non-user messages into round 0', () => {
      const messages: Message[] = [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Initial prompt / subagent history' }],
        },
        {
          role: 'user',
          content: [{ type: 'text', text: 'First user prompt' }],
        },
      ];

      const rounds = buildRounds(messages);
      expect(rounds).toHaveLength(2);
      expect(rounds[0].roundNumber).toBe(0);
      expect(rounds[0].userMessage).toBeUndefined();
      expect(rounds[0].steps).toHaveLength(1);

      expect(rounds[1].roundNumber).toBe(1);
      expect(rounds[1].userIndex).toBe(1);
    });

    it('ignores system messages during round construction', () => {
      const messages: Message[] = [
        { role: 'system', content: [{ type: 'text', text: 'System prompt' }] },
        { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
      ];

      const rounds = buildRounds(messages);
      expect(rounds).toHaveLength(1);
      expect(rounds[0].roundNumber).toBe(1);
      expect(rounds[0].steps).toHaveLength(0);
    });
  });
});
