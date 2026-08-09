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

/** A single key/value pair inside an IDE context block. `multi: true`
 *  means the same key appeared multiple times (e.g. <root> inside
 *  <workspace_roots>); `values` collects them all. */
export interface IdeContextEntry {
  key: string;
  /** Single-value entries (cwd, shell, current_date, ...) put their
   *  value here; multi-value entries also expose it as the joined
   *  preview while preserving the array. */
  value: string;
  values?: string[];
}

/** A Codex-style IDE context injection: <environment_context>,
 *  <AGENTS.md instructions for ...>, <Context from my IDE setup:>.
 *  Pre-parsed into a flat list of key/value pairs so the renderer
 *  doesn't have to know the XML structure. */
export interface IdeContextSegment {
  type: 'ide_context';
  kind: 'environment_context' | 'agents_instructions' | 'ide_context';
  entries: IdeContextEntry[];
  /** Raw inner XML — kept so we don't lose anything if a future Codex
   *  version adds a key we don't recognise. */
  raw: string;
}

export interface UserTextSegment {
  type: 'text';
  text: string;
}

export type ParsedUserSegment =
  | LocalCommandSegment
  | SystemReminderSegment
  | IdeContextSegment
  | UserTextSegment;

/** Tags the parser recognises as "structured injection". A user message
 *  that contains any of these gets parsed; otherwise it stays a single
 *  text segment and is rendered as Markdown. */
export function hasLocalCommandTags(text: string): boolean {
  return /<command-name>|<local-command-stdout>|<command-stdout>|<local-command-stderr>|<command-stderr>|<system-reminder>|<environment_context>|<AGENTS\.md instructions|<Context from my IDE setup/i.test(text);
}

/** Top-level *terminated* bracket tags we extract verbatim. Unterminated
 *  Codex tags (AGENTS.md, Context from my IDE) are scanned separately
 *  in the main loop because JS regex's lazy+zero-width-lookahead combo
 *  extends to end-of-string at file end. */
const TERMINATED_TAG_REGEX = /(?:<command-name>[\s\S]*?<\/command-name>|<system-reminder>[\s\S]*?<\/system-reminder>|<environment_context>[\s\S]*?<\/environment_context>|(?:<local-command-stdout>|<command-stdout>)[\s\S]*?(?:<\/local-command-stdout>|<\/command-stdout>)|(?:<local-command-stderr>|<command-stderr>)[\s\S]*?(?:<\/local-command-stderr>|<\/command-stderr>))/gi;

/** Openers for the two unterminated Codex context tags. */
const UNTERMINATED_OPENER_PATTERNS: { re: RegExp; kind: 'agents_instructions' | 'ide_context' }[] = [
  { re: /<AGENTS\.md instructions(?:\s+for\s+[^\n>]*)?>/gi, kind: 'agents_instructions' },
  { re: /<Context from my IDE setup:[^>\n]*>/gi, kind: 'ide_context' },
];

/** Find the next unterminated opener starting at or after `from`. Returns
 *  the absolute index + opener length, or null. Resets each regex's
 *  lastIndex before scanning so a stale state from the last call
 *  doesn't leak. */
function findNextUnterminatedOpener(text: string, from: number): { index: number; openerLength: number; kind: 'agents_instructions' | 'ide_context' } | null {
  let best: { index: number; openerLength: number; kind: 'agents_instructions' | 'ide_context' } | null = null;
  for (const { re, kind } of UNTERMINATED_OPENER_PATTERNS) {
    re.lastIndex = from;
    const m = re.exec(text);
    if (m && (best === null || m.index < best.index)) {
      best = { index: m.index, openerLength: m[0].length, kind };
    }
  }
  return best;
}

/** Return the absolute index of the next terminated tag starting at or
 *  after `from`, or text.length when none follows. Used to bound
 *  unterminated segments so they don't accidentally consume a
 *  subsequent terminated tag. */
function nextTerminatedTagStart(text: string, from: number): number {
  const re = /<command-name>|<system-reminder>|<environment_context>|<local-command-stdout>|<command-stdout>|<local-command-stderr>|<command-stderr>/gi;
  re.lastIndex = from;
  const m = re.exec(text);
  return m ? m.index : text.length;
}
const TAG_REGEX = TERMINATED_TAG_REGEX;

/**
 * Codex injects a multi-line IDE context into user turns with shape:
 *
 *   <environment_context>
 *     <cwd>C:\Users\...\Codex\2026-08-08</cwd>
 *     <shell>powershell</shell>
 *     <current_date>2026-08-08</current_date>
 *     <timezone>Asia/Shanghai</timezone>
 *     <filesystem>
 *       <workspace_roots>
 *         <root>C:\Users\...\Codex</root>
 *         <root>C:\Users\...\Codex\2026-08-08</root>
 *       </workspace_roots>
 *       <permission_profile type="disabled" />
 *       <file_system type="unrestricted" />
 *     </filesystem>
 *   </environment_context>
 *
 * The structure is loose: keys can repeat (workspace_roots has multiple
 * <root> children), and leaf elements sometimes carry attributes
 * (permission_profile type="disabled"). We just walk recursively and
 * flatten to { key, value, values? } pairs. Unknown nesting shows up
 * as `<parent>.<child>: <text>` — better than dropping data.
 *
 * Implementation note: this is a small recursive descent rather than
 * a single regex because the XML supports arbitrary nesting depth and
 * the nested keys matter (workspace_roots > root vs raw <root>).
 */
function parseIdeContextInner(xml: string): IdeContextEntry[] {
  const entries: IdeContextEntry[] = [];
  let pos = 0;

  while (pos < xml.length) {
    const lt = xml.indexOf('<', pos);
    if (lt === -1) break;
    if (lt !== pos && xml.slice(pos, lt).trim()) {
      // Stray text outside any tag — ignore (whitespace between tags).
    }
    pos = lt;

    // Self-closing: <permission_profile type="disabled" />
    const selfClose = /^<([a-zA-Z0-9_-]+)([^>]*?)\/>/.exec(xml.slice(pos));
    if (selfClose) {
      const tag = selfClose[1];
      const attrs = selfClose[2] ?? '';
      const attrPairs = [...attrs.matchAll(/([a-zA-Z0-9_-]+)\s*=\s*"([^"]*)"/g)];
      pos += selfClose[0].length;
      if (attrPairs.length === 0) {
        entries.push({ key: tag, value: '' });
      } else {
        for (const ap of attrPairs) {
          entries.push({ key: `${tag}.${ap[1]}`, value: ap[2] });
        }
      }
      continue;
    }

    // Paired: <key> ... </key> — may contain nested children.
    const openTag = /^<([a-zA-Z0-9_-]+)>/.exec(xml.slice(pos));
    if (openTag) {
      const tag = openTag[1];
      const openEnd = pos + openTag[0].length;
      const closeStart = findMatchingClose(xml, openEnd, tag);
      if (closeStart === -1) break;
      const inner = xml.slice(openEnd, closeStart);
      const childEntries = parseIdeContextInner(inner);

      if (childEntries.length === 0) {
        // Leaf with text content — collect the trimmed text as the value.
        // Multi-occurrence of the same leaf key folds into a single
        // entry with a values array.
        const leafValue = inner.trim();
        if (leafValue) {
          const existing = entries.find((e) => e.key === tag);
          if (existing) {
            if (!existing.values) existing.values = [existing.value];
            existing.values.push(leafValue);
            existing.value = existing.values.join(', ');
          } else {
            entries.push({ key: tag, value: leafValue });
          }
        }
      } else {
        // Container. Fold into one entry keyed by the container name
        // when every child shares the same key (e.g. <workspace_roots>
        // with multiple <root> children). When the children have
        // heterogeneous keys, just keep them as-is.
        const firstKey = childEntries[0].key;
        const allSame = childEntries.every((c) => c.key === firstKey);
        if (allSame) {
          // childEntries may itself be the result of a leaf-branch fold
          // (a single entry with a values array). Prefer those raw
          // values over re-splitting the joined string.
          const values = childEntries[0].values ?? childEntries.map((c) => c.value);
          entries.push({
            key: tag,
            value: values.join(', '),
            values,
          });
        } else {
          entries.push(...childEntries);
        }
      }
      pos = closeStart + `</${tag}>`.length;
      continue;
    }

    pos++;
  }

  return entries;
}

/** Find the `</tag>` that closes the element opened at `from`. Skips
 *  over nested same-name elements so we don't terminate early. */
function findMatchingClose(xml: string, from: number, tag: string): number {
  let depth = 1;
  const openRe = new RegExp(`<(${tag})>|<\\/(${tag})>`, 'g');
  openRe.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(xml)) !== null) {
    if (m[2] !== undefined) {
      depth--;
      if (depth === 0) return m.index;
    } else {
      depth++;
    }
  }
  return -1;
}

export function parseUserTextSegments(text: string): ParsedUserSegment[] {
  if (!hasLocalCommandTags(text)) {
    return [{ type: 'text', text }];
  }

  const segments: ParsedUserSegment[] = [];

  // NOTE: TERMINATED_TAG_REGEX is /gi — module-scoped, but we explicitly
  // sync lastIndex before each exec so concurrent parseUserTextSegments
  // calls don't race. The only caller today is React render which is
  // single-threaded; documented here so the next maintainer doesn't trip.

  let lastIndex = 0;

  // Drive the loop by "what's the next interesting boundary?" — either
  // a terminated tag (system-reminder, environment_context, command
  // block, stdout/stderr) or an unterminated opener (AGENTS.md,
  // Context from my IDE). Whichever comes first wins; the other is
  // re-evaluated on the next iteration from `lastIndex`. This avoids
  // the JS regex pitfall where lazy + zero-width-lookahead swallows
  // everything to end-of-string when no following tag exists.
  while (lastIndex < text.length) {
    const terminatedMatch = (() => {
      TERMINATED_TAG_REGEX.lastIndex = lastIndex;
      return TERMINATED_TAG_REGEX.exec(text);
    })();
    const unterminated = findNextUnterminatedOpener(text, lastIndex);

    // Pick whichever boundary comes first. Skip if the unterminated
    // opener is at-or-before where we'd consume a terminated tag (it
    // wins).
    if (unterminated && (!terminatedMatch || unterminated.index < terminatedMatch.index)) {
      const preceding = text.slice(lastIndex, unterminated.index).trim();
      if (preceding) {
        segments.push({ type: 'text', text: preceding });
      }
      // Unterminated openers (AGENTS.md, Context from my IDE) end at
      // the first paragraph break (blank line) OR the next terminated
      // tag, whichever comes first. They don't span an indefinite
      // tail of arbitrary text.
      const paraBreakIdx = text.indexOf('\n\n', unterminated.index + unterminated.openerLength);
      const tagStartIdx = nextTerminatedTagStart(text, unterminated.index + unterminated.openerLength);
      const endAtCandidates = [text.length, paraBreakIdx, tagStartIdx]
        .filter((i): i is number => i !== -1);
      const endAt = Math.min(...endAtCandidates);
      const inner = text.slice(unterminated.index + unterminated.openerLength, endAt);
      segments.push({
        type: 'ide_context',
        kind: unterminated.kind,
        entries: parseIdeContextInner(inner),
        raw: inner.trim(),
      });
      lastIndex = endAt;
      continue;
    }

    if (!terminatedMatch) {
      // No more tags — emit remaining text and stop.
      const trailing = text.slice(lastIndex).trim();
      if (trailing) {
        segments.push({ type: 'text', text: trailing });
      }
      break;
    }

    const preceding = text.slice(lastIndex, terminatedMatch.index).trim();
    if (preceding) {
      segments.push({ type: 'text', text: preceding });
    }

    const matchedTag = terminatedMatch[0];
    const match = terminatedMatch;

    // Case 1: <system-reminder>
    const systemReminderMatch = /<system-reminder>([\s\S]*?)<\/system-reminder>/i.exec(matchedTag);
    if (systemReminderMatch) {
      segments.push({
        type: 'system_reminder',
        text: systemReminderMatch[1].trim(),
      });
      lastIndex = terminatedMatch.index + matchedTag.length;
      continue;
    }

    // Case 2: <environment_context> (Codex IDE context)
    const envCtxMatch = /<environment_context>([\s\S]*?)<\/environment_context>/i.exec(matchedTag);
    if (envCtxMatch) {
      segments.push({
        type: 'ide_context',
        kind: 'environment_context',
        entries: parseIdeContextInner(envCtxMatch[1]),
        raw: envCtxMatch[1].trim(),
      });
      lastIndex = terminatedMatch.index + matchedTag.length;
      continue;
    }

    // Case 3: <command-name> block
    if (/<command-name>/i.test(matchedTag)) {
      const start = match.index;
      // Find the next command block start position to scope this chunk
      const nextCmdMatch = /<command-name>|<system-reminder>|<environment_context>/gi;
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
      continue;
    }

    // Case 4: Orphan stdout/stderr tag
    const stdoutMatch = /(?:<local-command-stdout>|<command-stdout>)([\s\S]*?)(?:<\/local-command-stdout>|<\/command-stdout>)/i.exec(matchedTag);
    const stderrMatch = /(?:<local-command-stderr>|<command-stderr>)([\s\S]*?)(?:<\/local-command-stderr>|<\/command-stderr>)/i.exec(matchedTag);
    if (stdoutMatch || stderrMatch) {
      segments.push({
        type: 'local_command',
        name: 'local-command',
        stdout: stdoutMatch ? stdoutMatch[1].trim() : undefined,
        stderr: stderrMatch ? stderrMatch[1].trim() : undefined,
      });
      lastIndex = terminatedMatch.index + matchedTag.length;
      continue;
    }

    // Shouldn't reach — every terminated-tag branch advances lastIndex
    // and continues. Skip ahead defensively to avoid an infinite loop
    // if a future regex change adds an unrecognised branch.
    lastIndex = terminatedMatch.index + matchedTag.length;
  }

  return segments.length > 0 ? segments : [{ type: 'text', text }];
}