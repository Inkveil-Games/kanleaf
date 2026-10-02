import { nodeViewCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { codeBlockSchema } from '@milkdown/kit/preset/commonmark';
import { $view } from '@milkdown/kit/utils';
import type { Node } from '@milkdown/kit/prose/model';
import { TextSelection } from '@milkdown/kit/prose/state';
import type {
  EditorView,
  NodeView,
  NodeViewConstructor,
} from '@milkdown/kit/prose/view';
import katex from 'katex';
import { mathOptions } from './markdownExtensions';

// Crepe stores block math in its extended code_block schema, serialized as $$.
// Give that node a formula presentation while retaining upstream code views
// for actual fenced code. Both edit paths still update the same Markdown draft.
export const kanleafMathBlockView = $view(codeBlockSchema.node, (ctx) =>
  kanleafCodeBlockView(ctx),
);

function kanleafCodeBlockView(ctx: Ctx): NodeViewConstructor {
  return (...args) => {
    if (args[0].attrs.language?.toLowerCase() === 'latex')
      return new MathBlockView(args[0], args[1], args[2]);
    const upstreamView = ctx
      .get(nodeViewCtx)
      .find(([name]) => name === args[0].type.name)?.[1];
    if (!upstreamView) throw new Error('Code block view is not registered');
    return upstreamView(...args);
  };
}

class MathBlockView implements NodeView {
  readonly dom = document.createElement('div');
  private readonly preview = document.createElement('button');
  private readonly source = document.createElement('textarea');
  private readonly resizeObserver: ResizeObserver;

  constructor(
    private node: Node,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
  ) {
    this.dom.className = 'markdown-math-block';
    this.dom.contentEditable = 'false';
    this.preview.type = 'button';
    this.preview.className = 'markdown-math-preview';
    this.preview.setAttribute('aria-label', 'Edit math formula');
    this.preview.disabled = !view.editable;
    this.source.className = 'markdown-math-source ui-native-scrollbar';
    this.source.setAttribute('aria-label', 'LaTeX formula');
    this.source.spellcheck = false;
    this.source.hidden = true;
    this.source.rows = 2;
    let width = 0;
    this.resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width === width) return;
      width = entry.contentRect.width;
      this.resizeSource();
    });
    this.resizeObserver.observe(this.source);
    this.dom.append(this.source, this.preview);
    this.render();
    this.preview.addEventListener('click', () => {
      const position = this.getPos();
      if (!this.view.editable || position === undefined) return;
      this.view.dispatch(
        this.view.state.tr.setSelection(
          TextSelection.near(this.view.state.doc.resolve(position + 1)),
        ),
      );
      this.source.hidden = false;
      // ProseMirror makes non-content node views draggable. Native dragging
      // must be disabled while the nested textarea owns text selection.
      this.dom.draggable = false;
      this.resizeSource();
      this.source.focus();
    });
    this.source.addEventListener('input', () => {
      const position = this.getPos();
      if (!this.view.editable || position === undefined) return;
      this.view.dispatch(
        this.view.state.tr.insertText(
          this.source.value,
          position + 1,
          position + this.node.nodeSize - 1,
        ),
      );
    });
    this.source.addEventListener('blur', () => {
      this.source.hidden = true;
      this.dom.draggable = true;
    });
    this.source.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      this.source.hidden = true;
      this.preview.focus();
    });
  }

  update(node: Node) {
    if (
      node.type !== this.node.type ||
      node.attrs.language?.toLowerCase() !== 'latex'
    )
      return false;
    this.node = node;
    this.render();
    return true;
  }

  stopEvent(event: Event) {
    return (
      event.target instanceof globalThis.Node && this.dom.contains(event.target)
    );
  }

  ignoreMutation() {
    return true;
  }

  destroy() {
    this.resizeObserver.disconnect();
  }

  private resizeSource() {
    if (this.source.hidden) return;
    this.source.style.height = 'auto';
    this.source.style.height = `${this.source.scrollHeight + this.source.offsetHeight - this.source.clientHeight}px`;
  }

  private render() {
    if (this.source.value !== this.node.textContent)
      this.source.value = this.node.textContent;
    this.resizeSource();
    // KaTeX escapes input and disallows trusted HTML/URL commands.
    if (!this.node.textContent) {
      this.preview.textContent = 'Add a formula';
      return;
    }
    this.preview.innerHTML = katex.renderToString(this.node.textContent, {
      ...mathOptions,
      displayMode: true,
    });
  }
}
