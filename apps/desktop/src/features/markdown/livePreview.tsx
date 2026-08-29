import { syntaxTree } from '@codemirror/language';
import {
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from '@codemirror/view';
import { createRoot, type Root } from 'react-dom/client';
import { MarkdownPreview } from './MarkdownPreview';

export interface SourceRange {
  from: number;
  to: number;
}

type MarkdownNode = ReturnType<typeof syntaxTree>['topNode'];

const renderedBlockNames = new Set([
  'FencedCode',
  'CodeBlock',
  'Table',
  'HorizontalRule',
  'HTMLBlock',
  'SetextHeading1',
  'SetextHeading2',
]);
const leafBlockNames = new Set([
  ...renderedBlockNames,
  'Paragraph',
  'ATXHeading1',
  'ATXHeading2',
  'ATXHeading3',
  'ATXHeading4',
  'ATXHeading5',
  'ATXHeading6',
  'SetextHeading1',
  'SetextHeading2',
]);

export function activeLogicalBlockRanges(state: EditorState): SourceRange[] {
  const ranges: SourceRange[] = [];
  for (const selection of state.selection.ranges) {
    let position = selection.from;
    for (;;) {
      const block = logicalBlockAt(state, position);
      if (block) ranges.push({ from: block.from, to: block.to });
      if (position >= selection.to) break;
      const line = state.doc.lineAt(position);
      position = Math.min(selection.to, line.to + 1);
      if (position === line.from) break;
    }
  }
  return normalizeRanges(ranges);
}

export function markdownLivePreview(): Extension {
  return [
    livePreviewField,
    EditorView.atomicRanges.of(
      (view) => view.state.field(livePreviewField).atomic,
    ),
  ];
}

interface PreviewDecorations {
  decorations: DecorationSet;
  atomic: DecorationSet;
}

const livePreviewField = StateField.define<PreviewDecorations>({
  create: buildDecorations,
  update(value, transaction) {
    return transaction.docChanged || transaction.selection
      ? buildDecorations(transaction.state)
      : value;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value) => value.decorations),
});

function buildDecorations(state: EditorState) {
  const active = activeLogicalBlockRanges(state);
  const decorations: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (isInsideActiveBlock(node, active)) return false;

      if (renderedBlockNames.has(node.name)) {
        const source = state.doc.sliceString(node.from, node.to);
        const replacement = Decoration.replace({
          block: true,
          widget: new MarkdownBlockWidget(source, node.from, node.name),
        }).range(node.from, node.to);
        decorations.push(replacement);
        atomic.push(replacement);
        return false;
      }

      decorateNode(state, node, decorations);
      return undefined;
    },
  });

  return {
    decorations: Decoration.set(decorations, true),
    atomic: Decoration.set(atomic, true),
  };
}

function decorateNode(
  state: EditorState,
  node: { name: string; from: number; to: number },
  decorations: Range<Decoration>[],
) {
  const headingLevel = headingLevelFor(node.name);
  if (headingLevel) {
    const line = state.doc.lineAt(node.from);
    decorations.push(
      Decoration.line({
        class: `cm-live-heading-line cm-live-heading-${headingLevel}`,
      }).range(line.from),
    );
  }

  const markClass = inlineClassFor(node.name);
  if (markClass) {
    decorations.push(
      Decoration.mark({ class: markClass }).range(node.from, node.to),
    );
  }

  if (
    node.name === 'HeaderMark' ||
    node.name === 'EmphasisMark' ||
    node.name === 'StrikethroughMark' ||
    node.name === 'CodeMark' ||
    node.name === 'LinkMark' ||
    node.name === 'URL' ||
    node.name === 'QuoteMark' ||
    node.name === 'HTMLTag'
  ) {
    decorations.push(Decoration.replace({}).range(node.from, node.to));
    if (node.name === 'QuoteMark') {
      const line = state.doc.lineAt(node.from);
      decorations.push(
        Decoration.line({ class: 'cm-live-blockquote' }).range(line.from),
      );
    }
    return;
  }

  if (node.name === 'ListMark') {
    const rest = state.doc.sliceString(
      node.to,
      Math.min(state.doc.length, node.to + 5),
    );
    const task = /^\s+\[[ xX]\]/.test(rest);
    const source = state.doc.sliceString(node.from, node.to);
    decorations.push(
      Decoration.replace({
        widget: task ? undefined : new ListMarkerWidget(source),
      }).range(node.from, node.to),
    );
    return;
  }

  if (node.name === 'TaskMarker') {
    const source = state.doc.sliceString(node.from, node.to);
    decorations.push(
      Decoration.replace({
        widget: new TaskMarkerWidget(node.from, /[xX]/.test(source)),
      }).range(node.from, node.to),
    );
  }
}

function logicalBlockAt(
  state: EditorState,
  position: number,
): SourceRange | null {
  const direction = position === state.doc.length ? -1 : 1;
  let node: MarkdownNode | null = syntaxTree(state).resolveInner(
    position,
    direction,
  );
  let leaf: MarkdownNode | null = null;
  let listItem: MarkdownNode | null = null;
  while (node) {
    if (node.name === 'Blockquote') {
      return { from: node.from, to: node.to };
    }
    if (node.name === 'ListItem' && !listItem) listItem = node;
    if (leafBlockNames.has(node.name) && !leaf) leaf = node;
    node = node.parent;
  }
  if (listItem) {
    const line = state.doc.lineAt(position);
    return { from: line.from, to: line.to };
  }
  return leaf ? { from: leaf.from, to: leaf.to } : null;
}

function normalizeRanges(ranges: SourceRange[]) {
  const sorted = ranges
    .filter((range) => range.to >= range.from)
    .sort((left, right) => left.from - right.from || right.to - left.to);
  const normalized: SourceRange[] = [];
  for (const range of sorted) {
    const previous = normalized.at(-1);
    if (previous && previous.from <= range.from && previous.to >= range.to)
      continue;
    normalized.push(range);
  }
  return normalized;
}

function isInsideActiveBlock(
  node: { from: number; to: number },
  active: SourceRange[],
) {
  return active.some((range) => range.from <= node.from && range.to >= node.to);
}

function headingLevelFor(name: string) {
  const match = /^(?:ATX|Setext)Heading([1-6])$/.exec(name);
  return match ? Number(match[1]) : null;
}

function inlineClassFor(name: string) {
  if (name === 'StrongEmphasis') return 'cm-live-strong';
  if (name === 'Emphasis') return 'cm-live-emphasis';
  if (name === 'Strikethrough') return 'cm-live-strikethrough';
  if (name === 'InlineCode') return 'cm-live-inline-code';
  if (name === 'Link') return 'cm-live-link';
  return null;
}

const blockRoots = new WeakMap<HTMLElement, Root>();

class MarkdownBlockWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly from: number,
    private readonly kind: string,
  ) {
    super();
  }

  eq(other: MarkdownBlockWidget) {
    return (
      this.source === other.source &&
      this.from === other.from &&
      this.kind === other.kind
    );
  }

  toDOM(view: EditorView) {
    const element = document.createElement('div');
    element.className = 'cm-live-block-widget';
    element.dataset.blockKind = this.kind;
    const root = createRoot(element);
    root.render(<MarkdownPreview content={this.source} />);
    blockRoots.set(element, root);
    element.addEventListener('mousedown', (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest('a')) return;
      event.preventDefault();
      view.dispatch({
        selection: { anchor: Math.min(this.from, view.state.doc.length) },
        scrollIntoView: true,
      });
      view.focus();
    });
    return element;
  }

  destroy(element: HTMLElement) {
    const root = blockRoots.get(element);
    blockRoots.delete(element);
    if (root) queueMicrotask(() => root.unmount());
  }

  ignoreEvent() {
    return true;
  }
}

class ListMarkerWidget extends WidgetType {
  constructor(private readonly source: string) {
    super();
  }

  eq(other: ListMarkerWidget) {
    return this.source === other.source;
  }

  toDOM() {
    const marker = document.createElement('span');
    marker.className = 'cm-live-list-marker';
    marker.ariaHidden = 'true';
    marker.textContent = /^\d/.test(this.source) ? this.source : '•';
    return marker;
  }
}

class TaskMarkerWidget extends WidgetType {
  constructor(
    private readonly from: number,
    private readonly checked: boolean,
  ) {
    super();
  }

  eq(other: TaskMarkerWidget) {
    return this.from === other.from && this.checked === other.checked;
  }

  toDOM(view: EditorView) {
    const checkbox = document.createElement('input');
    checkbox.className = 'cm-live-task-marker';
    checkbox.type = 'checkbox';
    checkbox.checked = this.checked;
    checkbox.disabled = !view.state.facet(EditorView.editable);
    checkbox.setAttribute(
      'aria-label',
      this.checked ? 'Mark task incomplete' : 'Mark task complete',
    );
    checkbox.addEventListener('change', () => {
      view.dispatch({
        changes: {
          from: this.from + 1,
          to: this.from + 2,
          insert: checkbox.checked ? 'x' : ' ',
        },
      });
      view.focus();
    });
    return checkbox;
  }

  ignoreEvent() {
    return true;
  }
}
