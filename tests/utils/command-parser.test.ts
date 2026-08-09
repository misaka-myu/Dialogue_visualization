import { describe, it, expect } from 'vitest';
import { parseUserTextSegments, hasLocalCommandTags } from '../../src/renderer/utils/commandParser';

describe('commandParser', () => {
  it('detects local command tags correctly', () => {
    expect(hasLocalCommandTags('Hello world')).toBe(false);
    expect(hasLocalCommandTags('<command-name>/mcp</command-name>')).toBe(true);
    expect(hasLocalCommandTags('<local-command-stdout>test</local-command-stdout>')).toBe(true);
  });

  it('returns plain text when no command tags exist', () => {
    const text = '这个github cli和github的mcp有什么区别呢？';
    const result = parseUserTextSegments(text);
    expect(result).toEqual([{ type: 'text', text }]);
  });

  it('parses embedded /mcp command block and trailing question', () => {
    const text = `<command-name>/mcp</command-name> <command-message>mcp</command-message> <command-args></command-args>

<local-command-stdout>MCP dialog dismissed</local-command-stdout>

这个github cli和github的mcp都可以对github进行一些操作，那么他们有什么区别呢？我想了解一下`;

    const result = parseUserTextSegments(text);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      type: 'local_command',
      name: '/mcp',
      message: 'mcp',
      args: undefined,
      stdout: 'MCP dialog dismissed',
      stderr: undefined,
    });
    expect(result[1]).toEqual({
      type: 'text',
      text: '这个github cli和github的mcp都可以对github进行一些操作，那么他们有什么区别呢？我想了解一下',
    });
  });

  it('handles multiple commands in a single user message', () => {
    const text = `<command-name>/mcp</command-name><local-command-stdout>MCP dismissed</local-command-stdout>
<command-name>/clear</command-name><local-command-stdout>Cleared screen</local-command-stdout>
Final question text`;

    const result = parseUserTextSegments(text);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ type: 'local_command', name: '/mcp', stdout: 'MCP dismissed' });
    expect(result[1]).toMatchObject({ type: 'local_command', name: '/clear', stdout: 'Cleared screen' });
    expect(result[2]).toEqual({ type: 'text', text: 'Final question text' });
  });

  it('parses system-reminder tag into SystemReminderSegment', () => {
    const text = `<system-reminder> As you answer the user's questions, you can use the following context: # currentDate Today's date is 2026-08-08. </system-reminder>

hi`;

    const result = parseUserTextSegments(text);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      type: 'system_reminder',
      text: "As you answer the user's questions, you can use the following context: # currentDate Today's date is 2026-08-08.",
    });
    expect(result[1]).toEqual({
      type: 'text',
      text: 'hi',
    });
  });
});
