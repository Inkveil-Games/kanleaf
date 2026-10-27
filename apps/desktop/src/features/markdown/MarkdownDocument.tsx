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
import { Tooltip } from '../../components/ui/Tooltip';
import { ApiError } from '../../lib/api/client';
import {
  readMarkdownAsset,
  readMarkdownDocument,
  uploadMarkdownImage,
  writeMarkdownDocument,
  type MarkdownTarget,
} from './api';
import {
  UnsavedDocumentError,
  useDocumentSaveCoordinator,
} from './documentSaveCoordinatorContext';
import { InternalLinkPicker } from './InternalLinkPicker';
import {
  useInternalLinkIndex,
  useInternalLinkNavigation,
} from './internalLinkContext';
import {
  InternalLinkController,
  type InternalLinkEdit,
  type InternalLinkTrigger,
} from './internalLinkController';
import { InternalLinkEditor } from './InternalLinkEditor';
import {
  parseInternalLink,
  searchInternalLinks,
  type InternalLinkEntry,
} from './internalLinks';
import { MarkdownPreview } from './MarkdownPreview';
import { useDocumentOutline } from './useDocumentOutline';
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
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(
    () => visualEditingSupport(initialContent).reason ?? null,
  );
  const draftRef = useRef(draft);
  const savedRef = useRef(initialContent);
  const revisionRef = useRef(initialRevision);
  const conflictRef = useRef(false);
  const saveErrorRef = useRef<string | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const autosaveTimeoutRef = useRef<number | undefined>(undefined);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const [viewport, setViewport] = useState<MarkdownViewport | null>(null);
  const scrollHostRef = useRef<HTMLDivElement>(null);
  useDocumentOutline({
    draft,
    mode: readOnly ? 'preview' : tab,
    editorRef,
    scrollHostRef,
  });
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
  const linkIndex = useInternalLinkIndex(context);
  const linkNavigation = useInternalLinkNavigation();
  const [internalLinks] = useState(() => new InternalLinkController());
  const [linkTrigger, setLinkTrigger] = useState<InternalLinkTrigger | null>(
    null,
  );
  const [linkActive, setLinkActive] = useState(0);
  const [linkEdit, setLinkEdit] = useState<InternalLinkEdit | null>(null);
  const closeLinkEdit = useCallback(() => setLinkEdit(null), []);
  const linkResults = useMemo(
    () =>
      linkTrigger && linkIndex
        ? searchInternalLinks(linkIndex, linkTrigger.query)
        : [],
    [linkIndex, linkTrigger],
  );
  const linkStateRef = useRef({ linkTrigger, linkResults, linkActive });
  const dismissedLinkRef = useRef<number | null>(null);
  const pickLinkRef = useRef<(entry: InternalLinkEntry) => void>(
    () => undefined,
  );

  useEffect(() => {
    linkStateRef.current = { linkTrigger, linkResults, linkActive };
  }, [linkActive, linkResults, linkTrigger]);

  useEffect(() => {
    internalLinks.setIndex(linkIndex);
  }, [internalLinks, linkIndex]);

  useEffect(() => {
    const pick = (entry: InternalLinkEntry) => {
      const trigger = linkStateRef.current.linkTrigger;
      if (!trigger || !linkIndex) return;
      trigger.insert(linkIndex.linkTarget(entry));
      setLinkTrigger(null);
    };
    const onTrigger = (trigger: InternalLinkTrigger | null) => {
      if (!trigger) {
        dismissedLinkRef.current = null;
        setLinkTrigger(null);
        return;
      }
      // Escape keeps this `[[` closed until the caret leaves it.
      if (dismissedLinkRef.current === trigger.from) return;
      if (linkStateRef.current.linkTrigger?.query !== trigger.query) {
        setLinkActive(0);
      }
      setLinkTrigger(trigger);
    };
    const onKey = (key: string) => {
      const {
        linkTrigger: trigger,
        linkResults: results,
        linkActive: active,
      } = linkStateRef.current;
      if (!trigger) return false;
      if (key === 'Escape') {
        dismissedLinkRef.current = trigger.from;
        setLinkTrigger(null);
        return true;
      }
      if (results.length === 0) return false;
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        const step = key === 'ArrowDown' ? 1 : -1;
        setLinkActive(
          (current) => (current + step + results.length) % results.length,
        );
        return true;
      }
      const entry = results[active];
      if (!entry) return false;
      pick(entry);
      return true;
    };
    const onOpen = (raw: string) => {
      const parts = parseInternalLink(raw);
      const entry = parts ? linkIndex?.resolve(parts.target) : null;
      if (entry) linkNavigation?.open(entry);
    };
    internalLinks.setHandlers({
      onTrigger,
      onKey,
      onOpen,
      onEdit: setLinkEdit,
    });
    pickLinkRef.current = pick;
  }, [internalLinks, linkIndex, linkNavigation]);

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
          setLastSavedAt(new Date());
        });
      saveChainRef.current = save;
      try {
        await save;
        setSaveState(
          draftRef.current === savedRef.current ? 'saved' : 'unsaved',
        );
        return true;
      } catch (caught) {
        saveErrorRef.current = errorMessage(caught);
        setSaveError(saveErrorRef.current);
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

  const reloadRemote = useCallback(async () => {
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
  }, [context]);

  const flushForTransition = useCallback(async () => {
    if (await persist(draftRef.current)) return;
    throw new UnsavedDocumentError(
      conflictRef.current ? 'conflict' : 'error',
      saveErrorRef.current ?? '',
      draftRef.current,
      () => persist(draftRef.current),
      reloadRemote,
    );
  }, [persist, reloadRemote]);

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

  async function discardLocal() {
    try {
      await reloadRemote();
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
            <Tooltip
              placement="bottom"
              label={saveDetail(saveState, lastSavedAt, saveError)}
              trigger={
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
              }
            />
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
              onClick={() => void discardLocal()}
            >
              <RotateCcw aria-hidden="true" size={14} />
              Discard local
            </Button>
          </div>
        </div>
      )}

      {readOnly ? (
        <ScrollArea
          ref={scrollHostRef}
          className="markdown-preview-scroll-area"
          orientation="both"
        >
          <MarkdownPreview
            content={draft}
            assetContext={context}
            internalLinks={internalLinks}
          />
        </ScrollArea>
      ) : (
        <div
          ref={scrollHostRef}
          className={`document-workspace document-${tab}`}
        >
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
                  internalLinks={internalLinks}
                />
              ) : (
                <MarkdownSourceEditor
                  ref={editorRef}
                  initialViewport={viewport}
                  value={draft}
                  onChange={changeDraft}
                  internalLinks={internalLinks}
                />
              )}
            </Suspense>
            {linkEdit && (
              <InternalLinkEditor
                key={linkEdit.raw}
                edit={linkEdit}
                index={linkIndex}
                onOpen={(raw) => internalLinks.onOpen(raw)}
                onClose={closeLinkEdit}
              />
            )}
            {linkTrigger && (
              <InternalLinkPicker
                trigger={linkTrigger}
                results={linkResults}
                activeIndex={linkActive}
                loading={!linkIndex}
                onHover={setLinkActive}
                onPick={(entry) => pickLinkRef.current(entry)}
              />
            )}
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

function saveDetail(
  state: SaveState,
  lastSavedAt: Date | null,
  error: string | null,
) {
  if (state === 'saving') return 'Saving your latest edits';
  if (state === 'unsaved') return 'Edits save automatically in a moment';
  if (state === 'error' || state === 'conflict') {
    return error ?? 'Markdown could not be saved';
  }
  return lastSavedAt
    ? `Saved at ${lastSavedAt.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })}`
    : 'No edits since this note opened';
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
