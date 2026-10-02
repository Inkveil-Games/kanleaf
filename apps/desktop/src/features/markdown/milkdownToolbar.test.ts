import { Crepe } from '@milkdown/crepe';
import { editorViewCtx, serializerCtx } from '@milkdown/kit/core';
import { TextSelection } from '@milkdown/kit/prose/state';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyEditorAction,
  applyTextStyle,
  editorToolbarState,
} from './milkdownToolbar';

const editors: Crepe[] = [];
async function editor(markdown: string) {
  const crepe = new Crepe({
    root: document.createElement('div'),
    defaultValue: markdown,
  });
  await crepe.create();
  editors.push(crepe);
  return crepe;
}
function markdown(crepe: Crepe) {
  return crepe.editor.action((ctx) =>
    ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc),
  );
}
afterEach(async () => {
  await Promise.all(editors.splice(0).map((crepe) => crepe.destroy()));
});

describe('shared editor toolbar commands', () => {
  it.each([
    ['- [ ] Open', 'Open', 'checklist'],
    ['- [x] Done', 'Done', 'checklist'],
    ['- Parent\n  - [ ] Nested', 'Nested', 'checklist'],
    ['1. Parent\n   - [ ] Nested', 'Nested', 'checklist'],
    ['- [ ] Parent\n  - Nested', 'Nested', 'bullet'],
    ['- Parent\n  1. Nested', 'Nested', 'ordered'],
  ])(
    'lights only the current list type in %s',
    async (source, text, expected) => {
      const crepe = await editor(source);
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.state.doc.descendants((node, pos) => {
          if (node.isText && node.text === text)
            view.dispatch(
              view.state.tr.setSelection(
                TextSelection.create(view.state.doc, pos),
              ),
            );
        });
        expect(editorToolbarState(view.state).active).toEqual([expected]);
      });
    },
  );
  it('turns a quote back into normal text without losing its content', async () => {
    const crepe = await editor('> A quote');
    crepe.editor.action((ctx) => applyTextStyle(ctx, 'paragraph'));
    expect(markdown(crepe)).toBe('A quote\n');
  });
  it.each(['bullet', 'ordered', 'checklist'] as const)(
    'toggles a %s list on and off',
    async (action) => {
      const crepe = await editor('A list item');
      crepe.editor.action((ctx) => applyEditorAction(ctx, action));
      expect(markdown(crepe)).toMatch(
        action === 'checklist'
          ? /\[ \] A list item/
          : action === 'ordered'
            ? /1\. A list item/
            : /[*-] A list item/,
      );
      crepe.editor.action((ctx) => applyEditorAction(ctx, action));
      expect(markdown(crepe)).toBe('A list item\n');
    },
  );
  it('enables inline code at a caret for subsequent typing', async () => {
    const crepe = await editor('Text');
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)),
      );
      applyEditorAction(ctx, 'inlineCode');
      expect(editorToolbarState(view.state).active).toContain('inlineCode');
      view.dispatch(view.state.tr.insertText('code'));
    });
    expect(markdown(crepe)).toContain('`code`Text');
  });
});
