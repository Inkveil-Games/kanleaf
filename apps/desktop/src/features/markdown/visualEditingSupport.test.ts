import { describe, expect, it } from 'vitest';
import { visualEditingSupport } from './visualEditingSupport';

describe('visualEditingSupport', () => {
  it('accepts the shared CommonMark and GFM surface including Unicode', () => {
    expect(
      visualEditingSupport(
        '# Thiết kế Kanleaf\n\n- [ ] Hoàn thành editor\n\n| A | B |\n| - | - |\n| 1 | 2 |',
      ),
    ).toEqual({ supported: true });
  });

  it('routes content with unsafe round-trip syntax to Source mode', () => {
    expect(visualEditingSupport('---\ntitle: Keep me\n---\n').supported).toBe(
      false,
    );
    expect(visualEditingSupport('Reference[^1]\n\n[^1]: Note').supported).toBe(
      false,
    );
  });

  it('allows raw HTML that Milkdown keeps verbatim', () => {
    expect(
      visualEditingSupport(
        '<details>\n<summary>Hint</summary>\n\nKeep me\n\n</details>\n\nPress <kbd>Ctrl</kbd><br/>\n\n<!-- note -->',
      ),
    ).toEqual({ supported: true });
  });

  it('ignores footnote-looking text inside code', () => {
    expect(
      visualEditingSupport('```\nitem[^1]\n```\n\nUse `[^1]: x` literally.'),
    ).toEqual({ supported: true });
  });
});
