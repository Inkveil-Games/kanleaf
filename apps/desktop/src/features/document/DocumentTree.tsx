import {
  Archive,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  MoveDown,
  MoveUp,
  Pencil,
  Plus,
} from 'lucide-react';
import {
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import {
  DropdownMenu,
  DropdownMenuItem,
} from '../../components/ui/DropdownMenu';
import { canMove, type DocumentSection, type TreeEntry } from './tree';
import type { WorkspaceDocument } from './types';

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
  onSelect: (documentId: string) => void;
  onToggleCollapsed: (documentId: string) => void;
  onStartCreate: (parentId: string | null) => void;
  onCancelCreate: () => void;
  onCreate: (title: string, parentId: string | null) => Promise<void>;
  onStartRename: (documentId: string) => void;
  onCancelRename: () => void;
  onRename: (documentId: string, title: string) => Promise<void>;
  onMove: (document: WorkspaceDocument, offset: -1 | 1) => void;
  onArchive: (documentId: string) => void;
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
  onSelect,
  onToggleCollapsed,
  onStartCreate,
  onCancelCreate,
  onCreate,
  onStartRename,
  onCancelRename,
  onRename,
  onMove,
  onArchive,
}: DocumentTreeProps) {
  const entries = sections.flatMap((section) => section.entries);

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
    <section className="collection-pane document-collection-pane">
      <header className="document-collection-header">
        <div>
          <p className="pane-eyebrow">{projectId ? 'Project' : 'Workspace'}</p>
          <h1>Library</h1>
        </div>
        {canCreate && (
          <button
            className="icon-button"
            type="button"
            aria-label="New Library note"
            onClick={() => onStartCreate(null)}
          >
            <Plus aria-hidden="true" size={16} />
          </button>
        )}
      </header>

      <div
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
                      canMoveUp={canMove(entry.document, documents, -1)}
                      canMoveDown={canMove(entry.document, documents, 1)}
                      onSelect={() => onSelect(entry.document.id)}
                      onToggleCollapsed={() =>
                        onToggleCollapsed(entry.document.id)
                      }
                      onCreateChild={() => onStartCreate(entry.document.id)}
                      onRename={() => onStartRename(entry.document.id)}
                      onMoveUp={() => onMove(entry.document, -1)}
                      onMoveDown={() => onMove(entry.document, 1)}
                      onArchive={() => onArchive(entry.document.id)}
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
      {actionError && (
        <p className="document-action-error" role="alert">
          {actionError}
        </p>
      )}
    </section>
  );
}

function DocumentTreeRow({
  entry,
  active,
  collapsed,
  canMoveUp,
  canMoveDown,
  onSelect,
  onToggleCollapsed,
  onCreateChild,
  onRename,
  onMoveUp,
  onMoveDown,
  onArchive,
}: {
  entry: TreeEntry;
  active: boolean;
  collapsed: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSelect: () => void;
  onToggleCollapsed: () => void;
  onCreateChild: () => void;
  onRename: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onArchive: () => void;
}) {
  const style = { '--tree-depth': entry.depth } as CSSProperties;
  return (
    <div className="document-tree-row" style={style} data-selected={active}>
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
        <span className="document-tree-toggle tree-spacer" aria-hidden="true" />
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
        <DropdownMenu label={`Actions for ${entry.document.title}`}>
          <DropdownMenuItem onClick={onCreateChild}>
            <FilePlus2 aria-hidden="true" size={14} /> Add nested note
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onRename}>
            <Pencil aria-hidden="true" size={14} /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!canMoveUp} onClick={onMoveUp}>
            <MoveUp aria-hidden="true" size={14} /> Move up
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!canMoveDown} onClick={onMoveDown}>
            <MoveDown aria-hidden="true" size={14} /> Move down
          </DropdownMenuItem>
          <DropdownMenuItem className="danger-menu-item" onClick={onArchive}>
            <Archive aria-hidden="true" size={14} /> Archive
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
      <input
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
      <button type="submit" aria-label={submitLabel} disabled={submitting}>
        <Plus aria-hidden="true" size={14} />
      </button>
      <button type="button" aria-label="Cancel" onClick={onCancel}>
        ×
      </button>
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
