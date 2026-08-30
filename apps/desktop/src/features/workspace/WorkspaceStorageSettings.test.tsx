import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceStorageSettings } from './WorkspaceStorageSettings';
import type { Workspace } from './types';

const context = {
  serverUrl: 'https://kanleaf.example.com',
  token: 'session-token',
};

describe('WorkspaceStorageSettings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('previews and applies selected external Task property changes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(syncPreview, 201))
      .mockResolvedValueOnce(
        jsonResponse({
          ...syncPreview,
          state: 'completed',
          revision: 'sync-revision-2',
          applied_task_ids: ['task-1'],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const onConfigurationUpdated = vi.fn().mockResolvedValue(undefined);
    render(
      <WorkspaceStorageSettings
        context={context}
        workspace={workspace}
        onConfigurationUpdated={onConfigurationUpdated}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Scan vault' }));
    expect(await screen.findByText('KAN-42')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 selected' }));

    await waitFor(() => expect(onConfigurationUpdated).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://kanleaf.example.com/api/workspaces/workspace-1/vault-syncs/sync-1/apply',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          revision: 'sync-revision-1',
          task_ids: ['task-1'],
        }),
      }),
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      '1 Task was updated from the vault.',
    );
  });

  it('prepares and downloads a verified Workspace archive', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(exportReady, 202))
      .mockResolvedValueOnce(
        new Response(new Blob(['zip']), {
          headers: {
            'content-type': 'application/zip',
            'content-disposition':
              'attachment; filename="kanleaf-core.kanleaf.zip"',
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const createObjectURL = vi.fn(() => 'blob:kanleaf-export');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(
      <WorkspaceStorageSettings
        context={context}
        workspace={workspace}
        onConfigurationUpdated={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Prepare archive' }));
    expect(
      await screen.findByRole('button', { name: 'Download archive' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/8 files · 2.0 KB/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download archive' }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://kanleaf.example.com/api/workspace-exports/export-1/download',
      expect.objectContaining({
        headers: { authorization: 'Bearer session-token' },
      }),
    );
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:kanleaf-export');
  });
});

const workspace: Workspace = {
  id: 'workspace-1',
  name: 'Kanleaf Core',
  accent: 'sage',
  role: 'owner',
  created_at: '2026-08-20T01:00:00Z',
  updated_at: '2026-08-20T01:00:00Z',
};

const syncPreview = {
  id: 'sync-1',
  workspace_id: workspace.id,
  state: 'ready',
  revision: 'sync-revision-1',
  expires_at: '2026-08-30T10:30:00Z',
  applied_task_ids: [],
  error: null,
  issues: [],
  items: [
    {
      task_id: 'task-1',
      reference: 'KAN-42',
      title: 'Portable vault',
      path: 'Projects/kanleaf--a1b2c3/Todo/portable-vault--d4e5f6.md',
      status: 'valid',
      changes: ['State', 'Priority'],
      message: null,
      source_revision: 'source-revision',
      metadata_version: 3,
    },
  ],
};

const exportReady = {
  id: 'export-1',
  workspace_id: workspace.id,
  state: 'ready',
  revision: 'export-revision-1',
  expires_at: '2026-08-30T10:30:00Z',
  file_name: 'kanleaf-core.kanleaf.zip',
  file_count: 8,
  content_bytes: 4096,
  archive_bytes: 2048,
  exclusions: [],
  error: null,
  download_url: '/api/workspace-exports/export-1/download',
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
