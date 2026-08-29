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
import { ApiError } from '../../lib/api/client';

const MarkdownSourceEditor = lazy(() =>
  import('./MarkdownSourceEditor').then((module) => ({
    default: module.MarkdownSourceEditor,
  })),
);

type MarkdownMode = 'edit' | 'preview' | 'split';
type SaveState = 'saved' | 'unsaved' | 'saving' | 'conflict' | 'error';

interface MarkdownDocumentProps {
  serverUrl: string;
  token: string;
  workspaceId: string;
  taskId: string;
  readOnly?: boolean;
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
      initialRevision={document.data.revision}
    />
  );
}

interface LoadedMarkdownDocumentProps extends MarkdownDocumentProps {
  initialContent: string;
  initialRevision: string;
}

function LoadedMarkdownDocument({
  initialContent,
  initialRevision,
  serverUrl,
  token,
  workspaceId,
  taskId,
  readOnly = false,
}: LoadedMarkdownDocumentProps) {
  const [content, setContent] = useState(initialContent);
  const [mode, setMode] = useState(readMode);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const contentRef = useRef(content);
  const lastSavedRef = useRef(initialContent);
  const revisionRef = useRef(initialRevision);
  const conflictRef = useRef(false);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

  const queueSave = useCallback(
    async (nextContent: string) => {
      if (readOnly || conflictRef.current) return;
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
          const saved = await writeTaskDocument(
            { serverUrl, token, workspaceId, taskId },
            nextContent,
            revisionRef.current,
          );
          lastSavedRef.current = nextContent;
          revisionRef.current = saved.revision;
        });
      saveChainRef.current = save;

      try {
        await save;
        setSaveState(
          contentRef.current === lastSavedRef.current ? 'saved' : 'unsaved',
        );
      } catch (caught) {
        setSaveError(errorMessage(caught));
        if (caught instanceof ApiError && caught.code === 'conflict') {
          conflictRef.current = true;
          setSaveState('conflict');
        } else {
          setSaveState('error');
        }
      }
    },
    [readOnly, serverUrl, taskId, token, workspaceId],
  );

  useEffect(() => {
    if (readOnly || content === lastSavedRef.current) return;
    const timeout = window.setTimeout(
      () => void queueSave(content),
      AUTOSAVE_DELAY_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [content, queueSave, readOnly]);

  useEffect(() => {
    function saveShortcut(event: KeyboardEvent) {
      if (
        !readOnly &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === 's'
      ) {
        event.preventDefault();
        void queueSave(contentRef.current);
      }
    }
    window.addEventListener('keydown', saveShortcut);
    return () => window.removeEventListener('keydown', saveShortcut);
  }, [queueSave, readOnly]);

  useEffect(
    () => () => {
      if (
        !readOnly &&
        !conflictRef.current &&
        contentRef.current !== lastSavedRef.current
      ) {
        void queueSave(contentRef.current);
      }
    },
    [queueSave, readOnly],
  );

  function changeContent(value: string) {
    contentRef.current = value;
    setContent(value);
    setSaveState(value === lastSavedRef.current ? 'saved' : 'unsaved');
    setSaveError(null);
    setCopyState('idle');
  }

  async function reloadRemote() {
    try {
      const remote = await readTaskDocument({
        serverUrl,
        token,
        workspaceId,
        taskId,
      });
      contentRef.current = remote.content;
      lastSavedRef.current = remote.content;
      revisionRef.current = remote.revision;
      conflictRef.current = false;
      setContent(remote.content);
      setSaveError(null);
      setSaveState('saved');
      setCopyState('idle');
    } catch (caught) {
      setSaveError(errorMessage(caught));
      setSaveState('error');
    }
  }

  async function copyLocal() {
    try {
      await navigator.clipboard.writeText(contentRef.current);
      setCopyState('copied');
    } catch {
      setSaveError('Could not copy the local Markdown source');
    }
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
        {readOnly ? (
          <span className="save-indicator" role="status">
            Read only
          </span>
        ) : (
          <div className="save-controls">
            <span
              className={`save-indicator save-${saveState}`}
              role={
                saveState === 'error' || saveState === 'conflict'
                  ? 'alert'
                  : 'status'
              }
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
        )}
      </header>

      {saveState === 'conflict' && (
        <div className="document-conflict" role="alert">
          <div>
            <strong>The file changed outside Kanleaf.</strong>
            <span>
              Your local Markdown is still open and has not been overwritten.
            </span>
          </div>
          <div className="document-conflict-actions">
            <button type="button" onClick={() => void copyLocal()}>
              {copyState === 'copied' ? 'Local source copied' : 'Copy local'}
            </button>
            <button type="button" onClick={() => void reloadRemote()}>
              Reload remote
            </button>
          </div>
        </div>
      )}

      <div className={`document-workspace document-${mode}`}>
        {mode !== 'preview' && (
          <div className="markdown-editor" aria-label="Markdown editor">
            <Suspense
              fallback={<div className="document-state">Loading source…</div>}
            >
              <MarkdownSourceEditor
                value={content}
                onChange={changeContent}
                readOnly={readOnly}
              />
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
  if (state === 'conflict') return 'Conflict';
  return 'Saved';
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Document request failed';
}
