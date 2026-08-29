import { indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorView, keymap } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import { markdownLivePreview } from './livePreview';

interface MarkdownSourceEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  livePreview?: boolean;
}

const markdownSupport = markdown({ base: markdownLanguage });
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
        livePreview ? livePreviewExtension : [],
      ]}
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
      }}
      onChange={onChange}
    />
  );
}
