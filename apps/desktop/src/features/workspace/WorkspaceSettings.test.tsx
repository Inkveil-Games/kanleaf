import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { chooseSelectOption } from '../../test/select';
import type { WorkspaceSettingsSection } from './settingsSections';
import type { Workspace, WorkspaceMember } from './types';
import { WorkspaceSettings } from './WorkspaceSettings';

const context = {
  serverUrl: 'https://kanleaf.example.com',
  token: 'session-token',
};

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});

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

const invitation = {
  id: 'invitation-1',
  workspace_id: 'workspace-1',
  workspace_name: 'Kanleaf Core',
  workspace_identifier: 'kanleaf-core',
  email: 'invited@example.com',
  role: 'member',
  invited_by_display_name: 'Workspace Owner',
  status: 'pending',
  expires_at: '2026-09-10T01:00:00Z',
  created_at: '2026-09-03T01:00:00Z',
  updated_at: '2026-09-03T01:00:00Z',
};

describe('WorkspaceSettings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the immutable Workspace ID in General settings', () => {
    renderSettings(workspace, 'general', owner.user_id);

    expect(screen.getByLabelText('Workspace ID')).toHaveValue('kanleaf-core');
    expect(screen.getByLabelText('Workspace ID')).toHaveAttribute('readonly');
  });

  it('renders custom Properties as a shared structured settings list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse([
          {
            id: 'property-1',
            workspace_id: workspace.id,
            name: 'Impact',
            type: 'single_select',
            description: 'Expected customer impact',
            position: 0,
            configuration: {},
            options: [],
            usage_count: 0,
            archived_at: null,
            created_at: '2026-09-03T01:00:00Z',
            updated_at: '2026-09-03T01:00:00Z',
          },
        ]),
      ),
    );

    renderSettings(workspace, 'properties', owner.user_id);

    expect(
      await screen.findByRole('heading', { name: 'Properties' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Impact')).toBeInTheDocument();
    expect(screen.getByText('Single select')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'New property' }),
    ).toBeInTheDocument();
  });

  it('saves a property and its options in one atomic request', async () => {
    const property = {
      id: 'property-1',
      workspace_id: workspace.id,
      name: 'Platforms',
      type: 'multi_select',
      description: '',
      position: 0,
      configuration: {},
      options: [
        {
          id: 'web-option',
          workspace_id: workspace.id,
          property_id: 'property-1',
          name: 'Web',
          color: '#3B82F6',
          position: 0,
          archived_at: null,
          created_at: '2026-09-03T01:00:00Z',
          updated_at: '2026-09-03T01:00:00Z',
        },
        {
          id: 'desktop-option',
          workspace_id: workspace.id,
          property_id: 'property-1',
          name: 'Desktop',
          color: '#8B5CF6',
          position: 1,
          archived_at: null,
          created_at: '2026-09-03T01:00:00Z',
          updated_at: '2026-09-03T01:00:00Z',
        },
      ],
      usage_count: 2,
      archived_at: null,
      created_at: '2026-09-03T01:00:00Z',
      updated_at: '2026-09-03T01:00:00Z',
    };
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        jsonResponse(init?.method === 'PATCH' ? property : [property]),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderSettings(workspace, 'properties', owner.user_id);

    await screen.findByText('Platforms');
    fireEvent.click(
      screen.getByRole('button', { name: 'Actions for Platforms' }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Web' }));
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Delete permanently' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'https://kanleaf.example.com/api/workspaces/workspace-1/properties/property-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            name: 'Platforms',
            description: '',
            options: [
              {
                id: 'desktop-option',
                name: 'Desktop',
                color: '#8B5CF6',
                archived: false,
              },
            ],
          }),
        }),
      ),
    );
    expect(
      fetchMock.mock.calls.some(([input]) =>
        input.toString().includes('/options/'),
      ),
    ).toBe(false);
  });

  it('lists undefined Markdown fields and opens a routed Define property flow', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.endsWith('/properties/undefined')) {
        return jsonResponse([{ name: 'External score', task_count: 2 }]);
      }
      return jsonResponse([]);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderSettings(
      workspace,
      'properties',
      owner.user_id,
      undefined,
      'External score',
    );

    expect(
      await screen.findByRole('dialog', { name: 'Define External score' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('External score');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Undefined' }));
    expect(await screen.findByText('External score')).toBeInTheDocument();
    expect(screen.getByText('2 Tasks')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Define External score' }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Define External score' }),
    );
    await chooseSelectOption('Property type', 'Number');
    fireEvent.click(screen.getByRole('button', { name: 'Define property' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'https://kanleaf.example.com/api/workspaces/workspace-1/properties/define',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            name: 'External score',
            type: 'number',
            description: '',
          }),
        }),
      ),
    );
  });

  it('ignores a copied Define-property route for non-admin members', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([])));

    renderSettings(
      { ...workspace, role: 'member' },
      'properties',
      member.user_id,
      undefined,
      'External score',
    );

    expect(
      await screen.findByRole('heading', { name: 'Properties' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', { name: 'Define External score' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('tab', { name: 'Undefined' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'New property' }),
    ).not.toBeInTheDocument();
  });

  it('keeps membership actions read-only for a Workspace Member', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse([owner, member])),
    );
    renderSettings({ ...workspace, role: 'member' }, 'members', member.user_id);

    expect(await screen.findByText('Workspace Owner')).toBeInTheDocument();
    expect(
      screen.queryByRole('combobox', { name: 'Workspace Member role' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Workspace Member actions' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invite people' })).toBeNull();
    expect(screen.queryByText('Pending invitations')).toBeNull();
  });

  it('lets an Owner change a non-owner role', async () => {
    const promoted = { ...member, role: 'admin' as const };
    let memberReads = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        if (url.endsWith('/invitations')) return jsonResponse([]);
        if (init?.method === 'PATCH') return jsonResponse(promoted);
        memberReads += 1;
        return jsonResponse(
          memberReads === 1 ? [owner, member] : [owner, promoted],
        );
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    renderSettings(workspace, 'members', owner.user_id);

    await screen.findByRole('combobox', {
      name: 'Workspace Member role',
    });
    await chooseSelectOption('Workspace Member role', 'Admin');

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

  it('combines searchable members and pending invitations in one page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input.toString();
        return url.endsWith('/members')
          ? jsonResponse([owner, member])
          : jsonResponse([invitation]);
      }),
    );
    renderSettings(workspace, 'members', owner.user_id);

    expect(
      await screen.findByRole('button', { name: 'Invite people' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Pending invitations')).toBeInTheDocument();
    expect(await screen.findByText('invited@example.com')).toBeInTheDocument();

    fireEvent.change(
      screen.getByRole('searchbox', { name: 'Search members' }),
      {
        target: { value: 'owner@example.com' },
      },
    );
    expect(screen.getByText('Workspace Owner')).toBeInTheDocument();
    expect(screen.queryByText('Workspace Member')).toBeNull();
  });

  it('reveals a one-time token after inviting a person from Members', async () => {
    const issued = { ...invitation, token: 'one-time-invite-token' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        if (url.endsWith('/members')) return jsonResponse([owner]);
        if (init?.method === 'POST') {
          return new Response(JSON.stringify(issued), {
            status: 201,
            headers: { 'content-type': 'application/json' },
          });
        }
        return jsonResponse([]);
      }),
    );
    renderSettings(workspace, 'members', owner.user_id);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Invite people' }),
    );
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'invited@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));

    expect(
      await screen.findByDisplayValue('one-time-invite-token'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Invite another' }),
    ).toBeInTheDocument();
  });

  it('renews a pending invitation and reveals its replacement token', async () => {
    const renewed = { ...invitation, token: 'renewed-invite-token' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        if (url.endsWith('/members')) return jsonResponse([owner]);
        if (url.endsWith('/renew') && init?.method === 'POST') {
          return jsonResponse(renewed);
        }
        return jsonResponse([invitation]);
      }),
    );
    renderSettings(workspace, 'members', owner.user_id);

    await screen.findByText('invited@example.com');
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Manage invitation for invited@example.com',
      }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Renew invitation' }));

    expect(
      await screen.findByDisplayValue('renewed-invite-token'),
    ).toBeInTheDocument();
  });

  it('revokes a pending invitation from its row menu', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        if (url.endsWith('/members')) return jsonResponse([owner]);
        if (url.endsWith('/invitation-1') && init?.method === 'DELETE') {
          return new Response(null, { status: 204 });
        }
        return jsonResponse([invitation]);
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    renderSettings(workspace, 'members', owner.user_id);

    await screen.findByText('invited@example.com');
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Manage invitation for invited@example.com',
      }),
    );
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Revoke invitation' }),
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'https://kanleaf.example.com/api/workspaces/workspace-1/invitations/invitation-1',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });

  it('does not render an empty action menu for accepted invitation history', async () => {
    const accepted = {
      ...invitation,
      id: 'accepted-invitation',
      email: 'accepted@example.com',
      status: 'accepted',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        input.toString().endsWith('/members')
          ? jsonResponse([owner])
          : jsonResponse([accepted]),
      ),
    );
    renderSettings(workspace, 'members', owner.user_id);

    await screen.findByText('Invitation history');
    expect(
      screen.queryByRole('button', {
        name: 'Manage invitation for accepted@example.com',
      }),
    ).toBeNull();
  });

  it('requires the exact name and confirmation before deletion', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onRemoveWorkspace = vi.fn(async (remove: () => Promise<void>) =>
      remove(),
    );
    renderSettings(workspace, 'danger', owner.user_id, onRemoveWorkspace);

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
    expect(onRemoveWorkspace).toHaveBeenCalledWith(expect.any(Function));
  });
});

const workspace: Workspace = {
  id: 'workspace-1',
  identifier: 'kanleaf-core',
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
  onRemoveWorkspace: (remove: () => Promise<void>) => Promise<void> = async (
    remove,
  ) => remove(),
  definePropertyName?: string,
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
        definePropertyName={definePropertyName}
        onWorkspaceUpdated={vi.fn()}
        onConfigurationUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onRemoveWorkspace={onRemoveWorkspace}
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
