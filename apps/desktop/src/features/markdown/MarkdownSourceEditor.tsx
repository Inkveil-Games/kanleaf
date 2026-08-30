import { indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { EditorView, keymap } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import { markdownLivePreview } from './livePreview';
import { kanleafMarkdownTheme } from './markdownEditorTheme';

interface MarkdownSourceEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  livePreview?: boolean;
}

const markdownSupport = markdown({
  base: markdownLanguage,
  codeLanguages: languages,
});
const livePreviewExtension = markdownLivePreview();

export function MarkdownSourceEditor({
  value,
  onChange,
  readOnly = false,
  livePreview = false,
}: MarkdownSourceEditorProps) {
  return (
    <CodeMirror
      aria-label="Markdown source"
      value={value}
      height="100%"
      editable={!readOnly}
      extensions={[
        markdownSupport,
        keymap.of([indentWithTab]),
        EditorView.lineWrapping,
        kanleafMarkdownTheme,
        livePreview ? livePreviewExtension : [],
      ]}
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: true,
        highlightActiveLineGutter: false,
      }}
      onChange={onChange}
    />
  );
}
