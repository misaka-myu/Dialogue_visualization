import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { loadClaudeSession } from '../../src/main/adapters/claude-log';
import { loadCodexSession } from '../../src/main/adapters/codex-log';

// P1-2: the B-4 rate-limited warn used to print 5 detail warns but
// NO summary when badLineCount === 5, and 5 detail + 1 summary
// when badLineCount === 6. Make the boundary consistent.
describe('JSON.parse failure summary is symmetric at the threshold (P1-2)', () => {
  let dir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dialogueviz-p12-'));
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  function summaryWarns(): string[] {
    return warnSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((s) => s.includes('total unparseable lines'));
  }

  function detailWarns(): string[] {
    return warnSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((s) => s.includes('unparseable JSONL line'));
  }

  it('claude-log: 5 bad lines emit a summary (boundary was asymmetric)', () => {
    const file = resolve(dir, 'five.jsonl');
    const lines = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'q' } }),
      'bad1', 'bad2', 'bad3', 'bad4', 'bad5',
    ];
    writeFileSync(file, lines.join('\n'), 'utf-8');
    loadClaudeSession(file);
    expect(detailWarns().length).toBe(5);
    expect(summaryWarns().length).toBe(1);
    expect(summaryWarns()[0]).toContain('5 total');
  });

  it('codex-log: 5 bad lines in loadCodexSession emit a summary', () => {
    const file = resolve(dir, 'five.jsonl');
    const lines = [
      JSON.stringify({ timestamp: '2025-01-01T00:00:00Z', type: 'session_meta', payload: { id: 's1' } }),
      'bad1', 'bad2', 'bad3', 'bad4', 'bad5',
    ];
    writeFileSync(file, lines.join('\n'), 'utf-8');
    loadCodexSession(file);
    expect(detailWarns().length).toBe(5);
    expect(summaryWarns().length).toBe(1);
    expect(summaryWarns()[0]).toContain('5 total');
  });
});
