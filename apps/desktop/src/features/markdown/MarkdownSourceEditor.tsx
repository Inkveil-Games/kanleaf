import { indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { indentUnit } from '@codemirror/language';
import { EditorView, ViewPlugin, keymap } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import { kanleafMarkdownTheme } from './markdownEditorTheme';
import { useImperativeHandle, useRef, type Ref } from 'react';
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
}: MarkdownSourceEditorProps) {
  const viewRef = useRef<EditorView | null>(null);
  const initialViewportRef = useRef(initialViewport);
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
        extensions={sourceExtensions}
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
