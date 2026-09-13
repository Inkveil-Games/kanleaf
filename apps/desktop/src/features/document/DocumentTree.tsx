import {
  Archive,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import {
  useEffect,
  useState,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../../components/ui/DropdownMenu';
import { IconButton } from '../../components/ui/IconButton';
import { Input } from '../../components/ui/Input';
import { DocumentTreeDnd } from './DocumentTreeDnd';
import type { DocumentSection, TreeDestination, TreeEntry } from './tree';
import type { WorkspaceDocument } from './types';
import { useDocumentTreeRowDnd } from './useDocumentTreeRowDnd';

interface DocumentTreeProps {
  sections: DocumentSection[];
  documents: WorkspaceDocument[];
  projectId: string | null;
  selectedId: string | null;
  collapsedIds: ReadonlySet<string>;
  creatingParentId: string | null | undefined;
  renamingId: string | null;
  canCreate: boolean;
  loading: boolean;
  error: string | null;
  actionError: string | null;
  busyIds: ReadonlySet<string>;
  onSelect: (documentId: string) => void;
  onToggleCollapsed: (documentId: string) => void;
  onStartCreate: (parentId: string | null) => void;
  onCancelCreate: () => void;
  onCreate: (title: string, parentId: string | null) => Promise<void>;
  onStartRename: (documentId: string) => void;
  onCancelRename: () => void;
  onRename: (documentId: string, title: string) => Promise<void>;
  onMove: (documentId: string, destination: TreeDestination) => Promise<void>;
  onKeepExpanded: (documentId: string) => void;
  onArchive: (documentId: string) => void;
  onDelete: (documentId: string) => void;
}

export function DocumentTree({
  sections,
  documents,
  projectId,
  selectedId,
  collapsedIds,
  creatingParentId,
  renamingId,
  canCreate,
  loading,
  error,
  actionError,
  busyIds,
  onSelect,
  onToggleCollapsed,
  onStartCreate,
  onCancelCreate,
  onCreate,
  onStartRename,
  onCancelRename,
  onRename,
  onMove,
  onKeepExpanded,
  onArchive,
  onDelete,
}: DocumentTreeProps) {
  return (
    <section className="collection-pane document-collection-pane">
      <header className="document-collection-header">
        <div>
          <p className="pane-eyebrow">{projectId ? 'Project' : 'Workspace'}</p>
          <h1>Library</h1>
        </div>
        {canCreate && (
          <IconButton
            variant="ghost"
            size="sm"
            type="button"
            aria-label="New Library note"
            onClick={() => onStartCreate(null)}
          >
            <Plus aria-hidden="true" size={16} />
          </IconButton>
        )}
      </header>

      <DocumentTreeDnd
        collapsedIds={collapsedIds}
        documents={documents}
        sections={sections}
        busyIds={busyIds}
        onKeepExpanded={onKeepExpanded}
        onMove={onMove}
      >
        {({ sections: visible, collapsedIds: effectiveCollapsedIds }) => (
          <DocumentTreeContent
            sections={visible}
            projectId={projectId}
            selectedId={selectedId}
            collapsedIds={effectiveCollapsedIds}
            creatingParentId={creatingParentId}
            renamingId={renamingId}
            canCreate={canCreate}
            loading={loading}
            error={error}
            onSelect={onSelect}
            onToggleCollapsed={onToggleCollapsed}
            onStartCreate={onStartCreate}
            onCancelCreate={onCancelCreate}
            onCreate={onCreate}
            onStartRename={onStartRename}
            onCancelRename={onCancelRename}
            onRename={onRename}
            onArchive={onArchive}
            onDelete={onDelete}
          />
        )}
      </DocumentTreeDnd>
      {actionError && (
        <p className="document-action-error" role="alert">
          {actionError}
        </p>
      )}
    </section>
  );
}

function DocumentTreeContent({
  sections,
  projectId,
  selectedId,
  collapsedIds,
  creatingParentId,
  renamingId,
  canCreate,
  loading,
  error,
  onSelect,
  onToggleCollapsed,
  onStartCreate,
  onCancelCreate,
  onCreate,
  onStartRename,
  onCancelRename,
  onRename,
  onArchive,
  onDelete,
}: Omit<
  DocumentTreeProps,
  'documents' | 'actionError' | 'busyIds' | 'onMove' | 'onKeepExpanded'
>) {
  const entries = sections.flatMap((section) => section.entries);
  const treeRef = useRef<HTMLDivElement>(null);
  useTreeLayoutAnimation(
    treeRef,
    entries.map(({ document, depth }) => `${document.id}:${depth}`).join('|'),
  );

  function treeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!selectedId || entries.length === 0) return;
    const index = entries.findIndex(
      ({ document }) => document.id === selectedId,
    );
    const current = entries[index];
    if (!current) return;
    let nextId: string | null;
    if (event.key === 'ArrowDown') {
      nextId =
        entries[Math.min(index + 1, entries.length - 1)]?.document.id ?? null;
    } else if (event.key === 'ArrowUp') {
      nextId = entries[Math.max(index - 1, 0)]?.document.id ?? null;
    } else if (event.key === 'ArrowRight') {
      if (current.hasChildren && collapsedIds.has(current.document.id)) {
        onToggleCollapsed(current.document.id);
        event.preventDefault();
        return;
      }
      nextId = current.hasChildren
        ? (entries.find(
            ({ document }) => document.parent_id === current.document.id,
          )?.document.id ?? null)
        : null;
    } else if (event.key === 'ArrowLeft') {
      if (current.hasChildren && !collapsedIds.has(current.document.id)) {
        onToggleCollapsed(current.document.id);
        event.preventDefault();
        return;
      }
      nextId = current.document.parent_id;
    } else if (event.key === 'F2' && current.document.can_edit) {
      onStartRename(current.document.id);
      event.preventDefault();
      return;
    } else {
      return;
    }
    if (nextId) onSelect(nextId);
    event.preventDefault();
  }

  return (
    <div
      ref={treeRef}
      className="document-tree-scroll"
      role="tree"
      aria-label={projectId ? 'Project Library' : 'Workspace Library'}
      tabIndex={0}
      onKeyDown={treeKeyDown}
    >
      {creatingParentId === null && (
        <DocumentNameForm
          label="Note title"
          submitLabel="Create note"
          onCancel={onCancelCreate}
          onSubmit={(title) => onCreate(title, null)}
        />
      )}
      {loading ? (
        <DocumentCollectionState>Loading Library…</DocumentCollectionState>
      ) : error ? (
        <DocumentCollectionState error>{error}</DocumentCollectionState>
      ) : sections.length === 0 ? (
        <DocumentCollectionState>
          {canCreate
            ? 'Create a Markdown note to start this Library.'
            : 'No Library notes are available in this scope.'}
        </DocumentCollectionState>
      ) : (
        sections.map((section) => (
          <section className="document-tree-section" key={section.id}>
            {!projectId && <h2>{section.label}</h2>}
            {section.entries.map((entry) => (
              <div key={entry.document.id}>
                {renamingId === entry.document.id ? (
                  <DocumentNameForm
                    label="Note title"
                    initialValue={entry.document.title}
                    submitLabel="Rename note"
                    depth={entry.depth}
                    onCancel={onCancelRename}
                    onSubmit={(title) => onRename(entry.document.id, title)}
                  />
                ) : (
                  <DocumentTreeRow
                    entry={entry}
                    active={entry.document.id === selectedId}
                    collapsed={collapsedIds.has(entry.document.id)}
                    onSelect={() => onSelect(entry.document.id)}
                    onToggleCollapsed={() =>
                      onToggleCollapsed(entry.document.id)
                    }
                    onCreateChild={() => onStartCreate(entry.document.id)}
                    onRename={() => onStartRename(entry.document.id)}
                    onArchive={() => onArchive(entry.document.id)}
                    onDelete={() => onDelete(entry.document.id)}
                  />
                )}
                {creatingParentId === entry.document.id && (
                  <DocumentNameForm
                    label="Nested note title"
                    submitLabel="Create nested note"
                    depth={entry.depth + 1}
                    onCancel={onCancelCreate}
                    onSubmit={(title) => onCreate(title, entry.document.id)}
                  />
                )}
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  );
}

function useTreeLayoutAnimation(
  treeRef: RefObject<HTMLDivElement | null>,
  layoutKey: string,
) {
  const previousPositions = useRef(new Map<string, DOMRect>());
  const runningAnimations = useRef(new Map<HTMLElement, Animation>());
  useLayoutEffect(() => {
    const rows = treeRef.current?.querySelectorAll<HTMLElement>(
      '[data-document-tree-id]',
    );
    if (!rows) return;
    for (const animation of runningAnimations.current.values()) {
      animation.cancel();
    }
    runningAnimations.current.clear();
    const nextPositions = new Map<string, DOMRect>();
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    for (const row of rows) {
      const documentId = row.dataset.documentTreeId;
      if (!documentId) continue;
      const next = row.getBoundingClientRect();
      nextPositions.set(documentId, next);
      const previous = previousPositions.current.get(documentId);
      if (
        !previous ||
        reduceMotion ||
        row.dataset.dragging === 'true' ||
        typeof row.animate !== 'function'
      )
        continue;
      const x = previous.left - next.left;
      const y = previous.top - next.top;
      if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) continue;
      const animation = row.animate(
        [
          { transform: `translate(${x}px, ${y}px)` },
          { transform: 'translate(0, 0)' },
        ],
        { duration: 140, easing: 'ease-out' },
      );
      runningAnimations.current.set(row, animation);
      const clearAnimation = () => {
        if (runningAnimations.current.get(row) === animation) {
          runningAnimations.current.delete(row);
        }
      };
      animation.onfinish = clearAnimation;
      animation.oncancel = clearAnimation;
    }
    previousPositions.current = nextPositions;
  }, [layoutKey, treeRef]);
  useEffect(
    () => () => {
      for (const animation of runningAnimations.current.values()) {
        animation.cancel();
      }
      runningAnimations.current.clear();
    },
    [],
  );
}

function DocumentTreeRow({
  entry,
  active,
  collapsed,
  onSelect,
  onToggleCollapsed,
  onCreateChild,
  onRename,
  onArchive,
  onDelete,
}: {
  entry: TreeEntry;
  active: boolean;
  collapsed: boolean;
  onSelect: () => void;
  onToggleCollapsed: () => void;
  onCreateChild: () => void;
  onRename: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const { ref, handleRef, disabled, isDragging, dropIntent } =
    useDocumentTreeRowDnd(entry.document);
  const temporaryChevron = dropIntent === 'inside' && !entry.hasChildren;
  const style = { '--tree-depth': entry.depth } as CSSProperties;
  return (
    <div
      ref={ref}
      className="document-tree-row"
      style={style}
      data-document-tree-id={entry.document.id}
      data-selected={active}
      data-dragging={isDragging || undefined}
      data-drop-intent={dropIntent ?? undefined}
    >
      {entry.document.can_edit ? (
        <button
          ref={handleRef as (element: HTMLButtonElement | null) => void}
          className="document-tree-drag-handle"
          type="button"
          aria-label={`Reorder ${entry.document.title}`}
          disabled={disabled}
          title="Drag or press Space, then use arrow keys"
        >
          <GripVertical aria-hidden="true" size={14} />
        </button>
      ) : (
        <span className="document-tree-drag-spacer" aria-hidden="true" />
      )}
      {entry.hasChildren ? (
        <button
          className="document-tree-toggle"
          type="button"
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${entry.document.title}`}
          aria-expanded={!collapsed}
          onClick={onToggleCollapsed}
        >
          {collapsed ? (
            <ChevronRight aria-hidden="true" size={13} />
          ) : (
            <ChevronDown aria-hidden="true" size={13} />
          )}
        </button>
      ) : (
        <span
          className="document-tree-chevron-slot"
          data-open={temporaryChevron}
          aria-hidden="true"
        >
          <ChevronDown className="document-tree-ghost-chevron" size={13} />
        </span>
      )}
      <button
        className="document-tree-main"
        type="button"
        role="treeitem"
        aria-level={entry.depth + 1}
        aria-selected={active}
        aria-expanded={entry.hasChildren ? !collapsed : undefined}
        onClick={onSelect}
      >
        <FileText aria-hidden="true" size={14} />
        <span>{entry.document.title}</span>
      </button>
      {entry.document.can_edit && (
        <DropdownMenu
          label={`Actions for ${entry.document.title}`}
          disabled={disabled}
        >
          <DropdownMenuItem onClick={onCreateChild}>
            <FilePlus2 aria-hidden="true" size={14} /> Add nested note
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onRename}>
            <Pencil aria-hidden="true" size={14} /> Rename
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onArchive}>
            <Archive aria-hidden="true" size={14} /> Archive
          </DropdownMenuItem>
          <DropdownMenuItem className="danger-menu-item" onClick={onDelete}>
            <Trash2 aria-hidden="true" size={14} /> Delete permanently
          </DropdownMenuItem>
        </DropdownMenu>
      )}
    </div>
  );
}

function DocumentNameForm({
  label,
  initialValue = '',
  submitLabel,
  depth = 0,
  onSubmit,
  onCancel,
}: {
  label: string;
  initialValue?: string;
  submitLabel: string;
  depth?: number;
  onSubmit: (title: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(title);
    } catch (caught) {
      setError(errorMessage(caught));
      setSubmitting(false);
    }
  }

  return (
    <form
      className="document-name-form"
      style={{ '--tree-depth': depth } as CSSProperties}
      onSubmit={(event) => void submit(event)}
    >
      <Input
        autoFocus
        required
        maxLength={300}
        aria-label={label}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
        }}
      />
      <IconButton
        variant="primary"
        size="sm"
        type="submit"
        loading={submitting}
        aria-label={submitLabel}
      >
        <Plus aria-hidden="true" size={14} />
      </IconButton>
      <IconButton
        variant="ghost"
        size="sm"
        type="button"
        aria-label="Cancel"
        onClick={onCancel}
      >
        <X aria-hidden="true" size={14} />
      </IconButton>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

function DocumentCollectionState({
  children,
  error = false,
}: {
  children: string;
  error?: boolean;
}) {
  return (
    <p className="document-collection-state" role={error ? 'alert' : 'status'}>
      {children}
    </p>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Library request failed';
}
