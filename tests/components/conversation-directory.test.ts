import { describe, it, expect } from 'vitest';
import { buildRounds, fmtChars, toolInputPreview, userPreview } from '../../src/renderer/components/ConversationDirectory';
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

  describe('userPreview', () => {
    it('strips Claude Code CLI XML injection tags so the directory shows actual user text', () => {
      const msg: Message = {
        role: 'user',
        content: [{
          type: 'text',
          text: '<command-name>/init</command-name> <command-message>init</command-message> <command-args></command-args>\n\n<local-command-stdout>created CLAUDE.md</local-command-stdout>',
        }],
      };
      const preview = userPreview(msg);
      expect(preview).not.toMatch(/<command-/);
      expect(preview).not.toMatch(/<local-command-/);
      // No real user text after stripping — falls back to empty string.
      expect(preview).toBe('');
    });

    it('returns the user text when CLI tags are followed by an actual question', () => {
      const msg: Message = {
        role: 'user',
        content: [{
          type: 'text',
          text: '<command-name>/help</command-name>\n\nhow do I configure the proxy?',
        }],
      };
      expect(userPreview(msg)).toBe('how do I configure the proxy?');
    });

    it('passes plain text through unchanged', () => {
      const msg: Message = {
        role: 'user',
        content: [{ type: 'text', text: 'plain question about Claude Code' }],
      };
      expect(userPreview(msg)).toBe('plain question about Claude Code');
    });

    it('caps preview at 100 characters', () => {
      const msg: Message = {
        role: 'user',
        content: [{ type: 'text', text: 'a'.repeat(250) }],
      };
      expect(userPreview(msg).length).toBe(100);
    });

    it('strips unknown CLI XML injections like <task-notification>', () => {
      const msg: Message = {
        role: 'user',
        content: [{
          type: 'text',
          text: '<task-notification> <task-id>bxe1a4jd1</task-id> <tool-use-result>hidden</tool-use-result> </task-notification>',
        }],
      };
      const preview = userPreview(msg);
      expect(preview).not.toMatch(/<[^>]+>/);
      // Self-closing + nested tags all leave no readable prose — fallback to empty.
      expect(preview).toBe('');
    });

    it('strips XML and keeps surrounding prose', () => {
      const msg: Message = {
        role: 'user',
        content: [{
          type: 'text',
          text: '<task-notification> <task-id>abc</task-id> </task-notification>\n\nplease continue with the next step',
        }],
      };
      expect(userPreview(msg)).toBe('please continue with the next step');
    });

    it('strips self-closing tags without an open/close pair', () => {
      const msg: Message = {
        role: 'user',
        content: [{ type: 'text', text: '<image attachment="cat.png" />\nwhat do you see?' }],
      };
      expect(userPreview(msg)).toBe('what do you see?');
    });

    it('preserves prose that looks like math/emoji, e.g. "I <3 cats"', () => {
      // The opener must be letter-prefixed to be classified as XML;
      // a "<3" with no matching ">" (or with a non-letter tag name)
      // stays as-is so we don't shred natural prose.
      const msg: Message = {
        role: 'user',
        content: [{ type: 'text', text: 'I <3 cats and x < 3 means something' }],
      };
      expect(userPreview(msg)).toBe('I <3 cats and x < 3 means something');
    });

    it('only strips tags with a letter-prefixed name, leaves bare angle brackets alone', () => {
      const msg: Message = {
        role: 'user',
        content: [{ type: 'text', text: '<3> is a heart, <task-id> is XML' }],
      };
      // <3> has a digit opener — left alone. <task-id>...</task-id>
      // is a real tag — stripped along with its body.
      expect(userPreview(msg)).toBe('<3> is a heart, is XML');
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

