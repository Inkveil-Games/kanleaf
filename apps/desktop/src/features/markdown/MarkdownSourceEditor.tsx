import { indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { EditorView, keymap } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';

interface MarkdownSourceEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}

export function MarkdownSourceEditor({
  value,
  onChange,
  readOnly = false,
}: MarkdownSourceEditorProps) {
  return (
    <CodeMirror
      aria-label="Markdown source"
      value={value}
      height="100%"
      editable={!readOnly}
      extensions={[
        markdown(),
        keymap.of([indentWithTab]),
        EditorView.lineWrapping,
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
