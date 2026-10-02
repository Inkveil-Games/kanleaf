import { Plugin, TextSelection } from '@milkdown/kit/prose/state';
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

const boundaryBlocks = new Set(['code_block', 'table', 'image-block', 'hr']);

// A view-only caret target works even when a node view consumes mouse events.
// It never adds trailing paragraphs just because a document was opened.
export const blockBoundaryCursor = $prose(
  () =>
    new Plugin({
      props: {
        decorations(state) {
          const targets: Decoration[] = [];
          state.doc.forEach((node, offset) => {
            if (!boundaryBlocks.has(node.type.name)) return;
            targets.push(
              Decoration.widget(
                offset + node.nodeSize,
                (view, getPos) => {
                  const target = document.createElement('div');
                  target.className = 'markdown-block-exit';
                  target.setAttribute('role', 'button');
                  target.setAttribute('aria-label', 'Continue after block');
                  target.tabIndex = 0;
                  target.textContent = '↵';
                  const activate = (event: Event) => {
                    const position = getPos();
                    if (position === undefined || !view.editable) return;
                    event.preventDefault();
                    event.stopPropagation();
                    insertParagraphAfterBlock(view, position);
                  };
                  target.addEventListener('mousedown', (event) => {
                    if (
                      event.button === 0 &&
                      !event.shiftKey &&
                      !event.ctrlKey &&
                      !event.metaKey &&
                      !event.altKey
                    )
                      activate(event);
                  });
                  target.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter' || event.key === ' ')
                      activate(event);
                  });
                  return target;
                },
                { key: `block-exit-${offset}`, side: 1, stopEvent: () => true },
              ),
            );
          });
          return DecorationSet.create(state.doc, targets);
        },
      },
    }),
);

// GapCursor cannot leave a textblock such as fenced code. Handle only the
// editor's empty space, never the nested editor, table cells, or drag handle.
export function placeCursorAfterBlock(view: EditorView, event: MouseEvent) {
  if (
    !view.editable ||
    event.target !== view.dom ||
    event.button !== 0 ||
    event.shiftKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  )
    return false;

  const { state } = view;
  let position: number | undefined;
  state.doc.forEach((node, offset, index) => {
    if (!boundaryBlocks.has(node.type.name)) return;
    const dom = view.nodeDOM(offset);
    if (
      !(dom instanceof HTMLElement) ||
      event.clientY < dom.getBoundingClientRect().bottom
    )
      return;
    const end = offset + node.nodeSize;
    const next = index + 1 < state.doc.childCount ? view.nodeDOM(end) : null;
    if (
      next instanceof HTMLElement &&
      event.clientY >= next.getBoundingClientRect().top
    )
      return;
    position = end;
  });
  if (position === undefined) return false;
  event.preventDefault();
  return insertParagraphAfterBlock(view, position);
}

function insertParagraphAfterBlock(view: EditorView, position: number) {
  const { state } = view;
  const paragraph = state.schema.nodes.paragraph;
  if (!paragraph) return false;
  const tr = state.tr;
  // Reuse an existing paragraph so repeated clicks never add empty lines.
  if (state.doc.nodeAt(position)?.type !== paragraph)
    tr.insert(position, paragraph.create());
  tr.setSelection(TextSelection.create(tr.doc, position + 1));
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}
