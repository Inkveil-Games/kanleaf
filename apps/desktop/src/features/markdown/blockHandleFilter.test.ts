import { Editor, parserCtx, rootCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import type { Node } from '@milkdown/kit/prose/model';
import { afterEach, describe, expect, it } from 'vitest';
import { blockHandleFilter } from './blockHandleFilter';
import { InternalLinkController } from './internalLinkController';
import { milkdownInternalLinks } from './milkdownInternalLinks';

const editors: Editor[] = [];

async function parse(markdown: string) {
  const editor = await Editor.make()
    .config((ctx) => ctx.set(rootCtx, document.createElement('div')))
    .use(commonmark)
    .use(milkdownInternalLinks(new InternalLinkController()))
    .create();
  editors.push(editor);
  let doc: Node | null = null;
  editor.action((ctx) => {
    doc = ctx.get(parserCtx)(markdown);
  });
  if (!doc) throw new Error('Markdown did not parse');
  return doc as Node;
}

describe('blockHandleFilter', () => {
  afterEach(async () => {
    await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
  });

  it('climbs from a link atom to the list item like hovered text does', async () => {
    const doc = await parse(
      'Intro [[a]]\n\n- [[b]] first\n\n  second [[c]]\n- next\n',
    );
    const filter = blockHandleFilter(() => true);
    const accepted: string[] = [];
    doc.descendants((node, pos) => {
      if (node.isText) return;
      const $pos = doc.resolve(pos);
      const label = `${node.type.name} in ${$pos.parent.type.name}[${$pos.index()}]`;
      if (filter($pos, node)) accepted.push(label);
    });

    expect(accepted).toEqual([
      'paragraph in doc[0]',
      'bullet_list in doc[1]',
      'list_item in bullet_list[0]',
      'paragraph in list_item[1]',
      'list_item in bullet_list[1]',
    ]);
  });

  it('keeps the wrapped filter authoritative', async () => {
    const doc = await parse('Plain paragraph\n');
    const paragraph = doc.firstChild;
    if (!paragraph) throw new Error('Paragraph did not parse');

    expect(blockHandleFilter(() => false)(doc.resolve(0), paragraph)).toBe(
      false,
    );
  });
});
