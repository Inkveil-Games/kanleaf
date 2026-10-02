import { Editor, parserCtx, rootCtx, serializerCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeMilkdownImageTitles } from './milkdownMarkdown';
import { Crepe } from '@milkdown/crepe';
import { mathOptions } from './markdownExtensions';

const editors: Editor[] = [];

async function roundTrip(markdown: string) {
  const root = document.createElement('div');
  const editor = await Editor.make()
    .config((ctx) => ctx.set(rootCtx, root))
    .use(commonmark)
    .use(gfm)
    .use(normalizeMilkdownImageTitles)
    .create();
  editors.push(editor);
  let output = '';
  editor.action((ctx) => {
    output = ctx.get(serializerCtx)(ctx.get(parserCtx)(markdown));
  });
  return output;
}

describe('Milkdown Markdown round trips', () => {
  it('preserves math, Mermaid and literal punctuation through the actual Crepe schema', async () => {
    const crepe = new Crepe({
      root: document.createElement('div'),
      defaultValue: '',
      features: { [Crepe.Feature.Latex]: true },
      featureConfigs: { [Crepe.Feature.Latex]: { katexOptions: mathOptions } },
    });
    await crepe.create();
    editors.push(crepe.editor);
    const source =
      '$\\Gamma(n)$\n\n$$\n\\int_0^\\infty x^2 dx\n$$\n\n```mermaid\ngraph LR\nA[Start] --> B[Done]\n\n```\n\n"Quote" -- isn\'t ...';
    let output = '';
    crepe.editor.action((ctx) => {
      output = ctx.get(serializerCtx)(ctx.get(parserCtx)(source));
    });
    expect(output).toContain('$\\Gamma(n)$');
    expect(output).toContain('$$\n\\int_0^\\infty x^2 dx\n$$');
    expect(output).toContain(
      '```mermaid\ngraph LR\nA[Start] --> B[Done]\n\n```',
    );
    expect(output).toContain('"Quote" -- isn\'t ...');
  });
  afterEach(async () => {
    await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
  });

  it('preserves the supported CommonMark, GFM, table, checklist and asset semantics', async () => {
    const output = await roundTrip(`# Heading

Normal **bold**, *italic* and ~~strike~~.

## Second heading

- unordered
- list

1. ordered
2. list

- [ ] open
- [x] done

> quote

\`inline code\`

\`\`\`ts
const value = true;
\`\`\`

| A | B |
| - | - |
| 1 | 2 |

![image](kanleaf-asset://images/550e8400-e29b-41d4-a716-446655440000.png)
`);

    expect(output).toContain('# Heading');
    expect(output).toContain('**bold**');
    expect(output).toContain('*italic*');
    expect(output).toContain('~~strike~~');
    expect(output).toMatch(/[*-] \[ \] open/);
    expect(output).toMatch(/[*-] \[x\] done/);
    expect(output).toContain('const value = true;');
    expect(output).toContain('| A');
    expect(output).toContain(
      'kanleaf-asset://images/550e8400-e29b-41d4-a716-446655440000.png',
    );
  });

  it('preserves Vietnamese and Unicode content', async () => {
    const output = await roundTrip(`# Thiết kế Kanleaf

Đây là nội dung tiếng Việt.

- [ ] Hoàn thành editor
- [x] Chuẩn hoá vault

**Đậm**, *nghiêng*, và \`code\`.
`);

    expect(output).toContain('Thiết kế Kanleaf');
    expect(output).toContain('Đây là nội dung tiếng Việt.');
    expect(output).toContain('Hoàn thành editor');
    expect(output).toContain('Chuẩn hoá vault');
    expect(output).toContain('**Đậm**');
  });

  it('preserves HTML-looking text in fenced code without treating it as raw HTML', async () => {
    const output = await roundTrip(`\`\`\`mermaid
Note right of John: a long<br/>line
\`\`\`
`);

    expect(output).toContain('a long<br/>line');
  });

  it('preserves an explicit HTML line break outside fenced code', async () => {
    const output = await roundTrip('Before  \\nAfter\\n\\n> <br />\\n');

    expect(output).toContain('<br />');
  });
});
