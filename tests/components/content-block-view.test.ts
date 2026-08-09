import { describe, it, expect } from 'vitest';
import { formatToolValue } from '../../src/renderer/components/ContentBlockView';

describe('formatToolValue', () => {
  it('returns short strings verbatim (not truncated)', () => {
    const r = formatToolValue('hello');
    expect(r.preview).toBe('hello');
    expect(r.full).toBe('hello');
    expect(r.truncated).toBe(false);
  });

  it('truncates long strings with an ellipsis marker', () => {
    const long = 'x'.repeat(500);
    const r = formatToolValue(long, 100);
    expect(r.truncated).toBe(true);
    expect(r.preview.endsWith('…')).toBe(true);
    // preview is capped, full is preserved.
    expect(r.preview.length).toBeLessThanOrEqual(101);
    expect(r.full.length).toBe(500);
  });

  it('stringifies objects as indented JSON', () => {
    const r = formatToolValue({ command: 'ls -la', workdir: '/tmp' });
    expect(r.truncated).toBe(false);
    expect(r.preview).toBe(JSON.stringify({ command: 'ls -la', workdir: '/tmp' }, null, 2));
    expect(r.preview).toContain('\n');
  });

  it('stringifies arrays the same way', () => {
    const r = formatToolValue([1, 2, 3]);
    expect(r.preview).toBe('[\n  1,\n  2,\n  3\n]');
    expect(r.truncated).toBe(false);
  });

  it('handles null and undefined', () => {
    expect(formatToolValue(null).preview).toBe('null');
    expect(formatToolValue(undefined).preview).toBe('undefined');
  });
});