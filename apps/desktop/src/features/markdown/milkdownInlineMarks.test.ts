import { Schema, type Node } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { EditorView } from '@milkdown/kit/prose/view';
import { afterEach, describe, expect, it } from 'vitest';
import { createInlineMarksPlugin } from './milkdownInlineMarks';

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*', toDOM: () => ['p', 0] },
    text: {},
  },
  marks: {
    strong: { attrs: { marker: { default: '*' } }, toDOM: () => ['strong', 0] },
    emphasis: { attrs: { marker: { default: '_' } }, toDOM: () => ['em', 0] },
    strikethrough: { toDOM: () => ['del', 0] },
    inlineCode: { inclusive: false, code: true, toDOM: () => ['code', 0] },
    link: {
      attrs: { href: {} },
      inclusive: false,
      toDOM: (mark) => ['a', { href: mark.attrs.href as string }, 0],
    },
  },
});

const TAGS: Record<string, string> = {
  inlineCode: 'code',
  strong: 'b',
  emphasis: 'i',
  strikethrough: 's',
};

const views: EditorView[] = [];
afterEach(() => views.splice(0).forEach((view) => view.destroy()));

function paragraph(...parts: (string | [string, string])[]) {
  return schema.node(
    'doc',
    null,
    schema.node(
      'paragraph',
      null,
      parts
        .filter((part) => part !== '')
        .map((part) =>
          typeof part === 'string'
            ? schema.text(part)
            : schema.text(part[1], [schema.marks[part[0]].create()]),
        ),
    ),
  );
}

function editor(doc: Node, caret: number) {
  const view = new EditorView(document.createElement('div'), {
    state: EditorState.create({
      doc,
      selection: TextSelection.create(doc, caret),
      plugins: [createInlineMarksPlugin()],
    }),
  });
  views.push(view);
  return view;
}

function type(view: EditorView, text: string) {
  for (const char of text) {
    const { from, to } = view.state.selection;
    const handled = view.someProp('handleTextInput', (handler) =>
      handler(view, from, to, char, () => view.state.tr.insertText(char)),
    );
    if (!handled) view.dispatch(view.state.tr.insertText(char, from, to));
  }
}

function moveTo(view: EditorView, pos: number) {
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)),
  );
}

function press(view: EditorView, key: string) {
  return view.someProp('handleKeyDown', (handler) =>
    handler(view, new KeyboardEvent('keydown', { key })),
  );
}

/** Writes marks as tags so literal delimiters stay distinguishable. */
function render(view: EditorView) {
  let out = '';
  view.state.doc.firstChild?.forEach((node) => {
    let text = node.text ?? '';
    for (const mark of node.marks)
      text =
        mark.type.name === 'link'
          ? `<a ${mark.attrs.href as string}>${text}</a>`
          : `<${TAGS[mark.type.name]}>${text}</${TAGS[mark.type.name]}>`;
    out += text;
  });
  return out;
}

/** Types an empty wrapper, then content between its delimiters. */
function fill(prefix: string, wrapper: string, content: string) {
  const view = editor(paragraph(prefix), 1 + prefix.length);
  type(view, wrapper);
  moveTo(view, 1 + prefix.length + wrapper.length / 2);
  type(view, content);
  return view;
}

describe('inline marks plugin', () => {
  it('keeps typing inside inline code started from a stored mark', () => {
    const view = editor(paragraph('Use '), 5);
    view.dispatch(
      view.state.tr.setStoredMarks([schema.marks.inlineCode.create()]),
    );
    type(view, 'match()');
    expect(render(view)).toBe('Use <code>match()</code>');
  });

  it('formats content typed between a complete wrapper', () => {
    expect(render(fill('x ', '``', 'fn()'))).toBe('x <code>fn()</code>');
    expect(render(fill('', '``', 'a'))).toBe('<code>a</code>');
    expect(render(fill('x ', '****', 'bold'))).toBe('x <b>bold</b>');
    expect(render(fill('x ', '____', 'bold'))).toBe('x <b>bold</b>');
    expect(render(fill('x ', '~~~~', 'gone'))).toBe('x <s>gone</s>');
    expect(render(fill('x ', '__', 'very'))).toBe('x <i>very</i>');

    const star = fill('x ', '**', 'much');
    expect(render(star)).toBe('x <i>much</i>');
    expect(star.state.doc.firstChild?.child(1).marks[0].attrs.marker).toBe('*');
  });

  it('keeps wrappers literal until different content goes inside', () => {
    const view = editor(paragraph('x '), 3);
    type(view, '``');
    expect(render(view)).toBe('x ``');

    expect(render(fill('x ', '**', '*'))).toBe('x ***');
    expect(render(fill('x ', '``', ' '))).toBe('x ` `');
    expect(render(fill('snake', '__', 'x'))).toBe('snake_x_');
  });

  it('leaves Markdown typed the long way to the input rules', () => {
    const view = editor(paragraph('x '), 3);
    type(view, '`a` *b* ~~c~~');
    expect(render(view)).toBe('x `a` *b* ~~c~~');
  });

  it('leaves a mark by typing its delimiter, swallowing a doubled one', () => {
    const view = fill('x ', '****', 'b');
    type(view, '** y');
    expect(render(view)).toBe('x <b>b</b> y');

    const code = fill('x ', '``', 'c');
    type(code, '` z');
    expect(render(code)).toBe('x <code>c</code> z');
  });

  it('turns [text](url) into a link when the parenthesis closes', () => {
    const view = editor(paragraph('see '), 5);
    type(view, '[docs](https://x.test) and ![img](a.png)');
    expect(render(view)).toBe(
      'see <a https://x.test>docs</a> and ![img](a.png)',
    );
  });

  it('turns a filled-in link into a link once the caret leaves it', () => {
    const view = editor(paragraph('see [docs](u) end'), 9);
    moveTo(view, 12);
    expect(render(view)).toBe('see [docs](u) end');
    moveTo(view, 17);
    expect(render(view)).toBe('see <a u>docs</a> end');
  });

  it('keeps list and divider syntax literal', () => {
    const list = editor(paragraph(''), 1);
    type(list, '* item');
    expect(render(list)).toBe('* item');

    const divider = editor(paragraph(''), 1);
    type(divider, '***');
    expect(render(divider)).toBe('***');
  });

  it('exits inline code with ArrowRight at the end of a line', () => {
    const view = editor(paragraph('a ', ['inlineCode', 'code']), 7);
    // A click or jump to the end lands outside the code.
    moveTo(view, 7);
    type(view, 'x');
    expect(render(view)).toBe('a <code>code</code>x');
  });

  it('crosses a code edge in two ArrowLeft steps: enter, then move', () => {
    const view = editor(paragraph(['inlineCode', 'ab'], ' c'), 4);
    expect(press(view, 'ArrowLeft')).toBe(true); // to the edge, outside
    type(view, '!');
    expect(render(view)).toBe('<code>ab</code>! c');
    expect(press(view, 'ArrowLeft')).toBe(true); // back over `!`, outside
    expect(press(view, 'ArrowLeft')).toBe(true); // switch inside
    type(view, '?');
    expect(render(view)).toBe('<code>ab?</code>! c');
  });

  it('draws the caret on the side of the code edge it is on', () => {
    const view = editor(paragraph('a ', ['inlineCode', 'code']), 6);
    const drawn = () => view.dom.querySelector('.inline-mark-caret');
    expect(press(view, 'ArrowRight')).toBe(true); // to the edge, inside
    expect(drawn()).toBeNull();
    expect(press(view, 'ArrowRight')).toBe(true); // switch outside
    expect(drawn()?.closest('code')).toBeNull();

    const back = editor(paragraph('a ', ['inlineCode', 'code']), 2);
    expect(press(back, 'ArrowRight')).toBe(true); // to the start, outside
    expect(
      back.dom.querySelector('.inline-mark-caret')?.closest('code'),
    ).toBeNull();
    expect(press(back, 'ArrowRight')).toBe(true); // switch inside
    expect(
      back.dom.querySelector('.inline-mark-caret')?.closest('code'),
    ).not.toBeNull();

    // Code at the very start of a line still shows the outside caret.
    const start = editor(paragraph(['inlineCode', 'code'], ' b'), 1);
    expect(start.dom.querySelector('.inline-mark-caret')).not.toBeNull();
    expect(
      start.dom.querySelector('.inline-mark-caret')?.closest('code'),
    ).toBeNull();
  });

  it('switches sides before moving with ArrowRight', () => {
    const view = editor(paragraph(['inlineCode', 'ab'], ' c'), 2);
    expect(press(view, 'ArrowRight')).toBe(true); // move to the edge, inside
    type(view, 'z');
    expect(render(view)).toBe('<code>abz</code> c');
    expect(press(view, 'ArrowRight')).toBe(true); // switch outside
    expect(view.state.selection.from).toBe(4);
    type(view, '.');
    expect(render(view)).toBe('<code>abz</code>. c');
  });
});
