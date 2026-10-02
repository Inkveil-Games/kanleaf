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
    expect(visualEditingSupport('<details>Keep me</details>').supported).toBe(
      false,
    );
    expect(visualEditingSupport('---\ntitle: Keep me\n---\n').supported).toBe(
      false,
    );
    expect(visualEditingSupport('Reference[^1]\n\n[^1]: Note').supported).toBe(
      false,
    );
  });

  it('allows HTML-looking code and line breaks that Milkdown preserves', () => {
    expect(
      visualEditingSupport(
        '```mermaid\nNote right of John: a long<br/>line\n```\n\n> <br />\n',
      ),
    ).toEqual({ supported: true });
  });
});
