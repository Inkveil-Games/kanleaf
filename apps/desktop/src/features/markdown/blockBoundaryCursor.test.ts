import {
  Editor,
  editorViewCtx,
  rootCtx,
  serializerCtx,
} from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { replaceAll } from '@milkdown/kit/utils';
import type { EditorView } from '@milkdown/kit/prose/view';
import { afterEach, describe, expect, it } from 'vitest';
import {
  blockBoundaryCursor,
  placeCursorAtBlockBoundary,
} from './blockBoundaryCursor';

const editors: Editor[] = [];

async function createEditor(markdown: string) {
  const root = document.createElement('div');
  document.body.append(root);
  const editor = await Editor.make()
    .config((ctx) => ctx.set(rootCtx, root))
    .use(commonmark)
    .use(blockBoundaryCursor)
    .create();
  editors.push(editor);
  editor.action(replaceAll(markdown));
  let view: EditorView | undefined;
  editor.action((ctx) => {
    view = ctx.get(editorViewCtx);
  });
  if (!view) throw new Error('Editor view is missing');
  const markdownOf = () => {
    let output = '';
    editor.action((ctx) => {
      output = ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc);
    });
    return output;
  };
  return { root, view, markdownOf };
}

function target(root: HTMLElement, label: string) {
  return root.querySelector<HTMLElement>(`[aria-label="${label}"]`);
}

describe('blockBoundaryCursor', () => {
  afterEach(async () => {
    await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
    document.body.replaceChildren();
  });

  it('inserts a paragraph above a code block that starts the document', async () => {
    const { root, view, markdownOf } = await createEditor(
      '```bash\nls\n```\n\nAfter\n',
    );
    const entry = target(root, 'Insert line before block');
    expect(entry).not.toBeNull();

    entry?.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, button: 0 }),
    );

    expect(view.state.doc.firstChild?.type.name).toBe('paragraph');
    expect(view.state.selection.from).toBe(1);
    expect(target(root, 'Insert line before block')).toBeNull();
    view.dispatch(view.state.tr.insertText('Intro'));
    expect(markdownOf()).toBe('Intro\n\n```bash\nls\n```\n\nAfter\n');
  });

  it('activates the entry target from the keyboard', async () => {
    const { root, view } = await createEditor('---\n\nAfter\n');

    target(root, 'Insert line before block')?.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }),
    );

    expect(view.state.doc.firstChild?.type.name).toBe('paragraph');
  });

  it('offers no entry target when the document starts with text', async () => {
    const { root } = await createEditor('Intro\n\n```bash\nls\n```\n');

    expect(target(root, 'Insert line before block')).toBeNull();
    expect(target(root, 'Continue after block')).not.toBeNull();
  });

  it('turns a click above the first block into a new first line', async () => {
    const { view } = await createEditor('```bash\nls\n```\n');
    const block = view.nodeDOM(0) as HTMLElement;
    block.getBoundingClientRect = () => new DOMRect(0, 40, 400, 60);
    const event = new MouseEvent('mousedown', { button: 0, clientY: 10 });
    Object.defineProperty(event, 'target', { value: view.dom });

    expect(placeCursorAtBlockBoundary(view, event)).toBe(true);
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph');
    expect(view.state.doc.child(1).type.name).toBe('code_block');
  });
});
