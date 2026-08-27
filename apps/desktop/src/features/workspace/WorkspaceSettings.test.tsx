import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Workspace, WorkspaceMember } from './types';
import {
  WorkspaceSettings,
  type WorkspaceSettingsSection,
} from './WorkspaceSettings';

const context = {
  serverUrl: 'https://kanleaf.example.com',
  token: 'session-token',
};

const owner: WorkspaceMember = {
  user_id: 'owner-1',
  email: 'owner@example.com',
  display_name: 'Workspace Owner',
  role: 'owner',
  joined_at: '2026-08-20T01:00:00Z',
  updated_at: '2026-08-20T01:00:00Z',
};

const member: WorkspaceMember = {
  user_id: 'member-1',
  email: 'member@example.com',
  display_name: 'Workspace Member',
  role: 'member',
  joined_at: '2026-08-21T01:00:00Z',
  updated_at: '2026-08-21T01:00:00Z',
};

describe('WorkspaceSettings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps membership actions read-only for a Workspace Member', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse([owner, member])),
    );
    renderSettings({ ...workspace, role: 'member' }, 'members', member.user_id);

    expect(await screen.findByText('Workspace Owner')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Remove Workspace Member' }),
    ).not.toBeInTheDocument();
  });

  it('lets an Owner change a non-owner role', async () => {
    const promoted = { ...member, role: 'admin' as const };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([owner, member]))
      .mockResolvedValueOnce(jsonResponse(promoted))
      .mockResolvedValueOnce(jsonResponse([owner, promoted]));
    vi.stubGlobal('fetch', fetchMock);
    renderSettings(workspace, 'members', owner.user_id);

    const role = await screen.findByRole('combobox', {
      name: 'Workspace Member role',
    });
    fireEvent.change(role, { target: { value: 'admin' } });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'https://kanleaf.example.com/api/workspaces/workspace-1/members/member-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ role: 'admin' }),
        }),
      ),
    );
  });

  it('requires the exact name and confirmation before deletion', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderSettings(workspace, 'danger', owner.user_id);

    const deleteButton = screen.getByRole('button', {
      name: 'Delete Workspace',
    });
    expect(deleteButton).toBeDisabled();
    fireEvent.change(
      screen.getByLabelText(`Type ${workspace.name} to confirm`),
      {
        target: { value: workspace.name },
      },
    );
    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'correct horse battery' },
    });
    expect(deleteButton).toBeEnabled();
    fireEvent.click(deleteButton);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'https://kanleaf.example.com/api/workspaces/workspace-1',
        expect.objectContaining({
          method: 'DELETE',
          body: JSON.stringify({
            name: workspace.name,
            password: 'correct horse battery',
          }),
        }),
      ),
    );
    expect(window.confirm).toHaveBeenCalledWith(
      `Permanently delete ${workspace.name}?`,
    );
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

function renderSettings(
  selectedWorkspace: Workspace,
  section: WorkspaceSettingsSection,
  userId: string,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceSettings
        context={context}
        workspace={selectedWorkspace}
        userId={userId}
        workspaceCount={2}
        section={section}
        onWorkspaceUpdated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
