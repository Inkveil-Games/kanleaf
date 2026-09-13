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
  onDragMove?: (event: {
    operation: DragOperationStub;
    to?: { y: number };
    by?: { y: number };
    nativeEvent?: Event;
  }) => void;
  onDragOver?: (event: { operation: DragOperationStub }) => void;
  onDragEnd?: (event: {
    canceled: boolean;
    operation: DragOperationStub;
  }) => void;
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

function moveOver(targetId: string, pointerY: number, rowTop = 0) {
  act(() => {
    dnd.handlers.onDragOver?.({
      operation: {
        target: {
          id: targetId,
          shape: { boundingRectangle: { top: rowTop, height: 32 } },
        },
        position: { current: { y: pointerY } },
      },
    });
  });
}

function moveWithin(
  targetId: string,
  currentY: number,
  nextY: number,
  options: { keyboard?: boolean; rowTop?: number } = {},
) {
  act(() => {
    dnd.handlers.onDragMove?.({
      operation: {
        target: {
          id: targetId,
          shape: {
            boundingRectangle: { top: options.rowTop ?? 0, height: 32 },
          },
        },
        position: { current: { y: currentY } },
      },
      to: options.keyboard ? undefined : { y: nextY },
      by: options.keyboard ? { y: nextY - currentY } : undefined,
      nativeEvent: options.keyboard
        ? new KeyboardEvent('keydown', { key: 'ArrowUp' })
        : new PointerEvent('pointermove'),
    });
  });
}

function endDrag(canceled: boolean, targetId: string | null = 'a') {
  act(() => {
    dnd.handlers.onDragEnd?.({
      canceled,
      operation: {
        target: targetId ? { id: targetId } : undefined,
      },
    });
  });
}

function treeOrder() {
  return screen.getAllByRole('treeitem').map((item) => item.textContent);
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
    vi.unstubAllGlobals();
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

  it('keeps document order unchanged when a drag starts', () => {
    renderTree([note('a', 'A', 0), note('b', 'B', 1)]);

    start();

    expect(treeOrder()).toEqual(['A', 'B']);
    expect(
      screen.getByRole('treeitem', { name: 'B' }).parentElement,
    ).toHaveAttribute('data-dragging', 'true');
  });

  it('shows before and after indicators without reordering the visible tree', () => {
    renderTree([note('a', 'A', 0), note('b', 'B', 1), note('c', 'C', 2)]);
    start();

    moveOver('a', 2);
    expect(
      screen.getByRole('treeitem', { name: 'A' }).parentElement,
    ).toHaveAttribute('data-drop-intent', 'before');
    expect(screen.getByRole('status')).toHaveTextContent('Move B before A.');
    expect(treeOrder()).toEqual(['A', 'B', 'C']);

    moveOver('c', 30);
    expect(
      screen.getByRole('treeitem', { name: 'C' }).parentElement,
    ).toHaveAttribute('data-drop-intent', 'after');
    expect(screen.getByRole('status')).toHaveTextContent('Move B after C.');
    expect(treeOrder()).toEqual(['A', 'B', 'C']);
  });

  it('uses a real pending state before activating INSIDE and does not commit it', async () => {
    const { onMove } = renderTree([note('a', 'A', 0), note('b', 'B', 1)]);
    start();
    moveOver('a', 16);
    const target = screen.getByRole('treeitem', { name: 'A' }).parentElement!;

    expect(target).toHaveAttribute('data-drop-intent', 'inside-pending');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Hold to move B inside A.',
    );
    expect(target.querySelector('.document-tree-chevron-slot')).toHaveAttribute(
      'data-open',
      'false',
    );
    expect(treeOrder()).toEqual(['A', 'B']);

    act(() => vi.advanceTimersByTime(INSIDE_HOVER_DELAY - 1));
    expect(target).toHaveAttribute('data-drop-intent', 'inside-pending');
    endDrag(false);
    await act(async () => Promise.resolve());

    expect(onMove).not.toHaveBeenCalled();
    expect(target).not.toHaveAttribute('data-drop-intent');
  });

  it('opens a temporary chevron slot only after INSIDE activates on a leaf', () => {
    renderTree([note('a', 'A', 0), note('b', 'B', 1)]);
    start();
    moveOver('a', 16);
    const target = screen.getByRole('treeitem', { name: 'A' }).parentElement!;
    const slot = target.querySelector('.document-tree-chevron-slot');
    expect(slot).toHaveAttribute('data-open', 'false');
    expect(target).toHaveAttribute('data-drop-intent', 'inside-pending');

    act(() => vi.advanceTimersByTime(INSIDE_HOVER_DELAY));

    expect(target).toHaveAttribute('data-drop-intent', 'inside');
    expect(screen.getByRole('status')).toHaveTextContent('Move B inside A.');
    expect(slot).toHaveAttribute('data-open', 'true');
    expect(target.querySelector('.document-tree-ghost-chevron')).toBeVisible();
    expect(
      within(target).queryByRole('button', { name: 'Collapse A' }),
    ).toBeNull();
    expect(screen.getByRole('treeitem', { name: 'B' })).toHaveAttribute(
      'aria-level',
      '1',
    );
    expect(treeOrder()).toEqual(['A', 'B']);
  });

  it('does not render a second chevron for an existing parent', () => {
    renderTree([
      note('a', 'A', 0),
      note('child', 'Child', 0, 'a'),
      note('b', 'B', 1),
    ]);
    start();
    moveOver('a', 16);
    act(() => vi.advanceTimersByTime(INSIDE_HOVER_DELAY));

    const target = screen.getByRole('treeitem', { name: 'A' }).parentElement!;
    expect(
      within(target).getByRole('button', { name: 'Collapse A' }),
    ).toBeVisible();
    expect(target.querySelector('.document-tree-chevron-slot')).toBeNull();
    expect(target.querySelector('.document-tree-ghost-chevron')).toBeNull();
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
    endDrag(false);
    await act(async () => Promise.resolve());
    expect(onKeepExpanded).toHaveBeenCalledWith('a');
  });

  it('cancels pending INSIDE state when the pointer leaves the target', () => {
    renderTree([note('a', 'A', 0), note('b', 'B', 1), note('c', 'C', 2)]);
    start();
    moveOver('a', 16);
    const firstTarget = screen.getByRole('treeitem', {
      name: 'A',
    }).parentElement!;
    expect(firstTarget).toHaveAttribute('data-drop-intent', 'inside-pending');
    act(() => vi.advanceTimersByTime(INSIDE_HOVER_DELAY - 1));
    moveOver('c', 2);
    act(() => vi.advanceTimersByTime(INSIDE_HOVER_DELAY + 100));

    expect(firstTarget).not.toHaveAttribute('data-drop-intent');
    expect(
      firstTarget.querySelector('.document-tree-chevron-slot'),
    ).toHaveAttribute('data-open', 'false');
    expect(
      screen.getByRole('treeitem', { name: 'C' }).parentElement,
    ).toHaveAttribute('data-drop-intent', 'before');
  });

  it('switches from pending middle to a same-row edge without a dead zone', () => {
    renderTree([note('a', 'A', 0), note('b', 'B', 1)]);
    start();
    moveOver('a', 16);
    const target = screen.getByRole('treeitem', { name: 'A' }).parentElement!;
    expect(target).toHaveAttribute('data-drop-intent', 'inside-pending');

    moveWithin('a', 16, 2);
    act(() => vi.advanceTimersByTime(INSIDE_HOVER_DELAY));

    expect(target).toHaveAttribute('data-drop-intent', 'before');
    expect(target.querySelector('.document-tree-chevron-slot')).toHaveAttribute(
      'data-open',
      'false',
    );
  });

  it('restores a temporarily expanded parent when the drag is canceled', () => {
    renderTree(
      [note('a', 'A', 0), note('child', 'Child', 0, 'a'), note('b', 'B', 1)],
      { collapsedIds: new Set(['a']) },
    );
    start();
    moveOver('a', 16);
    act(() => vi.advanceTimersByTime(AUTO_EXPAND_DELAY));
    expect(screen.getByRole('treeitem', { name: 'Child' })).toBeInTheDocument();

    endDrag(true);

    expect(screen.queryByRole('treeitem', { name: 'Child' })).toBeNull();
    expect(
      screen.getByRole('treeitem', { name: 'A' }).parentElement,
    ).not.toHaveAttribute('data-drop-intent');
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
    endDrag(false);
    await act(async () => Promise.resolve());

    expect(onMove).toHaveBeenCalledWith('b', { parentId: 'a', index: 0 });

    start();
    moveOver('a', 16);
    endDrag(true);
    expect(
      screen.getByRole('treeitem', { name: 'A' }).parentElement,
    ).not.toHaveAttribute('data-drop-intent');
  });

  it('uses keyboard coordinates for the same static destination indicator', () => {
    renderTree([note('a', 'A', 0), note('b', 'B', 1)]);
    start();
    moveOver('a', 16);
    moveWithin('a', 16, 2, { keyboard: true });

    expect(
      screen.getByRole('treeitem', { name: 'A' }).parentElement,
    ).toHaveAttribute('data-drop-intent', 'before');
    expect(treeOrder()).toEqual(['A', 'B']);
  });

  it('resolves the authoritative target after dragmove updates its position', () => {
    renderTree([note('a', 'A', 0), note('b', 'B', 1), note('c', 'C', 2)]);
    start();
    moveOver('a', 2);

    moveWithin('a', 2, 48);
    expect(
      screen.getByRole('treeitem', { name: 'A' }).parentElement,
    ).not.toHaveAttribute('data-drop-intent');

    moveOver('c', 48, 32);
    expect(
      screen.getByRole('treeitem', { name: 'C' }).parentElement,
    ).toHaveAttribute('data-drop-intent', 'inside-pending');
    expect(treeOrder()).toEqual(['A', 'B', 'C']);
  });

  it('does not commit a stale preview when the final target is empty', async () => {
    const { onMove } = renderTree([note('a', 'A', 0), note('b', 'B', 1)]);
    start();
    moveOver('a', 2);

    endDrag(false, null);
    await act(async () => Promise.resolve());

    expect(onMove).not.toHaveBeenCalled();
  });

  it('keeps INSIDE interaction state functional with reduced motion enabled', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string): MediaQueryList => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(() => false),
      })),
    );
    renderTree([note('a', 'A', 0), note('b', 'B', 1)]);
    start();
    moveOver('a', 16);
    act(() => vi.advanceTimersByTime(INSIDE_HOVER_DELAY));

    const target = screen.getByRole('treeitem', { name: 'A' }).parentElement!;
    expect(target).toHaveAttribute('data-drop-intent', 'inside');
    expect(target.querySelector('.document-tree-chevron-slot')).toHaveAttribute(
      'data-open',
      'true',
    );
  });
});

describe('DocumentWorkspace optimistic move', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('applies the move after drop and reconciles authoritative paths', async () => {
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
    endDrag(false);
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
    endDrag(false);
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
