import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { activeLogicalBlockRanges } from './livePreview';

const fixture = `# Architecture

First **paragraph** spans
two source lines.

- [x] Parent item
  - Nested item

| Layer | Store |
| --- | --- |
| Task | PostgreSQL |

\`\`\`rust
let source = true;
\`\`\`
`;

function stateAt(anchor: number, head = anchor) {
  return EditorState.create({
    doc: fixture,
    selection: { anchor, head },
    extensions: [markdown({ base: markdownLanguage })],
  });
}

describe('activeLogicalBlockRanges', () => {
  it('reveals the complete logical block containing the cursor', () => {
    const paragraphCursor = fixture.indexOf('paragraph');
    const [paragraph] = activeLogicalBlockRanges(stateAt(paragraphCursor));
    expect(fixture.slice(paragraph.from, paragraph.to)).toBe(
      'First **paragraph** spans\ntwo source lines.',
    );

    const nestedCursor = fixture.indexOf('Nested');
    const [nested] = activeLogicalBlockRanges(stateAt(nestedCursor));
    expect(fixture.slice(nested.from, nested.to)).toBe('  - Nested item');

    const tableCursor = fixture.indexOf('PostgreSQL');
    const [table] = activeLogicalBlockRanges(stateAt(tableCursor));
    expect(fixture.slice(table.from, table.to)).toContain('| --- | --- |');

    const codeCursor = fixture.indexOf('source =');
    const [code] = activeLogicalBlockRanges(stateAt(codeCursor));
    expect(fixture.slice(code.from, code.to)).toContain('```rust');
  });

  it('reveals every block crossed by a selection', () => {
    const from = fixture.indexOf('First');
    const to = fixture.indexOf('Parent') + 'Parent'.length;
    const ranges = activeLogicalBlockRanges(stateAt(from, to));

    expect(ranges.map((range) => fixture.slice(range.from, range.to))).toEqual([
      'First **paragraph** spans\ntwo source lines.',
      '- [x] Parent item',
    ]);
  });

  it('keeps a cursor at the visual end of a line in that line block', () => {
    const listSource = '- [x] Parent item';
    const listEnd = fixture.indexOf(listSource) + listSource.length;
    const [listItem] = activeLogicalBlockRanges(stateAt(listEnd));
    expect(fixture.slice(listItem.from, listItem.to)).toBe(listSource);

    const firstParagraphLine = 'First **paragraph** spans';
    const paragraphLineEnd =
      fixture.indexOf(firstParagraphLine) + firstParagraphLine.length;
    const [paragraph] = activeLogicalBlockRanges(stateAt(paragraphLineEnd));
    expect(fixture.slice(paragraph.from, paragraph.to)).toBe(
      'First **paragraph** spans\ntwo source lines.',
    );
  });

  it('supports multiple selections without merging unrelated blocks', () => {
    const heading = fixture.indexOf('Architecture');
    const code = fixture.indexOf('source =');
    const state = EditorState.create({
      doc: fixture,
      selection: EditorSelection.create([
        EditorSelection.cursor(heading),
        EditorSelection.cursor(code),
      ]),
      extensions: [
        EditorState.allowMultipleSelections.of(true),
        markdown({ base: markdownLanguage }),
      ],
    });

    expect(
      activeLogicalBlockRanges(state).map((range) =>
        fixture.slice(range.from, range.to),
      ),
    ).toEqual(['# Architecture', '```rust\nlet source = true;\n```']);
  });
});
