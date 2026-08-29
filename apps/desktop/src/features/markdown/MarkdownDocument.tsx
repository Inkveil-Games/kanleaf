import { useQuery } from '@tanstack/react-query';
import { Code2, Columns2, Eye, Pencil, Save } from 'lucide-react';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  readMarkdownDocument,
  writeMarkdownDocument,
  type MarkdownTarget,
} from './api';
import { MarkdownPreview } from './MarkdownPreview';
import { ApiError } from '../../lib/api/client';
import { useDocumentSaveCoordinator } from './documentSaveCoordinatorContext';

const MarkdownSourceEditor = lazy(() =>
  import('./MarkdownSourceEditor').then((module) => ({
    default: module.MarkdownSourceEditor,
  })),
);

type MarkdownMode = 'live' | 'source' | 'reading' | 'split';
type SaveState = 'saved' | 'unsaved' | 'saving' | 'conflict' | 'error';

interface MarkdownDocumentProps {
  serverUrl: string;
  token: string;
  workspaceId: string;
  target: MarkdownTarget;
  readOnly?: boolean;
}

const MODE_STORAGE_KEY = 'kanleaf.markdown-mode';
const AUTOSAVE_DELAY_MS = 800;

export function MarkdownDocument(props: MarkdownDocumentProps) {
  const document = useQuery({
    queryKey: [
      'markdown-document',
      props.workspaceId,
      props.target.kind,
      props.target.id,
    ],
    queryFn: () => readMarkdownDocument(props),
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
      key={`${props.target.kind}:${props.target.id}`}
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
  target,
  readOnly = false,
}: LoadedMarkdownDocumentProps) {
  const targetKind = target.kind;
  const targetId = target.id;
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
  const { registerDocumentSave } = useDocumentSaveCoordinator();

  const queueSave = useCallback(
    async (nextContent: string) => {
      if (readOnly) return true;
      if (conflictRef.current) return false;
      if (nextContent === lastSavedRef.current) {
        if (contentRef.current === nextContent) setSaveState('saved');
        return true;
      }
      setSaveState('saving');
      setSaveError(null);

      const save = saveChainRef.current
        .catch(() => undefined)
        .then(async () => {
          if (nextContent === lastSavedRef.current) return;
          const saved = await writeMarkdownDocument(
            {
              serverUrl,
              token,
              workspaceId,
              target: { kind: targetKind, id: targetId },
            },
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
        return true;
      } catch (caught) {
        setSaveError(errorMessage(caught));
        if (caught instanceof ApiError && caught.code === 'conflict') {
          conflictRef.current = true;
          setSaveState('conflict');
        } else {
          setSaveState('error');
        }
        return false;
      }
    },
    [readOnly, serverUrl, targetId, targetKind, token, workspaceId],
  );

  const flushForTransition = useCallback(async () => {
    if (!(await queueSave(contentRef.current))) {
      throw new Error('Resolve unsaved Markdown before switching accounts');
    }
  }, [queueSave]);

  useEffect(() => {
    if (readOnly) return;
    return registerDocumentSave(flushForTransition);
  }, [flushForTransition, readOnly, registerDocumentSave]);

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
      const remote = await readMarkdownDocument({
        serverUrl,
        token,
        workspaceId,
        target: { kind: targetKind, id: targetId },
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
            label="Live"
            active={mode === 'live'}
            icon={<Pencil aria-hidden="true" size={14} />}
            onClick={() => changeMode('live')}
          />
          <ModeButton
            label="Source"
            active={mode === 'source'}
            icon={<Code2 aria-hidden="true" size={14} />}
            onClick={() => changeMode('source')}
          />
          <ModeButton
            label="Reading"
            active={mode === 'reading'}
            icon={<Eye aria-hidden="true" size={15} />}
            onClick={() => changeMode('reading')}
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

      {(saveState === 'conflict' || saveState === 'error') && (
        <div className="document-conflict" role="alert">
          <div>
            <strong>
              {saveState === 'conflict'
                ? 'The file changed outside Kanleaf.'
                : 'Markdown could not be saved.'}
            </strong>
            <span>
              Your local Markdown is still open. Resolve this before leaving the
              account.
            </span>
          </div>
          <div className="document-conflict-actions">
            {saveState === 'error' && (
              <button
                type="button"
                onClick={() => void queueSave(contentRef.current)}
              >
                Try save
              </button>
            )}
            <button type="button" onClick={() => void copyLocal()}>
              {copyState === 'copied' ? 'Local source copied' : 'Copy local'}
            </button>
            <button type="button" onClick={() => void reloadRemote()}>
              Discard local
            </button>
          </div>
        </div>
      )}

      <div className={`document-workspace document-${mode}`}>
        {mode !== 'reading' && (
          <div className="markdown-editor" aria-label="Markdown editor">
            <Suspense
              fallback={<div className="document-state">Loading source…</div>}
            >
              <MarkdownSourceEditor
                value={content}
                onChange={changeContent}
                readOnly={readOnly}
                livePreview={mode === 'live'}
              />
            </Suspense>
          </div>
        )}
        {(mode === 'reading' || mode === 'split') && (
          <MarkdownPreview content={content} />
        )}
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
    if (
      mode === 'live' ||
      mode === 'source' ||
      mode === 'reading' ||
      mode === 'split'
    )
      return mode;
    if (mode === 'edit') return 'source';
    if (mode === 'preview') return 'reading';
  } catch {
    return 'live';
  }
  return 'live';
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
