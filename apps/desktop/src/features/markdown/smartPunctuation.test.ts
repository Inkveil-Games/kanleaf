import { describe, expect, it } from 'vitest';
import { smartPunctuation } from './smartPunctuation';

describe('display typography', () => {
  it.each([
    ['"Hello" -- isn\'t ...', '“Hello” – isn’t …'],
    ["'Xin chào' --- Việt Nam", '‘Xin chào’ — Việt Nam'],
    [
      'Visit https://example.com/a--b?q="x" now -- please',
      'Visit https://example.com/a--b?q="x" now – please',
    ],
  ])('renders punctuation in %s', (source, expected) => {
    expect(smartPunctuation(source)).toBe(expected);
  });
});
