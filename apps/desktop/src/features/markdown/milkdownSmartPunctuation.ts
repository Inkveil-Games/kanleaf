import { Plugin } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import { punctuationReplacements } from './smartPunctuation';

// Decorations change presentation only. ProseMirror text, clipboard data and
// the Markdown serializer continue to carry the user's original punctuation.
export const smartPunctuationPlugin = $prose(
  () =>
    new Plugin({
      props: {
        decorations(state) {
          const decorations: Decoration[] = [];
          state.doc.descendants((node, position, parent) => {
            if (node.type.spec.code) return false;
            if (
              !node.isText ||
              !node.text ||
              parent?.type.spec.code ||
              node.marks.some((mark) => mark.type.name === 'inlineCode')
            )
              return;
            for (const item of punctuationReplacements(node.text)) {
              const from = position + item.start;
              const to = position + item.end;
              // Reveal literal characters near the caret for predictable editing.
              if (state.selection.from <= to && state.selection.to >= from)
                continue;
              decorations.push(
                Decoration.inline(from, to, {
                  class: 'smart-punctuation',
                  'data-smart-punctuation': item.value,
                }),
              );
            }
          });
          return DecorationSet.create(state.doc, decorations);
        },
      },
    }),
);
