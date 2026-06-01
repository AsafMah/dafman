import { describe, expect, test } from 'bun:test';
import { resolveHighlightedOption } from '@/components/chat/slashCommandSelection';

describe('resolveHighlightedOption', () => {
  const options = ['first', 'second', 'third'] as const;

  test('returns the highlighted option instead of always using the first option', () => {
    expect(resolveHighlightedOption(options, 2)).toBe('third');
  });

  test('falls back to the first option when lexical-vue has not highlighted one', () => {
    expect(resolveHighlightedOption(options, null)).toBe('first');
    expect(resolveHighlightedOption(options, undefined)).toBe('first');
  });

  test('falls back to the first option for invalid highlighted indexes', () => {
    expect(resolveHighlightedOption(options, -1)).toBe('first');
    expect(resolveHighlightedOption(options, 3)).toBe('first');
    expect(resolveHighlightedOption(options, 1.5)).toBe('first');
  });

  test('returns null when there are no selectable options', () => {
    expect(resolveHighlightedOption([], 0)).toBeNull();
  });
});
