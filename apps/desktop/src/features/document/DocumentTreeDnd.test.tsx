import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { Fragment, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentTree } from './DocumentTree';
import { AUTO_EXPAND_DELAY, INSIDE_HOVER_DELAY } from './DocumentTreeDnd';
import { buildSections, type TreeDestination } from './tree';
import type { WorkspaceDocument } from './types';
import { DocumentWorkspace } from './DocumentWorkspace';

vi.mock('../markdown/MarkdownDocument', () => ({
  MarkdownDocument: ({ target }: { target: { id: string } }) => (
    <div>Editor {target.id}</div>
  ),
}));

interface DragOperationStub {
  source?: { id: string };
  target?: {
    id: string;
    shape?: { boundingRectangle: { top: number; height: number } };
  };
  position?: { current: { y: number } };
}

interface ProviderHandlers {
  onDragStart?: (event: { operation: DragOperationStub }) => void;
  onDragMove?: (event: { operation: DragOperationStub }) => void;
  onDragEnd?: (event: { canceled: boolean }) => void;
}

const dnd = vi.hoisted(() => ({ handlers: {} as ProviderHandlers }));

vi.mock('@dnd-kit/react', () => ({
  DragDropProvider: ({
    children,
    ...handlers
  }: ProviderHandlers & { children: ReactNode }) => {
    dnd.handlers = handlers;
    return <Fragment>{children}</Fragment>;
  },
  DragOverlay: ({ children }: { children: ReactNode }) => (
    <Fragment>{children}</Fragment>
  ),
  useDraggable: () => ({
    ref: () => undefined,
    handleRef: () => undefined,
  }),
  useDroppable: () => ({ ref: () => undefined }),
}));

function note(
  id: string,
  title: string,
  position: number,
  parentId: string | null = null,
  canEdit = true,
): WorkspaceDocument {
  return {
    id,
    document_number: position + 1,
    workspace_id: 'workspace-1',
    project_id: null,
    parent_id: parentId,
    title,
    storage_name: id,
    library_path: `Wiki/${id}.md`,
    position,
    can_edit: canEdit,
    archived_at: null,
    created_at: '2026-09-13T00:00:00Z',
    updated_at: '2026-09-13T00:00:00Z',
  };
}

function renderTree(
  documents: WorkspaceDocument[],
  options: {
    collapsedIds?: ReadonlySet<string>;
    onMove?: (
      documentId: string,
      destination: TreeDestination,
    ) => Promise<void>;
    onKeepExpanded?: (documentId: string) => void;
  } = {},
) {
  const onMove = options.onMove ?? vi.fn().mockResolvedValue(undefined);
  const onKeepExpanded = options.onKeepExpanded ?? vi.fn();
  render(
    <DocumentTree
      sections={buildSections(documents, [], null)}
      documents={documents}
      projectId={null}
      selectedId="b"
      collapsedIds={options.collapsedIds ?? new Set()}
      creatingParentId={undefined}
      renamingId={null}
      canCreate
      loading={false}
      error={null}
      actionError={null}
      busyIds={new Set()}
      onSelect={vi.fn()}
      onToggleCollapsed={vi.fn()}
      onStartCreate={vi.fn()}
      onCancelCreate={vi.fn()}
      onCreate={vi.fn()}
      onStartRename={vi.fn()}
      onCancelRename={vi.fn()}
      onRename={vi.fn()}
      onMove={onMove}
      onKeepExpanded={onKeepExpanded}
      onArchive={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
  return { onKeepExpanded, onMove };
}

function start(documentId = 'b') {
  act(() => {
    dnd.handlers.onDragStart?.({ operation: { source: { id: documentId } } });
  });
}

function moveOver(targetId: string, pointerY: number) {
  act(() => {
    dnd.handlers.onDragMove?.({
      operation: {
        target: {
          id: targetId,
          shape: { boundingRectangle: { top: 0, height: 32 } },
        },
        position: { current: { y: pointerY } },
      },
    });
  });
}

function jsonResponse(payload: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function renderWorkspace(
  documents: WorkspaceDocument[],
  fetchMock: ReturnType<typeof vi.fn>,
) {
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onSelectDocument = vi.fn();
  function Harness() {
    const [selectedId, setSelectedId] = useState<string | null>('b');
    return (
      <QueryClientProvider client={client}>
        <DocumentWorkspace
          context={{ serverUrl: 'https://kanleaf.example.com', token: 'token' }}
          workspaceId="workspace-1"
          projects={[]}
          projectId={null}
          accessSettled
          canCreateWorkspaceDocuments
          selectedDocumentId={selectedId}
          onSelectDocument={(document, navigation) => {
            onSelectDocument(document, navigation);
            setSelectedId(document?.id ?? null);
            return true;
          }}
          onPrepareDocumentMutation={() => true}
          onInvalidSelection={vi.fn()}
        />
      </QueryClientProvider>
    );
  }
  render(<Harness />);
  return { client, onSelectDocument, documents };
}

describe('DocumentTree drag and drop', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('reserves a handle only for editable notes and keeps row selection separate', () => {
    renderTree([
      note('a', 'Editable', 0),
      note('b', 'Read only', 1, null, false),
    ]);

    expect(
      screen.getByRole('button', { name: 'Reorder Editable' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Reorder Read only' }),
    ).toBeNull();
    expect(
      screen.getByRole('treeitem', { name: 'Editable' }),
    ).not.toHaveAttribute('aria-grabbed');
  });

  it('keeps the middle reorder fallback stable until INSIDE activates', () => {
    renderTree([note('a', 'A', 0), note('b', 'B', 1)]);
    start();
    moveOver('a', 12);
    const target = screen.getByRole('treeitem', { name: 'A' }).parentElement!;
    expect(target).toHaveAttribute('data-drop-intent', 'before');

    moveOver('a', 20);
    act(() => vi.advanceTimersByTime(INSIDE_HOVER_DELAY - 1));
    expect(target).toHaveAttribute('data-drop-intent', 'before');

    act(() => vi.advanceTimersByTime(1));
    expect(target).toHaveAttribute('data-drop-intent', 'inside');
    expect(screen.getByRole('treeitem', { name: 'B' })).toHaveAttribute(
      'aria-level',
      '2',
    );
  });

  it('shows a temporary chevron for an active leaf INSIDE target', () => {
    renderTree([note('a', 'A', 0), note('b', 'B', 1)]);
    start();
    moveOver('a', 16);
    act(() => vi.advanceTimersByTime(INSIDE_HOVER_DELAY));

    const target = screen.getByRole('treeitem', { name: 'A' }).parentElement!;
    expect(
      target.querySelector('.document-tree-ghost-chevron'),
    ).toBeInTheDocument();
    expect(
      within(target).queryByRole('button', { name: 'Collapse A' }),
    ).toBeNull();
  });

  it('restores temporary expansion on leave and keeps it after a successful drop', async () => {
    const { onKeepExpanded } = renderTree(
      [note('a', 'A', 0), note('child', 'Child', 0, 'a'), note('b', 'B', 1)],
      { collapsedIds: new Set(['a']) },
    );
    start();
    moveOver('a', 16);
    act(() => vi.advanceTimersByTime(AUTO_EXPAND_DELAY - 1));
    expect(screen.queryByRole('treeitem', { name: 'Child' })).toBeNull();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('treeitem', { name: 'Child' })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: 'B' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    moveOver('b', 16);
    expect(screen.queryByRole('treeitem', { name: 'Child' })).toBeNull();

    moveOver('a', 16);
    act(() => vi.advanceTimersByTime(AUTO_EXPAND_DELAY));
    act(() => dnd.handlers.onDragEnd?.({ canceled: false }));
    await act(async () => Promise.resolve());
    expect(onKeepExpanded).toHaveBeenCalledWith('a');
  });

  it('cancels pending INSIDE state when the pointer leaves the target', () => {
    renderTree([note('a', 'A', 0), note('b', 'B', 1), note('c', 'C', 2)]);
    start();
    moveOver('a', 16);
    act(() => vi.advanceTimersByTime(INSIDE_HOVER_DELAY - 1));
    moveOver('c', 2);
    act(() => vi.advanceTimersByTime(INSIDE_HOVER_DELAY + 100));

    expect(
      screen.getByRole('treeitem', { name: 'A' }).parentElement,
    ).not.toHaveAttribute('data-drop-intent', 'inside');
    expect(
      screen.getByRole('treeitem', { name: 'C' }).parentElement,
    ).toHaveAttribute('data-drop-intent', 'before');
  });

  it('rejects a descendant target using the full tree', () => {
    renderTree([
      note('a', 'A', 0),
      note('child', 'Child', 0, 'a'),
      note('b', 'B', 1),
    ]);
    start('a');
    moveOver('child', 16);
    act(() => vi.advanceTimersByTime(INSIDE_HOVER_DELAY));

    expect(
      screen.getByRole('treeitem', { name: 'Child' }).parentElement,
    ).not.toHaveAttribute('data-drop-intent');
  });

  it('commits the semantic destination and clears temporary state on cancel', async () => {
    const { onMove } = renderTree([note('a', 'A', 0), note('b', 'B', 1)]);
    start();
    moveOver('a', 16);
    act(() => vi.advanceTimersByTime(INSIDE_HOVER_DELAY));
    act(() => dnd.handlers.onDragEnd?.({ canceled: false }));
    await act(async () => Promise.resolve());

    expect(onMove).toHaveBeenCalledWith('b', { parentId: 'a', index: 0 });

    start();
    moveOver('a', 16);
    act(() => dnd.handlers.onDragEnd?.({ canceled: true }));
    expect(
      screen.getByRole('treeitem', { name: 'A' }).parentElement,
    ).not.toHaveAttribute('data-drop-intent');
  });
});

describe('DocumentWorkspace optimistic move', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the preview after drop and reconciles authoritative paths', async () => {
    const documents = [note('a', 'A', 0), note('b', 'B', 1)];
    let resolveMove!: (response: Response) => void;
    const moveResponse = new Promise<Response>((resolve) => {
      resolveMove = resolve;
    });
    const fetchMock = vi.fn((url: string, request?: RequestInit) => {
      if (request?.method === 'PUT' && url.endsWith('/b/move')) {
        return moveResponse;
      }
      return jsonResponse(documents);
    });
    const { client, onSelectDocument } = renderWorkspace(documents, fetchMock);
    await screen.findByText('Editor b');

    start();
    moveOver('a', 2);
    act(() => dnd.handlers.onDragEnd?.({ canceled: false }));
    await act(async () => Promise.resolve());

    expect(
      screen.getAllByRole('treeitem').map((item) => item.textContent),
    ).toEqual(['B', 'A']);
    expect(
      [
        ...(client.getQueryData<WorkspaceDocument[]>([
          'documents',
          'workspace-1',
          'all',
        ]) ?? []),
      ]
        .sort((left, right) => left.position - right.position)
        .map(({ id }) => id),
    ).toEqual(['b', 'a']);
    expect(onSelectDocument).not.toHaveBeenCalled();

    resolveMove(
      new Response(
        JSON.stringify({
          documents: [
            {
              id: 'b',
              parent_id: null,
              position: 0,
              library_path: 'Wiki/server-normalized-b.md',
              updated_at: '2026-09-13T01:00:00Z',
            },
            {
              id: 'a',
              parent_id: null,
              position: 1,
              library_path: 'Wiki/a.md',
              updated_at: '2026-09-13T01:00:00Z',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    expect(
      await screen.findByText('Wiki/server-normalized-b.md'),
    ).toBeVisible();
    expect(onSelectDocument).not.toHaveBeenCalled();
  });

  it('rolls every list cache back exactly when move persistence fails', async () => {
    const documents = [note('a', 'A', 0), note('b', 'B', 1)];
    let rejectMove!: (error: Error) => void;
    const moveResponse = new Promise<Response>((_resolve, reject) => {
      rejectMove = reject;
    });
    const fetchMock = vi.fn((url: string, request?: RequestInit) => {
      if (request?.method === 'PUT' && url.endsWith('/b/move')) {
        return moveResponse;
      }
      return jsonResponse(documents);
    });
    const { client } = renderWorkspace(documents, fetchMock);
    client.setQueryData(['documents', 'workspace-1', 'secondary'], documents);
    await screen.findByText('Editor b');

    start();
    moveOver('a', 2);
    act(() => dnd.handlers.onDragEnd?.({ canceled: false }));
    await act(async () => Promise.resolve());
    expect(
      screen.getAllByRole('treeitem').map((item) => item.textContent),
    ).toEqual(['B', 'A']);

    await act(async () => rejectMove(new Error('Move transaction failed')));
    await waitFor(() =>
      expect(
        screen.getAllByRole('treeitem').map((item) => item.textContent),
      ).toEqual(['A', 'B']),
    );
    expect(
      client.getQueryData(['documents', 'workspace-1', 'secondary']),
    ).toEqual(documents);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Move transaction failed',
    );
  });
});
