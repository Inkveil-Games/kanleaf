import type { Mark, ResolvedPos } from '@milkdown/kit/prose/model';
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from '@milkdown/kit/prose/state';
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

/**
 * Typora-style editing for inline marks. Markdown wrappers stay literal until
 * content is typed between them: typing `a` into `` `|` `` gives inline code,
 * into `*|*` or `_|_` italic, `**|**` or `__|__` bold and `~~|~~`
 * strikethrough. A complete `[text](url)` becomes a link when the caret leaves
 * it. A mark edge has two caret sides, inside and outside: arrow keys cross an
 * edge in two steps (first switch sides, then move), clicks land outside, and
 * typing a mark's delimiter inside it leaves the mark.
 */

const INLINE_CODE = 'inlineCode';
const key = new PluginKey('kanleafInlineMarks');
const ARROW_META = 'kanleafInlineMarkArrow';

const isCode = (mark: Mark) => mark.type.name === INLINE_CODE;

const sameMarks = (left: readonly Mark[], right: readonly Mark[]) =>
  left.length === right.length && left.every((mark) => mark.isInSet(right));

const intersect = (left: readonly Mark[], right: readonly Mark[]) =>
  left.filter((mark) => mark.isInSet(right));

function edgeMarks($pos: ResolvedPos) {
  return {
    before: $pos.nodeBefore?.marks ?? [],
    after: $pos.nodeAfter?.marks ?? [],
  };
}

export function effectiveMarks(state: EditorState) {
  return state.storedMarks ?? state.selection.$from.marks();
}

function caret(state: EditorState) {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  return selection.$from.parent.inlineContent ? selection.$from : null;
}

function isLowSurrogate(text: string | undefined, index: number) {
  const code = text?.charCodeAt(index) ?? 0;
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Moves one character, choosing the caret side for the mark edge reached. */
function step(view: EditorView, direction: 1 | -1): boolean {
  const { state } = view;
  const $pos = caret(state);
  if (!$pos) return false;
  const { before, after } = edgeMarks($pos);
  const current = effectiveMarks(state);
  const target = direction === 1 ? after : before;

  // First press at an edge only switches sides.
  if (!sameMarks(current, target)) {
    view.dispatch(state.tr.setStoredMarks(target).setMeta(ARROW_META, true));
    return true;
  }

  const node = direction === 1 ? $pos.nodeAfter : $pos.nodeBefore;
  if (!node) return false;
  // Leave surrogate pairs and atoms to ProseMirror's own cursor motion.
  if (node.isText) {
    const text = node.text;
    const index = direction === 1 ? 0 : (text?.length ?? 0) - 1;
    if (
      isLowSurrogate(text, direction === 1 ? index + 1 : index) ||
      (text?.length ?? 0) === 0
    )
      return false;
  } else return false;

  const next = state.doc.resolve($pos.pos + direction);
  const tr = state.tr
    .setSelection(TextSelection.create(state.doc, next.pos))
    .setMeta(ARROW_META, true);
  const reached = edgeMarks(next);
  // Arriving at an edge keeps the caret on the side it came from.
  if (!sameMarks(reached.before, reached.after))
    tr.setStoredMarks(direction === 1 ? reached.before : reached.after);
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** Wrappers checked longest first so `**` wins over `*`. */
const WRAPPERS: { delimiter: string; mark: string; inWords: boolean }[] = [
  { delimiter: '**', mark: 'strong', inWords: true },
  { delimiter: '__', mark: 'strong', inWords: false },
  { delimiter: '~~', mark: 'strikethrough', inWords: true },
  { delimiter: '`', mark: INLINE_CODE, inWords: true },
  { delimiter: '*', mark: 'emphasis', inWords: true },
  { delimiter: '_', mark: 'emphasis', inWords: false },
];

/** The delimiter character that leaves a mark when typed inside it. */
function closesWith(mark: Mark) {
  if (mark.type.name === 'strikethrough') return '~';
  if (mark.type.name === 'strong' || mark.type.name === 'emphasis')
    return typeof mark.attrs.marker === 'string' ? mark.attrs.marker : '*';
  return null;
}

const WORD_CHARACTER = /[\p{L}\p{N}]/u;
const LINK = /(^|[^!])\[([^[\]]*)\]\(([^()\s]*)\)/g;

/** Plain text of the caret's block on each side, with atoms as one char. */
function surroundings($pos: ResolvedPos) {
  const { parent, parentOffset } = $pos;
  return {
    before: parent.textBetween(0, parentOffset, '\n', '￼'),
    after: parent.textBetween(parentOffset, parent.content.size, '\n', '￼'),
  };
}

function markWithMarker(state: EditorState, name: string, marker: string) {
  const type = state.schema.marks[name];
  if (!type) return null;
  return type.create(type.spec.attrs?.marker ? { marker } : undefined);
}

/**
 * Handles one typed character. Returns a transaction when the character fills
 * an empty Markdown wrapper, leaves a mark through its delimiter, completes a
 * link or continues inline code, instead of being inserted as plain input.
 */
export function typedTextTransaction(
  state: EditorState,
  from: number,
  to: number,
  text: string,
): Transaction | null {
  if (from !== to || text.length !== 1) return null;
  const $pos = state.doc.resolve(from);
  if (!$pos.parent.inlineContent || $pos.parent.type.spec.code) return null;
  const marks = effectiveMarks(state);
  const pending = key.getState(state) as PluginState;

  // Typing the delimiter of an active mark leaves it; the second character of
  // a closing `**` or `~~` is swallowed as well.
  if (pending && pending.at === from && pending.char === text)
    return state.tr.setMeta(key, null);
  if (marks.some(isCode)) {
    const outside = marks.filter((mark) => !isCode(mark));
    if (text === '`') return state.tr.setStoredMarks(outside);
    // Inline code is not inclusive, so ProseMirror would drop it after one
    // character at the code's end; keep typed text inside until the user
    // leaves.
    return state.tr
      .replaceWith(from, to, state.schema.text(text, marks))
      .setStoredMarks(marks);
  }
  const closes = marks.find((mark) => closesWith(mark) === text);
  if (closes)
    return state.tr
      .setStoredMarks(marks.filter((mark) => mark !== closes))
      .setMeta(
        key,
        closes.type.name === 'emphasis'
          ? null
          : ({ char: text, at: from } satisfies PluginState),
      );

  const { before, after } = surroundings($pos);
  if (text === ')') return linkTransaction(state, before, from);

  // Content typed between a complete, empty wrapper becomes that mark. The
  // content must differ from the delimiter, and the wrapper must not be part
  // of a longer run such as `***` or a word like `snake__case`.
  if (!/\S/.test(text)) return null;
  const plainEdges =
    !$pos.nodeBefore?.marks.some(isCode) && !$pos.nodeAfter?.marks.some(isCode);
  if (!plainEdges) return null;
  for (const { delimiter, mark: name, inWords } of WRAPPERS) {
    const char = delimiter[0];
    if (text === char) continue;
    if (!before.endsWith(delimiter) || !after.startsWith(delimiter)) continue;
    const outer = before.at(-delimiter.length - 1);
    const beyond = after.at(delimiter.length);
    if (outer === char || beyond === char) continue;
    if (!inWords && outer && WORD_CHARACTER.test(outer)) continue;
    const mark = markWithMarker(state, name, char);
    if (!mark) return null;
    const next = [...marks.filter((item) => item.type !== mark.type), mark];
    const start = from - delimiter.length;
    const tr = state.tr.replaceWith(
      start,
      from + delimiter.length,
      state.schema.text(text, next),
    );
    return tr
      .setSelection(TextSelection.create(tr.doc, start + text.length))
      .setStoredMarks(next);
  }
  return null;
}

/** Turns `[text](url` into a link when its closing `)` is typed. */
function linkTransaction(
  state: EditorState,
  before: string,
  from: number,
): Transaction | null {
  const link = state.schema.marks.link;
  const match = new RegExp(`${LINK.source}$`).exec(`${before})`);
  if (!link || !match || !(match[2] || match[3])) return null;
  // The match includes the `)` being typed, which is not in the document.
  const start = from - (match[0].length - match[1].length - 1);
  const marks = effectiveMarks(state);
  return state.tr
    .replaceWith(
      start,
      from,
      state.schema.text(match[2] || match[3], [
        ...marks,
        link.create({ href: match[3] }),
      ]),
    )
    .setStoredMarks(marks);
}

/**
 * Converts a complete `[text](url)` the caret has just left. Returns null
 * while the caret is still inside it, so the URL can be finished first.
 */
function leftLinkTransaction(
  oldState: EditorState,
  state: EditorState,
): Transaction | null {
  const $old = caret(oldState);
  const link = state.schema.marks.link;
  if (!$old || !link) return null;
  const text = $old.parent.textBetween(0, $old.parent.content.size, '\n', '￼');
  const blockStart = $old.start();
  for (const match of text.matchAll(LINK)) {
    const from = (match.index ?? 0) + match[1].length;
    const to = (match.index ?? 0) + match[0].length;
    if ($old.parentOffset <= from || $old.parentOffset >= to) continue;
    if (!(match[2] || match[3])) return null;
    const head = state.selection.head;
    if (head > blockStart + from && head < blockStart + to) return null;
    const $from = state.doc.resolve(blockStart + from);
    if ($from.nodeAfter?.marks.some(isCode)) return null;
    return state.tr.replaceWith(
      blockStart + from,
      blockStart + to,
      state.schema.text(match[2] || match[3], [
        ...$from.marks(),
        link.create({ href: match[3] }),
      ]),
    );
  }
  return null;
}

type PluginState = { char: string; at: number } | null;

/**
 * At a code edge Chrome always draws the caret inside the <code> element and
 * normalizes any DOM selection next to a widget back there. When the caret is
 * logically on the other side (outside after the code, or inside before it),
 * the native caret is hidden and a drawn one marks the real side.
 */
function drawnCaret(state: EditorState) {
  const $pos = caret(state);
  if (!$pos) return null;
  const inside = effectiveMarks(state).some(isCode);
  const codeBefore = $pos.nodeBefore?.marks.find(isCode);
  const codeAfter = $pos.nodeAfter?.marks.find(isCode);
  // Inside at the end of code is where the native caret already is.
  if (codeBefore && !codeAfter && !inside) return { pos: $pos.pos, marks: [] };
  if (codeAfter && !codeBefore)
    return { pos: $pos.pos, marks: inside ? [codeAfter] : [] };
  return null;
}

function caretElement() {
  const element = document.createElement('span');
  element.className = 'inline-mark-caret';
  return element;
}

export function createInlineMarksPlugin() {
  return new Plugin<PluginState>({
    key,
    state: {
      init: () => null,
      apply: (tr, value) => {
        const meta = tr.getMeta(key) as PluginState | undefined;
        if (meta !== undefined) return meta;
        return tr.docChanged || tr.selectionSet ? null : value;
      },
    },
    appendTransaction(transactions, oldState, state) {
      const moved = transactions.some(
        (tr) => tr.selectionSet && !tr.docChanged && !tr.getMeta(ARROW_META),
      );
      const movedAtAll = transactions.some((tr) => tr.selectionSet);
      if (movedAtAll && !transactions.some((tr) => tr.docChanged)) {
        const link = leftLinkTransaction(oldState, state);
        if (link) return link;
      }
      // A click or other jump that lands on a mark edge puts the caret
      // outside the marks that end there, so clicking right of inline code at
      // the end of a line types plain text.
      if (!moved || state.storedMarks) return null;
      const $pos = caret(state);
      if (!$pos) return null;
      const { before, after } = edgeMarks($pos);
      if (sameMarks(before, after)) return null;
      const outside = intersect(before, after);
      return sameMarks(outside, $pos.marks())
        ? null
        : state.tr.setStoredMarks(outside);
    },
    props: {
      handleKeyDown(view, event) {
        if (
          event.isComposing ||
          event.shiftKey ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        )
          return false;
        if (event.key === 'ArrowRight') return step(view, 1);
        if (event.key === 'ArrowLeft') return step(view, -1);
        return false;
      },
      handleTextInput(view, from, to, text) {
        const tr = typedTextTransaction(view.state, from, to, text);
        if (!tr) return false;
        view.dispatch(tr);
        return true;
      },
      // The caret takes the inline code colour while typing goes into code.
      attributes(state): Record<string, string> {
        const classes = [
          effectiveMarks(state).some(isCode) && 'is-typing-inline-code',
          drawnCaret(state) && 'has-drawn-caret',
        ].filter(Boolean);
        return classes.length ? { class: classes.join(' ') } : {};
      },
      decorations(state) {
        const $pos = caret(state);
        if (!$pos) return null;
        const inside = effectiveMarks(state).some(isCode);
        const codeBefore = $pos.nodeBefore?.marks.find(isCode);
        const codeAfter = $pos.nodeAfter?.marks.find(isCode);

        if (inside && !codeBefore && !codeAfter) {
          // Inline code switched on from the toolbar has no text yet, so show
          // where it will be.
          return DecorationSet.create(state.doc, [
            Decoration.widget(
              $pos.pos,
              () => {
                const placeholder = document.createElement('code');
                placeholder.className = 'inline-code-pending';
                return placeholder;
              },
              { side: 1, key: 'inline-code-pending' },
            ),
          ]);
        }

        const drawn = drawnCaret(state);
        if (!drawn) return null;
        return DecorationSet.create(state.doc, [
          Decoration.widget(drawn.pos, caretElement, {
            // Outside sits after the code; inside sits at the code's start.
            side: drawn.marks.length ? 1 : -1,
            marks: drawn.marks,
            ignoreSelection: true,
            key: `inline-mark-caret-${drawn.marks.length}`,
          }),
        ]);
      },
    },
  });
}

export const inlineMarksPlugin = $prose(() => createInlineMarksPlugin());
