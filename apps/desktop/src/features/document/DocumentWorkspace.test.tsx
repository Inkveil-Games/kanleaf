import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    library_path: `Library/${id}.md`,
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

function renderWorkspace(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Harness() {
    const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
      null,
    );
    return (
      <QueryClientProvider client={client}>
        <DocumentWorkspace
          context={{ serverUrl: 'https://kanleaf.example.com', token: 'token' }}
          workspaceId="workspace-1"
          projects={projects}
          projectId={null}
          canCreateWorkspaceDocuments
          selectedDocumentId={selectedDocumentId}
          onSelectDocument={setSelectedDocumentId}
        />
      </QueryClientProvider>
    );
  }
  render(<Harness />);
}

describe('DocumentWorkspace', () => {
  afterEach(() => vi.unstubAllGlobals());

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
    expect(screen.getByText('Library/root.md')).toBeInTheDocument();
    tree.focus();
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    expect(await screen.findByText('Editor child')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Collapse Architecture' }),
    );
    expect(
      screen.queryByRole('treeitem', { name: /Vault/ }),
    ).not.toBeInTheDocument();
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
    chooseSelectOption('Library parent', 'Architecture');
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
    chooseSelectOption('Library location', 'Kanleaf');
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
