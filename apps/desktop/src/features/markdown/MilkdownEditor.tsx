import { Crepe } from '@milkdown/crepe';
import '@milkdown/crepe/theme/common/style.css';
import { $prose, insert, replaceAll } from '@milkdown/kit/utils';
import { Plugin, type EditorState } from '@milkdown/kit/prose/state';
import { editorViewOptionsCtx, serializerCtx } from '@milkdown/kit/core';
import {
  captureMilkdownViewport,
  restoreMilkdownViewport,
  type MarkdownEditorHandle,
  type MarkdownViewport,
} from './markdownViewport';
import {
  MarkdownEditorToolbar,
  type EditorToolbarState,
} from './MarkdownEditorToolbar';
import {
  applyEditorAction,
  applyTextStyle,
  editorToolbarState,
} from './milkdownToolbar';
import { languages } from '@codemirror/language-data';
import { indentUnit } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { Check, Copy, Eye, GripVertical, Pencil, Plus } from 'lucide-react';
import '../../components/ui/Checkbox/Checkbox.css';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMermaidPreview, mountMermaidPreviews } from './mermaidPreview';
import { mathOptions } from './markdownExtensions';
import { smartPunctuationPlugin } from './milkdownSmartPunctuation';
import { kanleafMarkdownTheme } from './markdownEditorTheme';
import { kanleafMathBlockView } from './mathBlockView';
import { normalizeMilkdownImageTitles } from './milkdownMarkdown';
import {
  blockBoundaryCursor,
  placeCursorAfterBlock,
} from './blockBoundaryCursor';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type Ref,
} from 'react';

interface MilkdownEditorProps {
  ref?: Ref<MarkdownEditorHandle>;
  initialViewport?: MarkdownViewport | null;
  value: string;
  onChange: (markdown: string) => void;
  uploadImage: (file: File) => Promise<string>;
  resolveAsset: (reference: string) => Promise<string>;
}

export function MilkdownEditor({
  ref,
  initialViewport,
  value,
  onChange,
  uploadImage,
  resolveAsset,
}: MilkdownEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const markdownRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const initialViewportRef = useRef(initialViewport);
  const stopRestoringRef = useRef<(() => void) | undefined>(undefined);
  const [ready, setReady] = useState(false);
  useImperativeHandle(
    ref,
    () => ({
      captureViewport: () => {
        const crepe = crepeRef.current;
        const root = rootRef.current;
        if (!crepe || !root || !ready) return null;
        return crepe.editor.action((ctx) =>
          captureMilkdownViewport(ctx, root, markdownRef.current),
        );
      },
    }),
    [ready],
  );
  const [toolbarState, setToolbarState] = useState<EditorToolbarState>({
    style: 'paragraph',
    active: [],
  });
  const [assetState, setAssetState] = useState<'idle' | 'uploading' | 'error'>(
    'idle',
  );
  const [assetError, setAssetError] = useState<string | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const onUpload = useCallback(
    async (file: File) => {
      setAssetState('uploading');
      setAssetError(null);
      try {
        const reference = await uploadImage(file);
        setAssetState('idle');
        return reference;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Image upload failed';
        setAssetState('error');
        setAssetError(message);
        throw error;
      }
    },
    [uploadImage],
  );

  const insertUploadedImage = useCallback(
    async (file: File) => {
      try {
        const reference = await onUpload(file);
        const alt = file.name
          .replaceAll('\\', '\\\\')
          .replaceAll('[', '\\[')
          .replaceAll(']', '\\]');
        crepeRef.current?.editor.action(insert(`![${alt}](${reference})`));
      } catch {
        // onUpload owns visible error reporting and leaves the document intact.
      }
    },
    [onUpload],
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let disposed = false;
    const objectUrls = new Set<string>();
    const resolvedAssets = new Map<string, Promise<string>>();
    const proxyDomURL = async (source: string) => {
      if (!source.startsWith('kanleaf-asset://')) return source;
      let pending = resolvedAssets.get(source);
      if (!pending) {
        pending = resolveAsset(source).then((resolved) => {
          if (resolved.startsWith('blob:')) objectUrls.add(resolved);
          return resolved;
        });
        resolvedAssets.set(source, pending);
      }
      return pending;
    };
    const crepe = new Crepe({
      root,
      defaultValue: markdownRef.current,
      features: {
        [Crepe.Feature.Latex]: true,
        [Crepe.Feature.TopBar]: false,
        [Crepe.Feature.Toolbar]: false,
        [Crepe.Feature.AI]: false,
      },
      featureConfigs: {
        [Crepe.Feature.ListItem]: {
          checkBoxCheckedIcon: renderToStaticMarkup(
            <span
              className="ui-checkbox markdown-checklist-box"
              data-checked=""
              aria-hidden="true"
            >
              <Check size={12} strokeWidth={2.5} />
            </span>,
          ),
          checkBoxUncheckedIcon: renderToStaticMarkup(
            <span
              className="ui-checkbox markdown-checklist-box"
              aria-hidden="true"
            >
              <Check size={12} strokeWidth={2.5} />
            </span>,
          ),
        },
        [Crepe.Feature.Latex]: { katexOptions: mathOptions },
        [Crepe.Feature.CodeMirror]: {
          languages,
          extensions: [indentUnit.of('    '), kanleafMarkdownTheme],
          copyIcon: renderToStaticMarkup(<Copy size={16} />),
          previewToggleIcon: (previewOnly) =>
            renderToStaticMarkup(
              previewOnly ? <Pencil size={16} /> : <Eye size={16} />,
            ),
          theme: EditorView.theme({ '.cm-gutters': { display: 'none' } }),
          previewOnlyByDefault: true,
          previewLabel: '',
          previewToggleText: (previewOnly) =>
            previewOnly ? 'Edit code' : 'Diagram',
          renderPreview: (language, content) =>
            language.toLowerCase() === 'mermaid'
              ? createMermaidPreview(content)
              : null,
        },
        [Crepe.Feature.Cursor]: {
          virtual: false,
        },
        [Crepe.Feature.BlockEdit]: {
          blockHandle: { getOffset: () => 4 },
          handleAddIcon: renderToStaticMarkup(<Plus size={16} />),
          handleDragIcon: renderToStaticMarkup(<GripVertical size={16} />),
          textGroup: {
            label: 'Text',
            text: { label: 'Normal text' },
            h1: { label: 'Heading 1' },
            h2: { label: 'Heading 2' },
            h3: { label: 'Heading 3' },
            h4: null,
            h5: null,
            h6: null,
            quote: { label: 'Quote' },
            divider: { label: 'Divider' },
          },
          listGroup: {
            label: 'Lists',
            bulletList: { label: 'Bullet list' },
            orderedList: { label: 'Ordered list' },
            taskList: { label: 'Checklist' },
          },
          advancedGroup: {
            label: 'Insert',
            image: { label: 'Image' },
            codeBlock: { label: 'Code block' },
            table: { label: 'Table' },
            math: { label: 'Math' },
          },
        },
        [Crepe.Feature.ImageBlock]: {
          onUpload,
          proxyDomURL,
          onImageLoadError: () => {
            setAssetState('error');
            setAssetError('Image could not be loaded.');
          },
        },
        [Crepe.Feature.Placeholder]: {
          text: 'Write Markdown or press / for commands',
        },
      },
    });
    crepe.editor.config((ctx) => {
      ctx.update(editorViewOptionsCtx, (options) => ({
        ...options,
        attributes: { spellcheck: 'false' },
        handleDOMEvents: {
          ...options.handleDOMEvents,
          mousedown: (view, event) =>
            placeCursorAfterBlock(view, event) ||
            options.handleDOMEvents?.mousedown?.(view, event) ||
            false,
        },
      }));
    });
    crepe.editor.use(normalizeMilkdownImageTitles);
    crepe.editor.use(blockBoundaryCursor);
    crepe.editor.use(kanleafMathBlockView);
    crepe.editor.use(smartPunctuationPlugin);
    crepe.editor.use(
      $prose(
        (ctx) =>
          new Plugin({
            view(view) {
              const update = (previousState?: EditorState) => {
                if (previousState && !previousState.doc.eq(view.state.doc)) {
                  const markdown = ctx.get(serializerCtx)(view.state.doc);
                  if (markdown !== markdownRef.current) {
                    markdownRef.current = markdown;
                    onChangeRef.current(markdown);
                  }
                }
                const next = editorToolbarState(view.state);
                setToolbarState((previous) =>
                  previous.style === next.style &&
                  previous.active.join(',') === next.active.join(',')
                    ? previous
                    : next,
                );
              };
              update();
              return {
                update: (_view, previousState) => update(previousState),
              };
            },
          }),
      ),
    );
    crepeRef.current = crepe;

    const observer = new MutationObserver(() => decorateBlockControls(root));
    observer.observe(root, { childList: true, subtree: true });
    void crepe.create().then(() => {
      if (disposed) {
        void crepe.destroy();
        return;
      }
      decorateBlockControls(root);
      const anchor = initialViewportRef.current;
      if (anchor)
        stopRestoringRef.current = crepe.editor.action((ctx) =>
          restoreMilkdownViewport(ctx, root, markdownRef.current, anchor),
        );
      setReady(true);
    });

    return () => {
      disposed = true;
      stopRestoringRef.current?.();
      observer.disconnect();
      crepeRef.current = null;
      void crepe.destroy();
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [onUpload, resolveAsset]);

  useEffect(() => {
    const crepe = crepeRef.current;
    if (!ready || !crepe || value === markdownRef.current) return;
    stopRestoringRef.current?.();
    markdownRef.current = value;
    crepe.editor.action(replaceAll(value));
  }, [ready, value]);

  return (
    <div
      className="milkdown-editor-shell"
      onPasteCapture={(event: ClipboardEvent) => {
        const file = Array.from(event.clipboardData.files).find((item) =>
          item.type.startsWith('image/'),
        );
        if (!file) return;
        event.preventDefault();
        event.stopPropagation();
        void insertUploadedImage(file);
      }}
      onDragOver={(event: DragEvent) => {
        if (
          Array.from(event.dataTransfer.items).some(
            (item) => item.kind === 'file',
          )
        )
          event.preventDefault();
      }}
      onDropCapture={(event: DragEvent) => {
        const file = Array.from(event.dataTransfer.files).find((item) =>
          item.type.startsWith('image/'),
        );
        if (!file) return;
        event.preventDefault();
        event.stopPropagation();
        void insertUploadedImage(file);
      }}
    >
      <MarkdownEditorToolbar
        state={toolbarState}
        disabled={!ready}
        onAction={(action) =>
          crepeRef.current?.editor.action((ctx) =>
            applyEditorAction(ctx, action),
          )
        }
        onStyle={(style) =>
          crepeRef.current?.editor.action((ctx) => applyTextStyle(ctx, style))
        }
      />
      {assetState !== 'idle' && (
        <div
          className={`editor-upload-status is-${assetState}`}
          role={assetState === 'error' ? 'alert' : 'status'}
        >
          {assetState === 'uploading' ? 'Uploading image…' : assetError}
        </div>
      )}
      <div
        ref={rootRef}
        className="milkdown-editor milkdown-crepe-editor ui-native-scrollbar"
        aria-label="Visual Markdown editor"
        aria-busy={!ready}
      />
    </div>
  );
}

function decorateBlockControls(root: HTMLElement) {
  mountMermaidPreviews(root);
  root
    .querySelectorAll<HTMLElement>('.cm-scroller, .milkdown-table-block')
    .forEach((element) => element.classList.add('ui-native-scrollbar'));
  const controls = root.querySelectorAll<HTMLElement>(
    '.milkdown-block-handle .operation-item',
  );
  const labels = ['Add block', 'Drag block'];
  controls.forEach((control, index) => {
    if (index === 0) {
      control.hidden = true;
      return;
    }
    if (control.dataset.kanleafAccessible === 'true') return;
    control.dataset.kanleafAccessible = 'true';
    control.setAttribute('role', 'button');
    control.setAttribute('tabindex', '0');
    control.setAttribute('aria-label', labels[index] ?? 'Block action');
  });

  root
    .querySelectorAll<HTMLElement>('.milkdown-list-item-block .label-wrapper')
    .forEach((control) => {
      const label = control.querySelector<HTMLElement>('.label');
      const checked = label?.classList.contains('checked');
      const unchecked = label?.classList.contains('unchecked');
      if (!checked && !unchecked) return;
      control.setAttribute('role', 'checkbox');
      control.setAttribute('tabindex', '0');
      control.setAttribute('aria-label', 'Toggle checklist item');
      control.setAttribute('aria-checked', String(checked));
      if (control.dataset.kanleafAccessible === 'true') return;
      control.dataset.kanleafAccessible = 'true';
      control.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        control.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      });
    });
}
