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

  it('detects Codex environment_context tag', () => {
    expect(hasLocalCommandTags('<environment_context>foo</environment_context>')).toBe(true);
  });

  it('parses environment_context with simple scalar keys into entries', () => {
    const text = `<environment_context> <cwd>C:\\Users\\LENOVO\\Codex</cwd> <shell>powershell</shell> <current_date>2026-08-08</current_date> <timezone>Asia/Shanghai</timezone> </environment_context>

hi`;

    const result = parseUserTextSegments(text);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('ide_context');
    if (result[0].type !== 'ide_context') throw new Error('expected ide_context');
    expect(result[0].kind).toBe('environment_context');
    expect(result[0].entries.map((e) => [e.key, e.value])).toEqual([
      ['cwd', 'C:\\Users\\LENOVO\\Codex'],
      ['shell', 'powershell'],
      ['current_date', '2026-08-08'],
      ['timezone', 'Asia/Shanghai'],
    ]);
    expect(result[1]).toEqual({ type: 'text', text: 'hi' });
  });

  it('parses environment_context with multiple <root> as multi-value entry', () => {
    const text = `<environment_context>
  <filesystem>
    <workspace_roots>
      <root>C:\\Users\\LENOVO\\Codex</root>
      <root>C:\\Users\\LENOVO\\Codex\\2026-08-08</root>
      <root>C:\\Users\\LENOVO\\.codex\\visualizations</root>
    </workspace_roots>
    <permission_profile type="disabled" />
    <file_system type="unrestricted" />
  </filesystem>
</environment_context>`;

    const result = parseUserTextSegments(text);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('ide_context');
    if (result[0].type !== 'ide_context') throw new Error('expected ide_context');
    const byKey = Object.fromEntries(result[0].entries.map((e) => [e.key, e]));
    expect(byKey.workspace_roots?.values).toEqual([
      'C:\\Users\\LENOVO\\Codex',
      'C:\\Users\\LENOVO\\Codex\\2026-08-08',
      'C:\\Users\\LENOVO\\.codex\\visualizations',
    ]);
    expect(byKey['permission_profile.type']).toEqual({ key: 'permission_profile.type', value: 'disabled' });
    expect(byKey['file_system.type']).toEqual({ key: 'file_system.type', value: 'unrestricted' });
  });

  it('parses AGENTS.md instructions tag as kind=agents_instructions', () => {
    const text = `<AGENTS.md instructions for C:\\Users\\LENOVO\\Codex>
- Use pnpm
- Don't write to /

请帮我加一个按钮`;

    const result = parseUserTextSegments(text);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0].type).toBe('ide_context');
    if (result[0].type !== 'ide_context') throw new Error('expected ide_context');
    expect(result[0].kind).toBe('agents_instructions');
    expect(result[0].raw).toContain('Use pnpm');
  });

  it('parses Context from my IDE setup as kind=ide_context', () => {
    const text = `<Context from my IDE setup:vscode>
<active_file>src/foo.ts</active_file>
</Context from my IDE setup>`;

    const result = parseUserTextSegments(text);
    expect(result[0].type).toBe('ide_context');
    if (result[0].type !== 'ide_context') throw new Error('expected ide_context');
    expect(result[0].kind).toBe('ide_context');
    expect(result[0].entries.map((e) => e.key)).toContain('active_file');
  });

  it('keeps IDE context and system-reminder independent', () => {
    const text = `<system-reminder>currentDate 2026-08-08</system-reminder>
<environment_context><cwd>/x</cwd></environment_context>
plain text`;

    const result = parseUserTextSegments(text);
    expect(result).toHaveLength(3);
    expect(result[0].type).toBe('system_reminder');
    expect(result[1].type).toBe('ide_context');
    expect(result[2]).toEqual({ type: 'text', text: 'plain text' });
  });
});
