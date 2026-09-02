import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseSelectOption } from '../../test/select';
import type { Project } from '../workspace/types';
import { DocumentWorkspace } from './DocumentWorkspace';
import type { WorkspaceDocument } from './types';

vi.mock('../markdown/MarkdownDocument', () => ({
  MarkdownDocument: ({ target }: { target: { id: string } }) => (
    <div>Editor {target.id}</div>
  ),
}));

const projects: Project[] = [
  {
    id: 'project-1',
    workspace_id: 'workspace-1',
    name: 'Kanleaf',
    identifier: 'KAN',
    icon: 'folder',
    description: '',
    lead_user_id: null,
    visibility: 'private',
    default_assignee_id: null,
    default_state_id: 'state-1',
    default_task_type_id: 'type-1',
    cycles_enabled: true,
    modules_enabled: true,
    pages_enabled: true,
    views_enabled: true,
    enabled_task_type_ids: ['type-1'],
    effective_role: 'contributor',
    can_join: false,
    archived_at: null,
    created_at: '2026-08-29T00:00:00Z',
    updated_at: '2026-08-29T00:00:00Z',
  },
];

function document(
  id: string,
  title: string,
  input: Partial<WorkspaceDocument> = {},
): WorkspaceDocument {
  return {
    id,
    workspace_id: 'workspace-1',
    project_id: null,
    parent_id: null,
    title,
    storage_name: id,
    library_path: `Wiki/${id}.md`,
    position: 0,
    can_edit: true,
    archived_at: null,
    created_at: '2026-08-29T00:00:00Z',
    updated_at: '2026-08-29T00:00:00Z',
    ...input,
  };
}

function createServer(initial: WorkspaceDocument[]) {
  let documents = initial;
  const fetchMock = vi
    .fn()
    .mockImplementation((url: string, options?: RequestInit) => {
      const method = options?.method ?? 'GET';
      if (method === 'POST') {
        const input = JSON.parse(String(options?.body)) as {
          title: string;
          project_id: string | null;
          parent_id: string | null;
        };
        const created = document(
          `document-${documents.length + 1}`,
          input.title,
          {
            project_id: input.project_id,
            parent_id: input.parent_id,
            position: documents.filter(
              (candidate) =>
                candidate.project_id === input.project_id &&
                candidate.parent_id === input.parent_id,
            ).length,
          },
        );
        documents = [...documents, created];
        return response(created, 201);
      }
      if (method === 'PATCH') {
        const id = url.split('/').at(-1)!;
        const patch = JSON.parse(
          String(options?.body),
        ) as Partial<WorkspaceDocument>;
        let updated = documents.find((candidate) => candidate.id === id)!;
        updated = { ...updated, ...patch };
        documents = documents.map((candidate) =>
          candidate.id === id ? updated : candidate,
        );
        return response(updated);
      }
      if (method === 'PUT') {
        const input = JSON.parse(String(options?.body)) as {
          document_ids: string[];
        };
        documents = documents.map((candidate) => {
          const position = input.document_ids.indexOf(candidate.id);
          return position < 0 ? candidate : { ...candidate, position };
        });
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (method === 'DELETE') {
        const id = url.split('/').at(-1)!;
        const archived = new Set([id]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const candidate of documents) {
            if (candidate.parent_id && archived.has(candidate.parent_id)) {
              changed ||= !archived.has(candidate.id);
              archived.add(candidate.id);
            }
          }
        }
        documents = documents.filter(
          (candidate) => !archived.has(candidate.id),
        );
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return response(documents);
    });
  return fetchMock;
}

function response(payload: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function renderWorkspace(
  fetchMock: ReturnType<typeof vi.fn>,
  options: {
    projectId?: string | null;
    accessSettled?: boolean;
    selectedDocumentId?: string | null;
    cachedDocuments?: WorkspaceDocument[];
    onSelectDocument?: (
      document: WorkspaceDocument | null,
      navigation?: { replace?: boolean },
    ) => boolean | void | Promise<boolean | void>;
    onPrepareDocumentMutation?: () => boolean | void | Promise<boolean | void>;
    onInvalidSelection?: () => void;
  } = {},
) {
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (options.cachedDocuments) {
    client.setQueryData(
      ['documents', 'workspace-1', options.projectId ?? 'all'] as const,
      options.cachedDocuments,
    );
  }
  const onInvalidSelection = options.onInvalidSelection ?? (() => undefined);
  function Harness() {
    const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
      options.selectedDocumentId ?? null,
    );
    async function selectDocument(
      document: WorkspaceDocument | null,
      navigation?: { replace?: boolean },
    ) {
      const result = navigation
        ? options.onSelectDocument?.(document, navigation)
        : options.onSelectDocument?.(document);
      const allowed = result instanceof Promise ? await result : result;
      if (allowed === false) return false;
      setSelectedDocumentId(document?.id ?? null);
      return true;
    }
    async function prepareDocumentMutation() {
      return (await options.onPrepareDocumentMutation?.()) !== false;
    }
    return (
      <QueryClientProvider client={client}>
        <DocumentWorkspace
          context={{ serverUrl: 'https://kanleaf.example.com', token: 'token' }}
          workspaceId="workspace-1"
          projects={projects}
          projectId={options.projectId ?? null}
          accessSettled={options.accessSettled ?? true}
          canCreateWorkspaceDocuments
          selectedDocumentId={selectedDocumentId}
          onSelectDocument={selectDocument}
          onPrepareDocumentMutation={prepareDocumentMutation}
          onInvalidSelection={onInvalidSelection}
        />
      </QueryClientProvider>
    );
  }
  render(<Harness />);
}

describe('DocumentWorkspace', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does not request owner-scoped documents before access settles', () => {
    const fetchMock = vi.fn(() => response([]));

    renderWorkspace(fetchMock, { accessSettled: false });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText('Loading Library…')).toBeInTheDocument();
  });

  it('does not expose a cached selected note before access settles', () => {
    const fetchMock = vi.fn(() => response([]));
    renderWorkspace(fetchMock, {
      accessSettled: false,
      selectedDocumentId: 'cached-note',
      cachedDocuments: [document('cached-note', 'Cached note')],
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText('Loading Library…')).toBeInTheDocument();
    expect(screen.queryByText('Editor cached-note')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'New Library note' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Archive…' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('combobox', { name: 'Library location' }),
    ).not.toBeInTheDocument();
  });

  it('keeps an explicit missing note empty until its parent route replaces it', async () => {
    let resolveDocuments!: (response: Response) => void;
    const documentsResponse = new Promise<Response>((resolve) => {
      resolveDocuments = resolve;
    });
    const onInvalidSelection = vi.fn();
    renderWorkspace(vi.fn().mockReturnValue(documentsResponse), {
      selectedDocumentId: 'missing-note',
      onInvalidSelection,
    });

    expect(await screen.findByText('Loading Library…')).toBeInTheDocument();
    expect(onInvalidSelection).not.toHaveBeenCalled();

    resolveDocuments(
      new Response(JSON.stringify([document('root', 'Architecture')]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await waitFor(() => expect(onInvalidSelection).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Editor root')).not.toBeInTheDocument();
    expect(screen.getByText('Select a Library note')).toBeInTheDocument();
  });

  it('rejects an explicit note outside the current project scope', async () => {
    const onInvalidSelection = vi.fn();
    renderWorkspace(
      createServer([
        document('workspace-note', 'Workspace note'),
        document('project-note', 'Project note', { project_id: 'project-1' }),
      ]),
      {
        projectId: 'project-1',
        selectedDocumentId: 'workspace-note',
        onInvalidSelection,
      },
    );

    await waitFor(() => expect(onInvalidSelection).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Editor project-note')).not.toBeInTheDocument();
    expect(screen.getByText('Select a Library note')).toBeInTheDocument();
  });

  it('replaces an aggregate Library URL with the selected Project note scope', async () => {
    const onInvalidSelection = vi.fn();
    const onSelectDocument = vi.fn();
    renderWorkspace(
      createServer([
        document('workspace-note', 'Workspace note'),
        document('project-note', 'Project note', { project_id: 'project-1' }),
      ]),
      {
        selectedDocumentId: 'project-note',
        onInvalidSelection,
        onSelectDocument,
      },
    );

    await waitFor(() =>
      expect(onSelectDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'project-note',
          project_id: 'project-1',
        }),
        { replace: true },
      ),
    );
    expect(onInvalidSelection).not.toHaveBeenCalled();
  });

  it('waits for a cached document list to finish refetching before rejecting an explicit note', async () => {
    let resolveDocuments!: (response: Response) => void;
    const documentsResponse = new Promise<Response>((resolve) => {
      resolveDocuments = resolve;
    });
    const onInvalidSelection = vi.fn();
    renderWorkspace(vi.fn().mockReturnValue(documentsResponse), {
      selectedDocumentId: 'deep-note',
      cachedDocuments: [document('root', 'Architecture')],
      onInvalidSelection,
    });

    expect(
      await screen.findByRole('treeitem', { name: /Architecture/ }),
    ).toBeInTheDocument();
    expect(onInvalidSelection).not.toHaveBeenCalled();

    resolveDocuments(
      new Response(
        JSON.stringify([
          document('root', 'Architecture'),
          document('deep-note', 'Deep link', { position: 1 }),
        ]),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    expect(await screen.findByText('Editor deep-note')).toBeInTheDocument();
    expect(onInvalidSelection).not.toHaveBeenCalled();
  });

  it('replaces a hidden descendant route with its collapsed ancestor', async () => {
    let allowSelection!: (allowed: boolean) => void;
    const selection = new Promise<boolean>((resolve) => {
      allowSelection = resolve;
    });
    const onSelectDocument = vi.fn().mockReturnValue(selection);
    renderWorkspace(
      createServer([
        document('root', 'Architecture'),
        document('child', 'Vault', { parent_id: 'root' }),
      ]),
      { selectedDocumentId: 'child', onSelectDocument },
    );
    await screen.findByText('Editor child');

    fireEvent.click(
      screen.getByRole('button', { name: 'Collapse Architecture' }),
    );

    expect(onSelectDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'root', project_id: null }),
      { replace: true },
    );
    expect(screen.getByText('Editor child')).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: /Vault/ })).toBeInTheDocument();

    await act(async () => allowSelection(true));

    expect(await screen.findByText('Editor root')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByRole('treeitem', { name: /Vault/ }),
      ).not.toBeInTheDocument(),
    );
  });

  it('keeps a selected descendant open when its collapse navigation is rejected', async () => {
    const onSelectDocument = vi.fn().mockResolvedValue(false);
    renderWorkspace(
      createServer([
        document('root', 'Architecture'),
        document('child', 'Vault', { parent_id: 'root' }),
      ]),
      { selectedDocumentId: 'child', onSelectDocument },
    );
    await screen.findByText('Editor child');

    fireEvent.click(
      screen.getByRole('button', { name: 'Collapse Architecture' }),
    );

    await waitFor(() => expect(onSelectDocument).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Editor child')).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: /Vault/ })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Collapse Architecture' }),
    ).toHaveAttribute('aria-expanded', 'true');
  });

  it('replaces the selected document route when closing its detail', async () => {
    const onSelectDocument = vi.fn();
    renderWorkspace(createServer([document('root', 'Architecture')]), {
      selectedDocumentId: 'root',
      onSelectDocument,
    });
    await screen.findByText('Editor root');

    fireEvent.click(screen.getByRole('button', { name: 'Back to Library' }));

    expect(onSelectDocument).toHaveBeenLastCalledWith(null, { replace: true });
  });

  it('replaces the archived document route after deletion', async () => {
    const onSelectDocument = vi.fn();
    const onPrepareDocumentMutation = vi.fn().mockResolvedValue(true);
    const fetchMock = createServer([document('root', 'Architecture')]);
    renderWorkspace(fetchMock, {
      selectedDocumentId: 'root',
      onSelectDocument,
      onPrepareDocumentMutation,
    });
    await screen.findByText('Editor root');

    fireEvent.click(screen.getByRole('button', { name: 'Archive…' }));
    fireEvent.click(screen.getByRole('button', { name: /^Archive$/ }));

    await waitFor(() =>
      expect(onPrepareDocumentMutation).toHaveBeenCalledTimes(1),
    );
    const deleteCall = fetchMock.mock.calls.findIndex(
      ([, request]) => request?.method === 'DELETE',
    );
    expect(deleteCall).toBeGreaterThanOrEqual(0);
    expect(onPrepareDocumentMutation.mock.invocationCallOrder[0]).toBeLessThan(
      fetchMock.mock.invocationCallOrder[deleteCall],
    );
    await waitFor(() =>
      expect(onSelectDocument).toHaveBeenLastCalledWith(null, {
        replace: true,
      }),
    );
  });

  it('keeps the document open when preparing its archive is rejected', async () => {
    const fetchMock = createServer([document('root', 'Architecture')]);
    const onPrepareDocumentMutation = vi.fn().mockResolvedValue(false);
    renderWorkspace(fetchMock, {
      selectedDocumentId: 'root',
      onPrepareDocumentMutation,
    });
    await screen.findByText('Editor root');

    fireEvent.click(screen.getByRole('button', { name: 'Archive…' }));
    fireEvent.click(screen.getByRole('button', { name: /^Archive$/ }));

    await waitFor(() =>
      expect(onPrepareDocumentMutation).toHaveBeenCalledTimes(1),
    );
    expect(screen.getByText('Editor root')).toBeInTheDocument();
    expect(
      screen.getByRole('alertdialog', { name: 'Archive Library note' }),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([, request]) => request?.method === 'DELETE'),
    ).toBe(false);
  });

  it('pushes a directly selected document route', async () => {
    const onSelectDocument = vi.fn();
    renderWorkspace(
      createServer([
        document('root', 'Architecture'),
        document('release', 'Release notes', { position: 1 }),
      ]),
      { onSelectDocument },
    );
    await screen.findByText('Editor root');

    fireEvent.click(screen.getByRole('treeitem', { name: /Release notes/ }));

    expect(onSelectDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'release', project_id: null }),
    );
  });

  it('preserves a Project note scope when selecting it from the Workspace Library', async () => {
    const onSelectDocument = vi.fn();
    renderWorkspace(
      createServer([
        document('workspace-note', 'Workspace note'),
        document('project-note', 'Project note', {
          project_id: 'project-1',
        }),
      ]),
      { onSelectDocument },
    );
    await screen.findByText('Editor workspace-note');

    fireEvent.click(screen.getByRole('treeitem', { name: /Project note/ }));

    expect(onSelectDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'project-note',
        project_id: 'project-1',
      }),
    );
  });

  it('pushes a newly created document route', async () => {
    const onSelectDocument = vi.fn();
    renderWorkspace(createServer([document('root', 'Architecture')]), {
      onSelectDocument,
    });
    await screen.findByText('Editor root');

    fireEvent.click(screen.getByRole('button', { name: 'New Library note' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Note title' }), {
      target: { value: 'Meeting notes' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create note' }));

    expect(
      await screen.findByRole('treeitem', { name: /Meeting notes/ }),
    ).toBeInTheDocument();
    expect(onSelectDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'document-2', project_id: null }),
    );
  });

  it('preserves a Project note scope when creating it from the Workspace Library', async () => {
    const onSelectDocument = vi.fn();
    renderWorkspace(
      createServer([
        document('workspace-note', 'Workspace note'),
        document('project-note', 'Project note', {
          project_id: 'project-1',
        }),
      ]),
      { onSelectDocument },
    );
    await screen.findByText('Editor workspace-note');

    fireEvent.click(
      screen.getByRole('button', { name: 'Actions for Project note' }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add nested note' }));
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Nested note title' }),
      { target: { value: 'Project child' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create nested note' }));

    expect(
      await screen.findByRole('treeitem', { name: /Project child/ }),
    ).toBeInTheDocument();
    expect(onSelectDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'document-3',
        project_id: 'project-1',
      }),
    );
  });

  it('does not create a document before the Markdown save preflight succeeds', async () => {
    const onPrepareDocumentMutation = vi.fn().mockResolvedValue(false);
    const fetchMock = createServer([document('root', 'Architecture')]);
    renderWorkspace(fetchMock, { onPrepareDocumentMutation });
    await screen.findByText('Editor root');

    fireEvent.click(screen.getByRole('button', { name: 'New Library note' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Note title' }), {
      target: { value: 'Blocked note' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create note' }));

    await waitFor(() =>
      expect(onPrepareDocumentMutation).toHaveBeenCalledOnce(),
    );
    expect(
      fetchMock.mock.calls.some(([, options]) => options?.method === 'POST'),
    ).toBe(false);
    expect(screen.queryByRole('treeitem', { name: /Blocked note/ })).toBeNull();
  });

  it('replaces a Workspace Library URL after moving its selected note into a Project', async () => {
    const onSelectDocument = vi.fn();
    renderWorkspace(createServer([document('root', 'Architecture')]), {
      selectedDocumentId: 'root',
      onSelectDocument,
    });
    await screen.findByText('Editor root');

    await chooseSelectOption('Library location', 'Kanleaf');

    await waitFor(() =>
      expect(onSelectDocument).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'root', project_id: 'project-1' }),
        { replace: true },
      ),
    );
  });

  it('replaces a Project Library URL after moving its selected note to the Workspace', async () => {
    const onSelectDocument = vi.fn();
    renderWorkspace(
      createServer([
        document('project-note', 'Project note', {
          project_id: 'project-1',
        }),
      ]),
      {
        projectId: 'project-1',
        selectedDocumentId: 'project-note',
        onSelectDocument,
      },
    );
    await screen.findByText('Editor project-note');

    await chooseSelectOption('Library location', 'Workspace');

    await waitFor(() =>
      expect(onSelectDocument).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'project-note', project_id: null }),
        { replace: true },
      ),
    );
  });

  it('does not navigate when renaming the selected document', async () => {
    const onSelectDocument = vi.fn();
    renderWorkspace(createServer([document('root', 'Architecture')]), {
      selectedDocumentId: 'root',
      onSelectDocument,
    });
    await screen.findByText('Editor root');
    const tree = screen.getByRole('tree', {
      name: 'Workspace Library',
    });

    tree.focus();
    fireEvent.keyDown(tree, { key: 'F2' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Note title' }), {
      target: { value: 'System design' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rename note' }));

    expect(
      await screen.findByRole('treeitem', { name: /System design/ }),
    ).toBeInTheDocument();
    expect(onSelectDocument).not.toHaveBeenCalled();
  });

  it('does not navigate when reordering the selected document', async () => {
    const onSelectDocument = vi.fn();
    renderWorkspace(
      createServer([
        document('root', 'Architecture'),
        document('release', 'Release notes', { position: 1 }),
      ]),
      { selectedDocumentId: 'release', onSelectDocument },
    );
    await screen.findByText('Editor release');

    fireEvent.click(
      screen.getByRole('button', { name: 'Actions for Release notes' }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: /Move up/ }));

    await waitFor(() =>
      expect(
        screen.getAllByRole('treeitem').map((item) => item.textContent),
      ).toEqual(['Release notes', 'Architecture']),
    );
    expect(onSelectDocument).not.toHaveBeenCalled();
  });

  it('navigates the tree by keyboard and keeps selection through rename and nesting', async () => {
    const fetchMock = createServer([
      document('root', 'Architecture'),
      document('child', 'Vault', { parent_id: 'root' }),
      document('release', 'Release notes', { position: 1 }),
    ]);
    renderWorkspace(fetchMock);

    const tree = await screen.findByRole('tree', {
      name: 'Workspace Library',
    });
    expect(await screen.findByText('Editor root')).toBeInTheDocument();
    expect(screen.getByText('Wiki/root.md')).toBeInTheDocument();
    tree.focus();
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    expect(await screen.findByText('Editor child')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Collapse Architecture' }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('treeitem', { name: /Vault/ }),
      ).not.toBeInTheDocument(),
    );
    expect(await screen.findByText('Editor root')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Expand Architecture' }),
    );
    tree.focus();
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    expect(await screen.findByText('Editor child')).toBeInTheDocument();

    fireEvent.keyDown(tree, { key: 'F2' });
    const title = screen.getByRole('textbox', { name: 'Note title' });
    fireEvent.change(title, { target: { value: 'Vault contract' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename note' }));
    expect(
      await screen.findByRole('treeitem', { name: /Vault contract/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('Editor child')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('treeitem', { name: /Release notes/ }));
    await chooseSelectOption('Library parent', 'Architecture');
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'https://kanleaf.example.com/api/workspaces/workspace-1/documents/release',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ parent_id: 'root' }),
        }),
      ),
    );
    expect(screen.getByText('Editor release')).toBeInTheDocument();
  });

  it('creates, reorders, moves, and confirms subtree archive actions', async () => {
    const fetchMock = createServer([
      document('root', 'Architecture'),
      document('release', 'Release notes', { position: 1 }),
    ]);
    renderWorkspace(fetchMock);
    await screen.findByRole('treeitem', { name: /Architecture/ });

    fireEvent.click(screen.getByRole('button', { name: 'New Library note' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Note title' }), {
      target: { value: 'Meeting notes' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create note' }));
    expect(
      await screen.findByRole('treeitem', { name: /Meeting notes/ }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Actions for Release notes' }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: /Move up/ }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'https://kanleaf.example.com/api/workspaces/workspace-1/documents/reorder',
        expect.objectContaining({ method: 'PUT' }),
      ),
    );

    fireEvent.click(screen.getByRole('treeitem', { name: /Architecture/ }));
    await chooseSelectOption('Library location', 'Kanleaf');
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'https://kanleaf.example.com/api/workspaces/workspace-1/documents/root',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ project_id: 'project-1', parent_id: null }),
        }),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Archive…' }));
    expect(
      screen.getByRole('alertdialog', { name: 'Archive Library note' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Archive$/ }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'https://kanleaf.example.com/api/workspaces/workspace-1/documents/root',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });
});
