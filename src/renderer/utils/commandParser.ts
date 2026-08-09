// src/renderer/utils/commandParser.ts

export interface LocalCommandSegment {
  type: 'local_command';
  name: string;
  message?: string;
  args?: string;
  stdout?: string;
  stderr?: string;
}

export interface SystemReminderSegment {
  type: 'system_reminder';
  text: string;
}

export interface UserTextSegment {
  type: 'text';
  text: string;
}

export type ParsedUserSegment = LocalCommandSegment | SystemReminderSegment | UserTextSegment;

export function hasLocalCommandTags(text: string): boolean {
  return /<command-name>|<local-command-stdout>|<command-stdout>|<local-command-stderr>|<command-stderr>|<system-reminder>/.test(text);
}

export function parseUserTextSegments(text: string): ParsedUserSegment[] {
  if (!hasLocalCommandTags(text)) {
    return [{ type: 'text', text }];
  }

  const segments: ParsedUserSegment[] = [];

  // Regex patterns
  const tagRegex = /(?:<command-name>[\s\S]*?<\/command-name>|<system-reminder>[\s\S]*?<\/system-reminder>|(?:<local-command-stdout>|<command-stdout>)[\s\S]*?(?:<\/local-command-stdout>|<\/command-stdout>)|(?:<local-command-stderr>|<command-stderr>)[\s\S]*?(?:<\/local-command-stderr>|<\/command-stderr>))/gi;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(text)) !== null) {
    const preceding = text.slice(lastIndex, match.index).trim();
    if (preceding) {
      segments.push({ type: 'text', text: preceding });
    }

    const matchedTag = match[0];

    // Case 1: <system-reminder>
    const systemReminderMatch = /<system-reminder>([\s\S]*?)<\/system-reminder>/i.exec(matchedTag);
    if (systemReminderMatch) {
      segments.push({
        type: 'system_reminder',
        text: systemReminderMatch[1].trim(),
      });
      lastIndex = tagRegex.lastIndex;
      continue;
    }

    // Case 2: <command-name> block
    if (/<command-name>/i.test(matchedTag)) {
      const start = match.index;
      // Find the next command block start position to scope this chunk
      const nextCmdMatch = /<command-name>|<system-reminder>/gi;
      nextCmdMatch.lastIndex = start + matchedTag.length;
      const nextTag = nextCmdMatch.exec(text);
      const nextStart = nextTag ? nextTag.index : text.length;

      const chunk = text.slice(start, nextStart);

      const nameMatch = /<command-name>([\s\S]*?)<\/command-name>/i.exec(chunk);
      const msgMatch = /<command-message>([\s\S]*?)<\/command-message>/i.exec(chunk);
      const argsMatch = /<command-args>([\s\S]*?)<\/command-args>/i.exec(chunk);
      const stdoutMatch = /(?:<local-command-stdout>|<command-stdout>)([\s\S]*?)(?:<\/local-command-stdout>|<\/command-stdout>)/i.exec(chunk);
      const stderrMatch = /(?:<local-command-stderr>|<command-stderr>)([\s\S]*?)(?:<\/local-command-stderr>|<\/command-stderr>)/i.exec(chunk);

      let chunkEndInChunk = chunk.length;
      const endTagMatches = Array.from(chunk.matchAll(/<\/(?:local-command-stdout|command-stdout|local-command-stderr|command-stderr|command-args|command-message|command-name)>/gi));
      if (endTagMatches.length > 0) {
        const lastTag = endTagMatches[endTagMatches.length - 1];
        chunkEndInChunk = lastTag.index + lastTag[0].length;
      }

      segments.push({
        type: 'local_command',
        name: nameMatch ? nameMatch[1].trim() : 'local-command',
        message: msgMatch ? msgMatch[1].trim() || undefined : undefined,
        args: argsMatch ? argsMatch[1].trim() || undefined : undefined,
        stdout: stdoutMatch ? stdoutMatch[1].trim() || undefined : undefined,
        stderr: stderrMatch ? stderrMatch[1].trim() || undefined : undefined,
      });

      lastIndex = start + chunkEndInChunk;
      tagRegex.lastIndex = lastIndex;
      continue;
    }

    // Case 3: Orphan stdout/stderr tag
    const stdoutMatch = /(?:<local-command-stdout>|<command-stdout>)([\s\S]*?)(?:<\/local-command-stdout>|<\/command-stdout>)/i.exec(matchedTag);
    const stderrMatch = /(?:<local-command-stderr>|<command-stderr>)([\s\S]*?)(?:<\/local-command-stderr>|<\/command-stderr>)/i.exec(matchedTag);
    if (stdoutMatch || stderrMatch) {
      segments.push({
        type: 'local_command',
        name: 'local-command',
        stdout: stdoutMatch ? stdoutMatch[1].trim() : undefined,
        stderr: stderrMatch ? stderrMatch[1].trim() : undefined,
      });
      lastIndex = tagRegex.lastIndex;
      continue;
    }

    lastIndex = tagRegex.lastIndex;
  }

  const trailing = text.slice(lastIndex).trim();
  if (trailing) {
    segments.push({ type: 'text', text: trailing });
  }

  return segments.length > 0 ? segments : [{ type: 'text', text }];
}
