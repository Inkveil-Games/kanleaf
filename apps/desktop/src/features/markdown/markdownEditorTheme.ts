import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { tags } from '@lezer/highlight';

const kanleafHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, class: 'cm-syntax-comment' },
  {
    tag: [
      tags.keyword,
      tags.controlKeyword,
      tags.definitionKeyword,
      tags.moduleKeyword,
      tags.operatorKeyword,
      tags.modifier,
    ],
    class: 'cm-syntax-keyword',
  },
  {
    tag: [
      tags.definition(tags.variableName),
      tags.function(tags.variableName),
      tags.labelName,
    ],
    class: 'cm-syntax-function',
  },
  {
    tag: [tags.typeName, tags.className, tags.namespace, tags.tagName],
    class: 'cm-syntax-type',
  },
  {
    tag: [tags.propertyName, tags.attributeName],
    class: 'cm-syntax-property',
  },
  {
    tag: [
      tags.string,
      tags.character,
      tags.attributeValue,
      tags.regexp,
      tags.escape,
    ],
    class: 'cm-syntax-string',
  },
  {
    tag: [tags.number, tags.bool, tags.null, tags.atom],
    class: 'cm-syntax-number',
  },
  {
    tag: [
      tags.operator,
      tags.arithmeticOperator,
      tags.logicOperator,
      tags.bitwiseOperator,
      tags.compareOperator,
      tags.updateOperator,
    ],
    class: 'cm-syntax-operator',
  },
  {
    tag: [
      tags.heading1,
      tags.heading2,
      tags.heading3,
      tags.heading4,
      tags.heading5,
      tags.heading6,
    ],
    class: 'cm-syntax-heading',
  },
  { tag: tags.strong, class: 'cm-syntax-strong' },
  { tag: tags.emphasis, class: 'cm-syntax-emphasis' },
  { tag: tags.strikethrough, class: 'cm-syntax-strikethrough' },
  { tag: [tags.link, tags.url], class: 'cm-syntax-link' },
  { tag: tags.monospace, class: 'cm-syntax-code' },
  { tag: tags.quote, class: 'cm-syntax-quote' },
  {
    tag: [
      tags.list,
      tags.meta,
      tags.processingInstruction,
      tags.contentSeparator,
      tags.punctuation,
    ],
    class: 'cm-syntax-markup',
  },
  { tag: tags.invalid, class: 'cm-syntax-invalid' },
]);

export const kanleafMarkdownTheme: Extension = syntaxHighlighting(
  kanleafHighlightStyle,
);
