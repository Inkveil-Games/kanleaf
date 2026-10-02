import type { Ctx } from '@milkdown/kit/ctx';
import type { EditorState } from '@milkdown/kit/prose/state';
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core';
import { lift, toggleMark } from '@milkdown/kit/prose/commands';
import { toggleLinkCommand } from '@milkdown/kit/component/link-tooltip';
import { imageBlockSchema } from '@milkdown/kit/component/image-block';
import {
  addBlockTypeCommand,
  blockquoteSchema,
  bulletListSchema,
  codeBlockSchema,
  headingSchema,
  hrSchema,
  listItemSchema,
  liftListItemCommand,
  inlineCodeSchema,
  orderedListSchema,
  paragraphSchema,
  setBlockTypeCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  wrapInBlockTypeCommand,
} from '@milkdown/kit/preset/commonmark';
import {
  createTable,
  toggleStrikethroughCommand,
} from '@milkdown/kit/preset/gfm';
import type { EditorAction, EditorToolbarState } from './MarkdownEditorToolbar';

export function editorToolbarState(state: EditorState): EditorToolbarState {
  const { $from, from, to } = state.selection;
  const marks = state.storedMarks ?? $from.marks();
  const markNames: Record<string, string> = {
    strong: 'bold',
    emphasis: 'italic',
    strikethrough: 'strike',
    inlineCode: 'inlineCode',
    link: 'link',
  };
  const active = Object.entries(markNames)
    .filter(([name]) => {
      const type = state.schema.marks[name];
      return (
        type &&
        (marks.some((mark) => mark.type === type) ||
          state.doc.rangeHasMark(from, to, type))
      );
    })
    .map(([, action]) => action);
  let style =
    $from.parent.type.name === 'heading'
      ? `h${$from.parent.attrs.level}`
      : $from.parent.type.spec.code
        ? 'codeBlock'
        : 'paragraph';
  let listAction: string | undefined;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === 'blockquote') style = 'quote';
    // A checklist is a list_item inside a bullet/ordered list. Only the
    // innermost list's semantic type is active, not its storage ancestors.
    if (!listAction) {
      if (node.type.name === 'list_item' && node.attrs.checked != null)
        listAction = 'checklist';
      else if (node.type.name === 'bullet_list') listAction = 'bullet';
      else if (node.type.name === 'ordered_list') listAction = 'ordered';
    }
  }
  if (listAction) active.push(listAction);
  return { style, active };
}

export function applyTextStyle(ctx: Ctx, style: string) {
  const commands = ctx.get(commandsCtx);
  const view = ctx.get(editorViewCtx);
  if (style !== 'quote' && editorToolbarState(view.state).style === 'quote') {
    lift(view.state, view.dispatch);
  }
  if (style === 'quote')
    commands.call(wrapInBlockTypeCommand.key, {
      nodeType: blockquoteSchema.type(ctx),
    });
  else
    commands.call(setBlockTypeCommand.key, {
      nodeType:
        style === 'codeBlock'
          ? codeBlockSchema.type(ctx)
          : style.startsWith('h')
            ? headingSchema.type(ctx)
            : paragraphSchema.type(ctx),
      attrs: style.startsWith('h')
        ? { level: Number(style.slice(1)) }
        : undefined,
    });
  ctx.get(editorViewCtx).focus();
}

export function applyEditorAction(ctx: Ctx, action: EditorAction) {
  const commands = ctx.get(commandsCtx);
  const view = ctx.get(editorViewCtx);
  switch (action) {
    case 'bold':
      commands.call(toggleStrongCommand.key);
      break;
    case 'italic':
      commands.call(toggleEmphasisCommand.key);
      break;
    case 'strike':
      commands.call(toggleStrikethroughCommand.key);
      break;
    case 'inlineCode':
      if (view.state.selection.empty)
        toggleMark(inlineCodeSchema.type(ctx))(view.state, view.dispatch);
      else commands.call(toggleInlineCodeCommand.key);
      break;
    case 'link':
      commands.call(toggleLinkCommand.key);
      break;
    case 'bullet':
      if (editorToolbarState(view.state).active.includes('bullet')) {
        commands.call(liftListItemCommand.key);
        break;
      }
      commands.call(wrapInBlockTypeCommand.key, {
        nodeType: bulletListSchema.type(ctx),
      });
      break;
    case 'ordered':
      if (editorToolbarState(view.state).active.includes('ordered')) {
        commands.call(liftListItemCommand.key);
        break;
      }
      commands.call(wrapInBlockTypeCommand.key, {
        nodeType: orderedListSchema.type(ctx),
      });
      break;
    case 'checklist':
      if (editorToolbarState(view.state).active.includes('checklist')) {
        commands.call(liftListItemCommand.key);
        break;
      }
      commands.call(wrapInBlockTypeCommand.key, {
        nodeType: listItemSchema.type(ctx),
        attrs: { checked: false },
      });
      break;
    case 'image':
      commands.call(addBlockTypeCommand.key, {
        nodeType: imageBlockSchema.type(ctx),
      });
      break;
    case 'table':
      commands.call(addBlockTypeCommand.key, {
        nodeType: createTable(ctx, 3, 3),
      });
      break;
    case 'codeBlock':
      commands.call(setBlockTypeCommand.key, {
        nodeType: codeBlockSchema.type(ctx),
      });
      break;
    case 'math':
      commands.call(addBlockTypeCommand.key, {
        nodeType: codeBlockSchema.type(ctx),
        attrs: { language: 'LaTeX' },
      });
      break;
    case 'divider':
      commands.call(addBlockTypeCommand.key, { nodeType: hrSchema.type(ctx) });
      break;
  }
  view.focus();
}
