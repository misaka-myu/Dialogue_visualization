import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadClaudeSession } from '../../src/main/adapters/claude-log';
import { loadCodexSession } from '../../src/main/adapters/codex-log';

// B-4 regression: corrupt JSONL lines should produce a console.warn
// (rate-limited to <= 5 per file plus a final summary) instead of being
// silently swallowed.
describe('JSON.parse failures are rate-limited-warned (B-4)', () => {
  let dir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dialogueviz-warn-'));
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  it('claude-log: caps per-line warnings and emits a final summary', () => {
    const file = join(dir, 'corrupt.jsonl');
    const lines = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'first valid' } }),
      'this-is-not-json',
      'also-not-json',
      'still-not-json',
      'four-bad',
      'five-bad',
      'six-bad',
      'seven-bad',
    ];
    writeFileSync(file, lines.join('\n'), 'utf-8');
    loadClaudeSession(file);
    // First 5 bad lines should each emit a warn with the file path.
    const perLineWarns = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes('unparseable JSONL line') && String(c[0]).includes(file),
    );
    expect(perLineWarns.length).toBeLessThanOrEqual(5);
    // Once we cross 5 bad lines there should be a summary warn.
    const summaryWarn = warnSpy.mock.calls.find((c) =>
      String(c[0]).includes('total unparseable lines') && String(c[0]).includes(file),
    );
    expect(summaryWarn).toBeDefined();
  });

  it('claude-log: 1-2 bad lines only emit per-line warns (no summary)', () => {
    const file = join(dir, 'mostly-ok.jsonl');
    const lines = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
      'bad-line',
    ];
    writeFileSync(file, lines.join('\n'), 'utf-8');
    loadClaudeSession(file);
    const summaryWarn = warnSpy.mock.calls.find((c) =>
      String(c[0]).includes('total unparseable lines'),
    );
    expect(summaryWarn).toBeUndefined();
  });

  it('codex-log: caps per-line warnings and emits a final summary', () => {
    const file = join(dir, 'corrupt.jsonl');
    const lines = [
      JSON.stringify({ timestamp: '2025-01-01T00:00:00Z', type: 'session_meta', payload: { id: 's1' } }),
      'bad1', 'bad2', 'bad3', 'bad4', 'bad5', 'bad6', 'bad7',
    ];
    writeFileSync(file, lines.join('\n'), 'utf-8');
    loadCodexSession(file);
    const perLineWarns = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes('[codex-log] unparseable JSONL line') && String(c[0]).includes(file),
    );
    expect(perLineWarns.length).toBeLessThanOrEqual(5);
    const summaryWarn = warnSpy.mock.calls.find((c) =>
      String(c[0]).includes('[codex-log]') && String(c[0]).includes('total unparseable lines'),
    );
    expect(summaryWarn).toBeDefined();
  });
});
