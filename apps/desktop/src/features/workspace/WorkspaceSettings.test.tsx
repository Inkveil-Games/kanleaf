import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { useState } from 'react';
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

    const { onDetailChange } = renderSettings(
      workspace,
      'properties',
      owner.user_id,
    );

    expect(
      await screen.findByRole('heading', { name: 'Properties' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Impact')).toBeInTheDocument();
    expect(screen.getByText('Single select')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'New property' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Impact' }));
    expect(onDetailChange).toHaveBeenCalledWith('properties', 'property-1', {
      history: 'push',
    });
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
    const { onDetailChange } = renderSettings(
      workspace,
      'properties',
      owner.user_id,
      undefined,
      undefined,
      'property-1',
    );

    expect(
      await screen.findByRole('heading', { name: 'Edit Platforms' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Web' }));
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Delete permanently' }),
    );
    const optionDialog = screen.getByRole('alertdialog', {
      name: 'Delete Web?',
    });
    fireEvent.click(
      within(optionDialog).getByRole('button', { name: 'Delete option' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Save changes' }),
    );

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
    expect(onDetailChange).toHaveBeenCalledWith('properties', undefined, {
      history: 'replace',
    });
  });

  it('does not navigate from a newer Settings route after an editor save finishes', async () => {
    const property = {
      id: 'property-1',
      workspace_id: workspace.id,
      name: 'Impact',
      type: 'text' as const,
      description: '',
      position: 0,
      configuration: {},
      options: [],
      usage_count: 0,
      archived_at: null,
      created_at: '2026-09-03T01:00:00Z',
      updated_at: '2026-09-03T01:00:00Z',
    };
    const saveResponse = deferred<Response>();
    let propertyReads = 0;
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = input.toString();
        if (init?.method === 'PATCH') return saveResponse.promise;
        if (url.endsWith('/properties/undefined')) {
          return Promise.resolve(jsonResponse([]));
        }
        propertyReads += 1;
        return Promise.resolve(jsonResponse([property]));
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const onDetailChange = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
      },
    });

    function RoutedProperties() {
      const [detail, setDetail] = useState<string | undefined>('property-1');
      return (
        <>
          <button type="button" onClick={() => setDetail(undefined)}>
            Leave property editor
          </button>
          <button type="button" onClick={() => setDetail('property-1')}>
            Reopen property editor
          </button>
          <WorkspaceSettings
            context={context}
            workspace={workspace}
            userId={owner.user_id}
            workspaceCount={2}
            section="properties"
            detail={detail}
            onWorkspaceUpdated={vi.fn()}
            onConfigurationUpdated={vi.fn()}
            onProjectsChanged={vi.fn()}
            onRemoveWorkspace={vi.fn()}
            onDetailChange={onDetailChange}
          />
        </>
      );
    }

    render(
      <QueryClientProvider client={queryClient}>
        <RoutedProperties />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Edit Impact' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/properties/property-1'),
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Leave property editor' }),
    );
    expect(
      await screen.findByRole('heading', { name: /^Properties$/ }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Reopen property editor' }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Edit Impact' }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'New editor draft' },
    });

    await act(async () => {
      saveResponse.resolve(jsonResponse(property));
      await saveResponse.promise;
    });
    await waitFor(() => expect(propertyReads).toBeGreaterThan(1));
    expect(onDetailChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Name')).toHaveValue('New editor draft');
  });

  it('lists undefined Markdown fields and requests a routed Define property flow', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.endsWith('/properties/undefined')) {
        return jsonResponse([{ name: 'External score', task_count: 2 }]);
      }
      return jsonResponse([]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { onDetailChange } = renderSettings(
      workspace,
      'properties',
      owner.user_id,
    );

    fireEvent.click(await screen.findByRole('tab', { name: 'Undefined' }));
    expect(await screen.findByText('External score')).toBeInTheDocument();
    expect(screen.getByText('2 Tasks')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Define External score' }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Define External score' }),
    );
    expect(onDetailChange).toHaveBeenCalledWith('properties', 'new', {
      history: 'push',
      definePropertyName: 'External score',
    });
  });

  it('renders and saves a routed Define property panel', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.endsWith('/properties/undefined')) {
        return jsonResponse([{ name: 'External score', task_count: 2 }]);
      }
      return jsonResponse([]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { onDetailChange } = renderSettings(
      workspace,
      'properties',
      owner.user_id,
      undefined,
      'External score',
      'new',
    );

    expect(
      await screen.findByRole('heading', { name: 'Define External score' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('External score');
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
    expect(onDetailChange).toHaveBeenCalledWith('properties', undefined, {
      history: 'replace',
    });
  });

  it('preserves the create draft when switching to Define property', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
      },
    });
    queryClient.setQueryData(['custom-properties', workspace.id], []);
    queryClient.setQueryData(
      ['undefined-properties', workspace.id],
      [{ name: 'External score', task_count: 2 }],
    );

    function RoutedPropertyEditor() {
      const [definePropertyName, setDefinePropertyName] = useState<
        string | undefined
      >();
      return (
        <WorkspaceSettings
          context={context}
          workspace={workspace}
          userId={owner.user_id}
          workspaceCount={2}
          section="properties"
          detail="new"
          onWorkspaceUpdated={vi.fn()}
          onConfigurationUpdated={vi.fn()}
          onProjectsChanged={vi.fn()}
          onRemoveWorkspace={vi.fn()}
          onDetailChange={(_section, _detail, options) => {
            if (options?.history === 'replace') {
              setDefinePropertyName(options.definePropertyName);
            }
          }}
          definePropertyName={definePropertyName}
        />
      );
    }

    render(
      <QueryClientProvider client={queryClient}>
        <RoutedPropertyEditor />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Create property' }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'External score' },
    });
    await chooseSelectOption('Property type', 'Number');
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Imported estimate' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create property' }));

    expect(
      await screen.findByRole('heading', { name: 'Define External score' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('External score');
    expect(
      screen.getByRole('combobox', { name: 'Property type' }),
    ).toHaveAttribute('data-value', 'number');
    expect(screen.getByLabelText('Description')).toHaveValue(
      'Imported estimate',
    );
  });

  it('cancels a routed create panel back to Properties', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([])));
    const { onDetailChange } = renderSettings(
      workspace,
      'properties',
      owner.user_id,
      undefined,
      undefined,
      'new',
    );

    expect(
      await screen.findByRole('heading', { name: 'Create property' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onDetailChange).toHaveBeenCalledWith('properties', undefined, {
      history: 'back',
    });
  });

  it('fails an unknown property detail gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([])));
    const { onDetailChange } = renderSettings(
      workspace,
      'properties',
      owner.user_id,
      undefined,
      undefined,
      'missing-property',
    );

    expect(
      await screen.findByRole('heading', { name: 'Property unavailable' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Properties' }));
    expect(onDetailChange).toHaveBeenCalledWith('properties', undefined, {
      history: 'back',
    });
  });

  it('returns an unsupported detail to its own Settings section', async () => {
    const { onDetailChange } = renderSettings(
      workspace,
      'members',
      owner.user_id,
      undefined,
      undefined,
      'unexpected-detail',
    );

    expect(
      screen.getByRole('heading', { name: 'Settings page unavailable' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to members' }));
    expect(onDetailChange).toHaveBeenCalledWith('members', undefined, {
      history: 'back',
    });
  });

  it('rejects a copied property editor route for non-admin members', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([])));

    renderSettings(
      { ...workspace, role: 'member' },
      'properties',
      member.user_id,
      undefined,
      'External score',
      'new',
    );

    expect(
      await screen.findByRole('heading', { name: 'Property unavailable' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
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

  it('requires the exact name and password before deletion', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const onRemoveWorkspace = vi.fn(async (remove: () => Promise<void>) =>
      remove(),
    );
    renderSettings(workspace, 'danger', owner.user_id, onRemoveWorkspace);

    const openDeleteDialog = screen.getByRole('button', {
      name: 'Delete Workspace',
    });
    fireEvent.click(openDeleteDialog);
    const dialog = screen.getByRole('alertdialog', {
      name: `Delete ${workspace.name} permanently?`,
    });
    const deleteButton = within(dialog).getByRole('button', {
      name: 'Delete Workspace',
    });
    expect(deleteButton).toBeDisabled();
    fireEvent.change(
      within(dialog).getByLabelText(`Type ${workspace.name} to confirm`),
      {
        target: { value: workspace.name },
      },
    );
    fireEvent.change(within(dialog).getByLabelText('Current password'), {
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
  detail?: string,
  onDetailChange = vi.fn(),
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
        detail={detail}
        definePropertyName={definePropertyName}
        onDetailChange={onDetailChange}
        onWorkspaceUpdated={vi.fn()}
        onConfigurationUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onRemoveWorkspace={onRemoveWorkspace}
      />
    </QueryClientProvider>,
  );
  return { onDetailChange };
}

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
