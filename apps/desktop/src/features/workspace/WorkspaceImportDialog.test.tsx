import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceImportOperation } from './portabilityApi';
import { WorkspaceImportDialog } from './WorkspaceImportDialog';

HTMLDialogElement.prototype.showModal = function showModal() {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function close() {
  this.removeAttribute('open');
};

const context = {
  serverUrl: 'https://kanleaf.example.com',
  token: 'session-token',
};

describe('WorkspaceImportDialog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('previews archive contents and imports a new isolated Workspace', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(preview, 201))
      .mockResolvedValueOnce(
        jsonResponse({
          ...preview,
          state: 'completed',
          revision: 'revision-2',
          workspace_id: 'workspace-imported',
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const onApplyImport = vi.fn(
      async (apply: () => Promise<WorkspaceImportOperation>) => apply(),
    );
    render(
      <WorkspaceImportDialog
        context={context}
        onApplyImport={onApplyImport}
        onClose={vi.fn()}
      />,
    );

    const archive = new File(['archive'], 'kanleaf-core.kanleaf.zip', {
      type: 'application/zip',
    });
    fireEvent.change(screen.getByLabelText(/Choose a .kanleaf.zip archive/), {
      target: { files: [archive] },
    });

    expect(await screen.findByText('Kanleaf Core')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(
      screen.getByText(/2 member\/Project role reference/),
    ).toBeInTheDocument();
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.body).toBeInstanceOf(FormData);
    expect(new Headers(request.headers).has('content-type')).toBe(false);

    fireEvent.click(
      screen.getByRole('button', { name: 'Import as new Workspace' }),
    );
    await waitFor(() => expect(onApplyImport).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://kanleaf.example.com/api/workspace-imports/import-1/apply',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ revision: 'revision-1' }),
      }),
    );
  });
});

const preview = {
  id: 'import-1',
  state: 'ready',
  revision: 'revision-1',
  expires_at: '2026-08-30T10:30:00Z',
  workspace_id: null,
  error: null,
  summary: {
    workspace_name: 'Kanleaf Core',
    projects: 3,
    tasks: 12,
    documents: 5,
    states: 5,
    types: 2,
    labels: 4,
    shared_views: 2,
    cycles: 1,
    modules: 2,
    excluded_member_references: 2,
    excluded_assignee_references: 3,
    history_included: false,
  },
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
