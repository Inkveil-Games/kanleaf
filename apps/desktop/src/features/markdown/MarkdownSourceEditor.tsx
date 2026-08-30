import { indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { EditorView, ViewPlugin, keymap } from '@codemirror/view';
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
const trailingWhitespaceExtension = ViewPlugin.define((view) => {
  const handleMouseDown = (event: MouseEvent) => {
    if (
      event.button !== 0 ||
      !view.state.facet(EditorView.editable) ||
      view.viewport.to < view.state.doc.length
    ) {
      return;
    }

    const scroller = view.scrollDOM.getBoundingClientRect();
    const scrollerRight =
      scroller.left + (view.scrollDOM.clientWidth || scroller.width);
    const scrollerBottom =
      scroller.top + (view.scrollDOM.clientHeight || scroller.height);
    if (
      event.clientX < scroller.left ||
      event.clientX > scrollerRight ||
      event.clientY < scroller.top ||
      event.clientY > scrollerBottom
    ) {
      return;
    }

    const documentBottom = Array.from(
      view.contentDOM.querySelectorAll<HTMLElement>(
        '.cm-line, .cm-live-block-widget',
      ),
    ).reduce((bottom, element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.height > 0 ? Math.max(bottom, bounds.bottom) : bottom;
    }, Number.NEGATIVE_INFINITY);
    if (!Number.isFinite(documentBottom) || event.clientY <= documentBottom) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const end = view.state.doc.length;
    const needsTrailingLine =
      end > 0 && view.state.doc.sliceString(end - 1, end) !== '\n';
    if (needsTrailingLine) {
      view.dispatch({
        changes: { from: end, insert: '\n' },
        selection: { anchor: end + 1 },
        scrollIntoView: true,
        userEvent: 'input',
      });
    } else {
      view.dispatch({ selection: { anchor: end }, scrollIntoView: true });
    }
    view.focus();
  };

  view.scrollDOM.addEventListener('mousedown', handleMouseDown, true);
  return {
    destroy() {
      view.scrollDOM.removeEventListener('mousedown', handleMouseDown, true);
    },
  };
});

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
        livePreview ? [livePreviewExtension, trailingWhitespaceExtension] : [],
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
