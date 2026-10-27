import { indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { indentUnit, syntaxTree } from '@codemirror/language';
import { Prec } from '@codemirror/state';
import { EditorView, ViewPlugin, keymap } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import { kanleafMarkdownTheme } from './markdownEditorTheme';
import {
  INTERNAL_LINK_TRIGGER,
  type InternalLinkController,
} from './internalLinkController';
import { useImperativeHandle, useMemo, useRef, type Ref } from 'react';
import type {
  MarkdownEditorHandle,
  MarkdownViewport,
} from './markdownViewport';

interface MarkdownSourceEditorProps {
  ref?: Ref<MarkdownEditorHandle>;
  initialViewport?: MarkdownViewport | null;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  internalLinks?: InternalLinkController;
}

const NAVIGATION_KEYS = ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'];

function internalLinkExtension(controller: InternalLinkController) {
  const report = (view: EditorView) => {
    const { state } = view;
    const selection = state.selection.main;
    if (!selection.empty) {
      controller.onTrigger(null);
      return;
    }
    const head = selection.head;
    const line = state.doc.lineAt(head);
    const before = line.text.slice(
      Math.max(0, head - line.from - 120),
      head - line.from,
    );
    const match = INTERNAL_LINK_TRIGGER.exec(before);
    const inCode = /Code|Fenced/.test(
      syntaxTree(state).resolveInner(head, -1).name,
    );
    if (!match || inCode) {
      controller.onTrigger(null);
      return;
    }
    const from = head - match[0].length;
    const query = match[1] ?? '';
    // Layout cannot be read inside an update, so measure once it has finished.
    queueMicrotask(() => {
      if (view.state.selection.main.head !== head) return;
      const coords = view.coordsAtPos(head);
      if (!coords) return;
      controller.onTrigger({
        from,
        query,
        rect: { left: coords.left, top: coords.top, bottom: coords.bottom },
        insert: (target) => {
          const current = view.state.selection.main.head;
          const closes = view.state.sliceDoc(current, current + 2) === ']]';
          const text = `[[${target}]]`;
          view.dispatch({
            changes: {
              from,
              to: closes ? current + 2 : current,
              insert: text,
            },
            selection: { anchor: from + text.length },
            scrollIntoView: true,
          });
          view.focus();
        },
      });
    });
  };

  return [
    Prec.highest(
      keymap.of(
        NAVIGATION_KEYS.map((key) => ({
          key,
          run: () => controller.onKey(key),
        })),
      ),
    ),
    EditorView.updateListener.of((update) => {
      if (update.docChanged || update.selectionSet || update.focusChanged) {
        report(update.view);
      }
    }),
  ];
}

const markdownSupport = markdown({
  base: markdownLanguage,
  codeLanguages: languages,
});
const nativeScrollbarExtension = ViewPlugin.define((view) => {
  view.scrollDOM.classList.add('ui-native-scrollbar');
  return {
    destroy() {
      view.scrollDOM.classList.remove('ui-native-scrollbar');
    },
  };
});
const sourceExtensions = [
  markdownSupport,
  indentUnit.of('    '),
  keymap.of([indentWithTab]),
  EditorView.lineWrapping,
  kanleafMarkdownTheme,
  nativeScrollbarExtension,
];
const basicSetup = {
  lineNumbers: false,
  foldGutter: false,
  highlightActiveLine: true,
  highlightActiveLineGutter: false,
};

export function MarkdownSourceEditor({
  ref,
  initialViewport,
  value,
  onChange,
  readOnly = false,
  internalLinks,
}: MarkdownSourceEditorProps) {
  const viewRef = useRef<EditorView | null>(null);
  const initialViewportRef = useRef(initialViewport);
  const extensions = useMemo(
    () =>
      internalLinks
        ? [...sourceExtensions, internalLinkExtension(internalLinks)]
        : sourceExtensions,
    [internalLinks],
  );
  useImperativeHandle(
    ref,
    () => ({
      captureViewport: () => {
        const view = viewRef.current;
        if (!view) return null;
        const top = view.scrollDOM.getBoundingClientRect().top;
        const line = view.lineBlockAtHeight(top - view.documentTop);
        return { offset: line.from, inset: line.top + view.documentTop - top };
      },
      revealOffset: (offset) => {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({
          effects: EditorView.scrollIntoView(
            Math.min(offset, view.state.doc.length),
            { y: 'start', yMargin: 12 },
          ),
        });
      },
    }),
    [],
  );
  return (
    <div className="markdown-source-shell">
      <div className="markdown-source-toolbar">Markdown source</div>
      <CodeMirror
        aria-label="Markdown source"
        className="markdown-source-editor"
        value={value}
        height="100%"
        editable={!readOnly}
        extensions={extensions}
        basicSetup={basicSetup}
        onChange={onChange}
        onCreateEditor={(view) => {
          viewRef.current = view;
          const anchor = initialViewportRef.current;
          if (!anchor) return;
          view.requestMeasure({
            read: () =>
              view.lineBlockAt(Math.min(anchor.offset, view.state.doc.length))
                .top +
              view.documentTop -
              view.scrollDOM.getBoundingClientRect().top -
              anchor.inset,
            write: (delta) => {
              view.scrollDOM.scrollTop += delta;
            },
          });
        }}
      />
    </div>
  );
}
