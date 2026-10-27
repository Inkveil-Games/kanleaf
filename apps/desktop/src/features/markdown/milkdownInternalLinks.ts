import { InputRule } from '@milkdown/kit/prose/inputrules';
import { Plugin } from '@milkdown/kit/prose/state';
import { $inputRule, $node, $prose, $remark, $view } from '@milkdown/kit/utils';
import {
  INTERNAL_LINK_TRIGGER,
  type InternalLinkController,
} from './internalLinkController';
import {
  parseInternalLink,
  remarkInternalLinks,
  internalLinkLabel,
} from './internalLinks';

// Lucide "pencil", inlined because node views are built outside React. The
// paths are drawn twice: a wide halo stroke underneath keeps the icon legible
// over text without a filled button background.
const PENCIL_PATHS =
  '<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/><path d="m15 5 4 4"/>';
const PENCIL_ICON = `<svg aria-hidden="true" width="16" height="16" viewBox="-2 -2 28 28" fill="none" stroke-linecap="round" stroke-linejoin="round"><g class="internal-link-edit-halo" stroke-width="6">${PENCIL_PATHS}</g><g stroke="currentColor" stroke-width="2">${PENCIL_PATHS}</g></svg>`;

const NAVIGATION_KEYS = new Set([
  'ArrowDown',
  'ArrowUp',
  'Enter',
  'Tab',
  'Escape',
]);

export function milkdownInternalLinks(controller: InternalLinkController) {
  const remark = $remark('kanleafInternalLinks', () => remarkInternalLinks);

  const node = $node('internal_link', () => ({
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    attrs: { raw: { default: '' } },
    parseDOM: [
      {
        tag: 'span[data-internal-link]',
        getAttrs: (dom) => ({
          raw: (dom as HTMLElement).dataset.internalLink ?? '',
        }),
      },
    ],
    toDOM: (current) => [
      'span',
      { 'data-internal-link': current.attrs.raw as string },
      current.attrs.raw as string,
    ],
    parseMarkdown: {
      match: (current) => current.type === 'internalLink',
      runner: (state, current, type) => {
        state.addNode(type, { raw: current.value as string });
      },
    },
    toMarkdown: {
      match: (current) => current.type.name === 'internal_link',
      // An inline html node is written verbatim, so `[[…]]` is not escaped
      // into `\[\[…]]` the way a text node would be.
      runner: (state, current) => {
        state.addNode('html', undefined, current.attrs.raw as string);
      },
    },
  }));

  const view = $view(node, (ctx) => (current, editorView, getPos) => {
    const raw = current.attrs.raw as string;
    const dom = document.createElement('span');
    dom.className = 'internal-link-chip';
    const link = document.createElement('span');
    link.className = 'internal-link';
    link.setAttribute('role', 'link');
    link.dataset.internalLink = raw;
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'internal-link-edit';
    edit.tabIndex = -1;
    edit.setAttribute('aria-label', 'Edit link');
    edit.title = 'Edit link';
    edit.innerHTML = PENCIL_ICON;
    dom.append(link, edit);
    const render = () => {
      const parts = parseInternalLink(raw);
      const entry = parts
        ? (controller.index?.resolve(parts.target) ?? null)
        : null;
      link.textContent = parts ? internalLinkLabel(parts, entry) : raw;
      link.dataset.broken = String(Boolean(controller.index && !entry));
      link.title = entry
        ? `${raw} — Ctrl or Cmd+click to edit`
        : `${raw} — no page or Task with this name`;
    };
    render();
    const unsubscribe = controller.subscribe(render);
    const openEditor = () => {
      if (getPos() === undefined || !editorView.editable) return;
      const rect = link.getBoundingClientRect();
      controller.onEdit({
        raw,
        rect: { left: rect.left, top: rect.top, bottom: rect.bottom },
        dismiss: () => editorView.focus(),
        setRaw: (next) => {
          const at = getPos();
          if (at === undefined) return;
          const { state } = editorView;
          const tr =
            next === null
              ? state.tr.replaceWith(
                  at,
                  at + current.nodeSize,
                  state.schema.text(link.textContent || raw),
                )
              : state.tr.setNodeMarkup(at, node.type(ctx), { raw: next });
          editorView.dispatch(tr);
          editorView.focus();
        },
      });
    };
    // A click follows the link; Ctrl/Cmd+click or the hover pencil edits it.
    link.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) openEditor();
      else controller.onOpen(raw);
    });
    edit.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      openEditor();
    });
    return {
      dom,
      ignoreMutation: () => true,
      destroy: unsubscribe,
    };
  });

  const typedLink = $inputRule(
    (ctx) =>
      new InputRule(/\[\[[^[\]\n]+\]\]$/, (state, match, start, end) =>
        parseInternalLink(match[0])
          ? state.tr.replaceWith(
              start,
              end,
              node.type(ctx).create({ raw: match[0] }),
            )
          : null,
      ),
  );

  const trigger = $prose(
    (ctx) =>
      new Plugin({
        view: () => ({
          update: (editorView) => {
            const { selection } = editorView.state;
            const $from = selection.$from;
            if (!selection.empty || $from.parent.type.spec.code) {
              controller.onTrigger(null);
              return;
            }
            const before = $from.parent.textBetween(
              Math.max(0, $from.parentOffset - 120),
              $from.parentOffset,
              undefined,
              '￼',
            );
            const match = INTERNAL_LINK_TRIGGER.exec(before);
            if (!match) {
              controller.onTrigger(null);
              return;
            }
            const from = $from.pos - match[0].length;
            const coords = editorView.coordsAtPos($from.pos);
            controller.onTrigger({
              from,
              query: match[1] ?? '',
              rect: {
                left: coords.left,
                top: coords.top,
                bottom: coords.bottom,
              },
              insert: (target) => {
                const { state } = editorView;
                const to = state.selection.from;
                const closes =
                  state.doc.textBetween(
                    to,
                    Math.min(to + 2, state.doc.content.size),
                  ) === ']]';
                const tr = state.tr.replaceWith(
                  from,
                  closes ? to + 2 : to,
                  node.type(ctx).create({ raw: `[[${target}]]` }),
                );
                editorView.dispatch(tr.scrollIntoView());
                editorView.focus();
              },
            });
          },
          destroy: () => controller.onTrigger(null),
        }),
        props: {
          handleKeyDown: (_view, event) =>
            NAVIGATION_KEYS.has(event.key) && controller.onKey(event.key),
        },
      }),
  );

  return [remark, node, view, typedLink, trigger].flat();
}
