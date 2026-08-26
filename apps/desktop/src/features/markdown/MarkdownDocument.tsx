import { useQuery } from '@tanstack/react-query';
import { Columns2, Eye, Pencil, Save } from 'lucide-react';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { readTaskDocument, writeTaskDocument } from './api';
import { MarkdownPreview } from './MarkdownPreview';

const MarkdownSourceEditor = lazy(() =>
  import('./MarkdownSourceEditor').then((module) => ({
    default: module.MarkdownSourceEditor,
  })),
);

type MarkdownMode = 'edit' | 'preview' | 'split';
type SaveState = 'saved' | 'unsaved' | 'saving' | 'error';

interface MarkdownDocumentProps {
  serverUrl: string;
  token: string;
  workspaceId: string;
  taskId: string;
}

const MODE_STORAGE_KEY = 'kanleaf.markdown-mode';
const AUTOSAVE_DELAY_MS = 800;

export function MarkdownDocument(props: MarkdownDocumentProps) {
  const document = useQuery({
    queryKey: ['document', props.workspaceId, props.taskId],
    queryFn: () => readTaskDocument(props),
  });

  if (document.isPending) {
    return (
      <DocumentFrame>
        <div className="document-state" aria-live="polite">
          Loading document…
        </div>
      </DocumentFrame>
    );
  }
  if (document.error) {
    return (
      <DocumentFrame>
        <div className="document-state" role="alert">
          <p>{errorMessage(document.error)}</p>
          <button type="button" onClick={() => void document.refetch()}>
            Try again
          </button>
        </div>
      </DocumentFrame>
    );
  }

  return (
    <LoadedMarkdownDocument
      key={props.taskId}
      {...props}
      initialContent={document.data.content}
    />
  );
}

interface LoadedMarkdownDocumentProps extends MarkdownDocumentProps {
  initialContent: string;
}

function LoadedMarkdownDocument({
  initialContent,
  serverUrl,
  token,
  workspaceId,
  taskId,
}: LoadedMarkdownDocumentProps) {
  const [content, setContent] = useState(initialContent);
  const [mode, setMode] = useState(readMode);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
  const contentRef = useRef(content);
  const lastSavedRef = useRef(initialContent);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

  const queueSave = useCallback(
    async (nextContent: string) => {
      if (nextContent === lastSavedRef.current) {
        if (contentRef.current === nextContent) setSaveState('saved');
        return;
      }
      setSaveState('saving');
      setSaveError(null);

      const save = saveChainRef.current
        .catch(() => undefined)
        .then(async () => {
          if (nextContent === lastSavedRef.current) return;
          await writeTaskDocument(
            { serverUrl, token, workspaceId, taskId },
            nextContent,
          );
          lastSavedRef.current = nextContent;
        });
      saveChainRef.current = save;

      try {
        await save;
        setSaveState(
          contentRef.current === lastSavedRef.current ? 'saved' : 'unsaved',
        );
      } catch (caught) {
        setSaveError(errorMessage(caught));
        setSaveState('error');
      }
    },
    [serverUrl, taskId, token, workspaceId],
  );

  useEffect(() => {
    if (content === lastSavedRef.current) return;
    const timeout = window.setTimeout(
      () => void queueSave(content),
      AUTOSAVE_DELAY_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [content, queueSave]);

  useEffect(() => {
    function saveShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void queueSave(contentRef.current);
      }
    }
    window.addEventListener('keydown', saveShortcut);
    return () => window.removeEventListener('keydown', saveShortcut);
  }, [queueSave]);

  useEffect(
    () => () => {
      if (contentRef.current !== lastSavedRef.current) {
        void queueSave(contentRef.current);
      }
    },
    [queueSave],
  );

  function changeContent(value: string) {
    contentRef.current = value;
    setContent(value);
    setSaveState(value === lastSavedRef.current ? 'saved' : 'unsaved');
    setSaveError(null);
  }

  function changeMode(nextMode: MarkdownMode) {
    setMode(nextMode);
    try {
      localStorage.setItem(MODE_STORAGE_KEY, nextMode);
    } catch {
      // The editor remains usable when local preferences are unavailable.
    }
  }

  return (
    <DocumentFrame>
      <header className="document-toolbar">
        <div className="document-modes" aria-label="Document view">
          <ModeButton
            label="Edit"
            active={mode === 'edit'}
            icon={<Pencil aria-hidden="true" size={14} />}
            onClick={() => changeMode('edit')}
          />
          <ModeButton
            label="Preview"
            active={mode === 'preview'}
            icon={<Eye aria-hidden="true" size={15} />}
            onClick={() => changeMode('preview')}
          />
          <ModeButton
            label="Split"
            active={mode === 'split'}
            icon={<Columns2 aria-hidden="true" size={15} />}
            onClick={() => changeMode('split')}
          />
        </div>
        <div className="save-controls">
          <span
            className={`save-indicator save-${saveState}`}
            role={saveState === 'error' ? 'alert' : 'status'}
            title={saveError ?? undefined}
          >
            {saveLabel(saveState)}
          </span>
          <button
            type="button"
            aria-label="Save Markdown"
            title="Save Markdown (Ctrl/Command+S)"
            onClick={() => void queueSave(contentRef.current)}
          >
            <Save aria-hidden="true" size={15} />
          </button>
        </div>
      </header>

      <div className={`document-workspace document-${mode}`}>
        {mode !== 'preview' && (
          <div className="markdown-editor" aria-label="Markdown editor">
            <Suspense
              fallback={<div className="document-state">Loading source…</div>}
            >
              <MarkdownSourceEditor value={content} onChange={changeContent} />
            </Suspense>
          </div>
        )}
        {mode !== 'edit' && <MarkdownPreview content={content} />}
      </div>
    </DocumentFrame>
  );
}

interface ModeButtonProps {
  label: string;
  active: boolean;
  icon: ReactNode;
  onClick: () => void;
}

function ModeButton({ label, active, icon, onClick }: ModeButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title={`${label} Markdown`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function DocumentFrame({ children }: { children: ReactNode }) {
  return (
    <section className="task-document" aria-labelledby="document-heading">
      <h2 id="document-heading" className="sr-only">
        Markdown document
      </h2>
      {children}
    </section>
  );
}

function readMode(): MarkdownMode {
  try {
    const mode = localStorage.getItem(MODE_STORAGE_KEY);
    if (mode === 'edit' || mode === 'preview' || mode === 'split') return mode;
  } catch {
    return 'edit';
  }
  return 'edit';
}

function saveLabel(state: SaveState) {
  if (state === 'saving') return 'Saving…';
  if (state === 'unsaved') return 'Unsaved';
  if (state === 'error') return 'Save failed';
  return 'Saved';
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Document request failed';
}
