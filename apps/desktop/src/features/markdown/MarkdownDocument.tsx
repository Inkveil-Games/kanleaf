import { useQuery } from '@tanstack/react-query';
import { Code2, Pencil, RotateCcw } from 'lucide-react';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Button } from '../../components/ui/Button';
import { CopyButton } from '../../components/ui/CopyButton';
import { InlineAlert } from '../../components/ui/InlineAlert';
import { LoadError } from '../../components/ui/LoadError';
import { ScrollArea } from '../../components/ui/ScrollArea';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { ApiError } from '../../lib/api/client';
import {
  readMarkdownAsset,
  readMarkdownDocument,
  uploadMarkdownImage,
  writeMarkdownDocument,
  type MarkdownTarget,
} from './api';
import { useDocumentSaveCoordinator } from './documentSaveCoordinatorContext';
import { MarkdownPreview } from './MarkdownPreview';
import { visualEditingSupport } from './visualEditingSupport';
import type {
  MarkdownEditorHandle,
  MarkdownViewport,
} from './markdownViewport';

const MarkdownSourceEditor = lazy(() =>
  import('./MarkdownSourceEditor').then((module) => ({
    default: module.MarkdownSourceEditor,
  })),
);
const MilkdownEditor = lazy(() =>
  import('./MilkdownEditor').then((module) => ({
    default: module.MilkdownEditor,
  })),
);

type EditingTab = 'editor' | 'source';
type SaveState = 'saved' | 'unsaved' | 'saving' | 'conflict' | 'error';
const AUTOSAVE_DELAY_MS = 800;

interface MarkdownDocumentProps {
  serverUrl: string;
  token: string;
  workspaceId: string;
  target: MarkdownTarget;
  readOnly?: boolean;
  documentContext?: ReactNode;
}

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
      <DocumentFrame contextual={Boolean(props.documentContext)}>
        <header className="document-toolbar document-toolbar-pending">
          <span>Markdown</span>
          <span className="save-indicator" role="status">
            Loading…
          </span>
        </header>
        <div className="document-state" aria-live="polite">
          Loading document…
        </div>
      </DocumentFrame>
    );
  }
  if (document.error) {
    return (
      <DocumentFrame contextual={Boolean(props.documentContext)}>
        <header className="document-toolbar document-toolbar-pending">
          <span>Markdown</span>
          <span className="save-indicator">Unavailable</span>
        </header>
        <LoadError
          title="Document unavailable"
          description={errorMessage(document.error)}
          onRetry={() => void document.refetch()}
          retrying={document.isFetching}
        />
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
  documentContext,
}: LoadedMarkdownDocumentProps) {
  const [draft, setDraft] = useState(initialContent);
  const [tab, setTab] = useState<EditingTab>(() =>
    visualEditingSupport(initialContent).supported ? 'editor' : 'source',
  );
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState<string | null>(
    () => visualEditingSupport(initialContent).reason ?? null,
  );
  const draftRef = useRef(draft);
  const savedRef = useRef(initialContent);
  const revisionRef = useRef(initialRevision);
  const conflictRef = useRef(false);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const autosaveTimeoutRef = useRef<number | undefined>(undefined);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const [viewport, setViewport] = useState<MarkdownViewport | null>(null);
  function switchTab(next: EditingTab) {
    if (next === tab) return;
    setViewport(editorRef.current?.captureViewport() ?? null);
    setTab(next);
  }
  const { registerDocumentSave } = useDocumentSaveCoordinator();
  const context = useMemo(
    () => ({
      serverUrl,
      token,
      workspaceId,
      target: { kind: target.kind, id: target.id } as MarkdownTarget,
    }),
    [serverUrl, target.id, target.kind, token, workspaceId],
  );

  const changeDraft = useCallback((next: string) => {
    draftRef.current = next;
    setDraft(next);
    setSaveError(null);
    setSaveState(next === savedRef.current ? 'saved' : 'unsaved');
  }, []);

  const persist = useCallback(
    async (nextContent: string) => {
      window.clearTimeout(autosaveTimeoutRef.current);
      autosaveTimeoutRef.current = undefined;
      if (readOnly) return true;
      if (conflictRef.current) return false;
      if (nextContent === savedRef.current) {
        setSaveState('saved');
        return true;
      }
      setSaveState('saving');
      setSaveError(null);
      const save = saveChainRef.current
        .catch(() => undefined)
        .then(async () => {
          const saved = await writeMarkdownDocument(
            context,
            nextContent,
            revisionRef.current,
          );
          savedRef.current = nextContent;
          revisionRef.current = saved.revision;
        });
      saveChainRef.current = save;
      try {
        await save;
        setSaveState(
          draftRef.current === savedRef.current ? 'saved' : 'unsaved',
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
    [context, readOnly],
  );

  const flushForTransition = useCallback(async () => {
    if (!(await persist(draftRef.current))) {
      throw new Error('Resolve unsaved Markdown before leaving this document');
    }
  }, [persist]);

  useEffect(() => {
    if (readOnly) return;
    return registerDocumentSave(flushForTransition);
  }, [flushForTransition, readOnly, registerDocumentSave]);

  useEffect(() => {
    if (readOnly || draft === savedRef.current || conflictRef.current) return;
    const timeout = window.setTimeout(
      () => void persist(draft),
      AUTOSAVE_DELAY_MS,
    );
    autosaveTimeoutRef.current = timeout;
    return () => {
      window.clearTimeout(timeout);
      if (autosaveTimeoutRef.current === timeout) {
        autosaveTimeoutRef.current = undefined;
      }
    };
  }, [draft, persist, readOnly]);

  useEffect(() => {
    function saveShortcut(event: KeyboardEvent) {
      if (
        !readOnly &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === 's'
      ) {
        event.preventDefault();
        void persist(draftRef.current);
      }
    }
    window.addEventListener('keydown', saveShortcut);
    return () => window.removeEventListener('keydown', saveShortcut);
  }, [persist, readOnly]);

  useEffect(
    () => () => {
      if (
        !readOnly &&
        !conflictRef.current &&
        draftRef.current !== savedRef.current
      ) {
        void persist(draftRef.current);
      }
    },
    [persist, readOnly],
  );

  async function reloadRemote() {
    try {
      const remote = await readMarkdownDocument(context);
      draftRef.current = remote.content;
      savedRef.current = remote.content;
      revisionRef.current = remote.revision;
      conflictRef.current = false;
      setDraft(remote.content);
      setViewport(null);
      setTab(
        visualEditingSupport(remote.content).supported ? 'editor' : 'source',
      );
      setSaveError(null);
      setSaveState('saved');
    } catch (caught) {
      setSaveError(errorMessage(caught));
      setSaveState('error');
    }
  }

  const uploadImage = useCallback(
    async (file: File) => (await uploadMarkdownImage(context, file)).reference,
    [context],
  );
  const resolveAsset = useCallback(
    (reference: string) => readMarkdownAsset(context, reference),
    [context],
  );

  return (
    <DocumentFrame contextual={Boolean(documentContext)}>
      <header className="document-toolbar">
        {readOnly ? (
          <span className="document-reading-label">Markdown</span>
        ) : (
          <SegmentedControl<EditingTab>
            className="document-modes"
            aria-label="Editing mode"
            value={tab}
            onValueChange={switchTab}
            options={[
              {
                value: 'editor',
                label: (
                  <>
                    <Pencil aria-hidden="true" size={14} />
                    Editor
                  </>
                ),
                tooltip: 'Visual Markdown editor',
                disabled: !visualEditingSupport(draft).supported,
              },
              {
                value: 'source',
                label: (
                  <>
                    <Code2 aria-hidden="true" size={14} />
                    Source
                  </>
                ),
                tooltip: 'Markdown source editor',
              },
            ]}
          />
        )}
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
            >
              {saveLabel(saveState)}
            </span>
          </div>
        )}
      </header>

      {documentContext && (
        <div className="document-context">{documentContext}</div>
      )}

      {(saveState === 'conflict' || saveState === 'error') && (
        <div className="document-conflict" role="alert">
          <div>
            <strong>
              {saveState === 'conflict'
                ? 'The file changed outside Kanleaf.'
                : 'Markdown could not be saved.'}
            </strong>
            <span>Your local draft remains open.</span>
          </div>
          <div className="document-conflict-actions">
            <CopyButton
              text={draft}
              label="Copy local"
              successLabel="Local source copied"
              errorLabel="Could not copy. Open Source to select and copy your draft."
            />
            {saveState === 'error' && (
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={() => void persist(draftRef.current)}
              >
                Try save
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => void reloadRemote()}
            >
              <RotateCcw aria-hidden="true" size={14} />
              Discard local
            </Button>
          </div>
        </div>
      )}

      {readOnly ? (
        <ScrollArea className="markdown-preview-scroll-area" orientation="both">
          <MarkdownPreview content={draft} assetContext={context} />
        </ScrollArea>
      ) : (
        <div className={`document-workspace document-${tab}`}>
          {saveError && saveState === 'saved' && (
            <InlineAlert className="document-source-advisory">
              {saveError}
            </InlineAlert>
          )}
          <div className="markdown-editor" aria-label="Markdown editor">
            <Suspense
              fallback={<div className="document-state">Loading editor…</div>}
            >
              {tab === 'editor' ? (
                <MilkdownEditor
                  ref={editorRef}
                  initialViewport={viewport}
                  value={draft}
                  onChange={changeDraft}
                  uploadImage={uploadImage}
                  resolveAsset={resolveAsset}
                />
              ) : (
                <MarkdownSourceEditor
                  ref={editorRef}
                  initialViewport={viewport}
                  value={draft}
                  onChange={changeDraft}
                />
              )}
            </Suspense>
          </div>
        </div>
      )}
    </DocumentFrame>
  );
}

function DocumentFrame({
  children,
  contextual = false,
}: {
  children: ReactNode;
  contextual?: boolean;
}) {
  return (
    <section
      className={`task-document${contextual ? ' task-document-contextual' : ''}`}
      aria-labelledby="document-heading"
    >
      <h2 id="document-heading" className="sr-only">
        Markdown document
      </h2>
      {children}
    </section>
  );
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
