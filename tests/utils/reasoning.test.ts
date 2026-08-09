import { describe, it, expect } from 'vitest';
import { extractReasoningText } from '../../src/main/utils/reasoning';

// A-11 regression suite. The old implementation only handled one level
// of array nesting; nested arrays like `[[{text: ...}]]` returned
// `[object Object]` for the inner element instead of unwinding it.
describe('extractReasoningText', () => {
  it('returns null for empty / falsy input', () => {
    expect(extractReasoningText(null)).toBeNull();
    expect(extractReasoningText(undefined)).toBeNull();
    expect(extractReasoningText('')).toBeNull();
    expect(extractReasoningText([])).toBeNull();
  });

  it('returns the trimmed string for plain strings', () => {
    expect(extractReasoningText('hello')).toBe('hello');
    expect(extractReasoningText('  spaced  ')).toBe('spaced');
  });

  it('returns the text field from a single object', () => {
    expect(extractReasoningText({ text: 'r1' })).toBe('r1');
    expect(extractReasoningText({ summary: 's1' })).toBe('s1');
    expect(extractReasoningText({ reasoning: 'r2' })).toBe('r2');
  });

  it('joins text fields from a flat array of objects', () => {
    const input = [{ text: 'a' }, { text: 'b' }, { reasoning: 'c' }];
    expect(extractReasoningText(input)).toBe('a\nb\nc');
  });

  it('A-11: recurses into nested arrays ([[{text: ...}]] shape)', () => {
    // Some providers emit double-wrapped arrays.
    const input = [[{ text: 'inner-a' }], [{ text: 'inner-b' }]];
    expect(extractReasoningText(input)).toBe('inner-a\ninner-b');
  });

  it('A-11: recurses deeply into objects with .content / .summary chains', () => {
    const input = {
      content: [{ text: 'a' }, { summary: [{ text: 'b' }] }],
    };
    expect(extractReasoningText(input)).toBe('a\nb');
  });

  it('skips null / non-text elements without throwing', () => {
    const input = [null, 'real', undefined, { text: '' }, { text: '  ' }, { text: 'kept' }];
    expect(extractReasoningText(input)).toBe('real\nkept');
  });
});
