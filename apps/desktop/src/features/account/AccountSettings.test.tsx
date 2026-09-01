import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../../lib/api/types';
import type { Workspace, WorkspaceInvitation } from '../workspace/types';
import { AccountSettings } from './AccountSettings';

const user: User = {
  id: 'user-1',
  email: 'person@example.com',
  display_name: 'Person Example',
  is_host: false,
  theme: 'system',
  timezone: 'UTC',
  week_start: 'monday',
  date_format: 'locale',
  active_workspace_id: 'workspace-1',
  setup_stage: 'complete',
};

const context = {
  serverUrl: 'https://kanleaf.example.com',
  token: 'session-token',
};

const joinedWorkspace: Workspace = {
  id: 'workspace-2',
  identifier: 'shared-notes',
  name: 'Shared Notes',
  accent: 'sage',
  role: 'member',
  created_at: '2026-08-27T01:00:00Z',
  updated_at: '2026-08-27T01:00:00Z',
};

describe('AccountSettings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('updates the account profile', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ...user, display_name: 'Quang Tran' }));
    vi.stubGlobal('fetch', fetchMock);
    renderSettings('profile');

    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: 'Quang Tran' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(await screen.findByText('Profile updated')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://kanleaf.example.com/api/account/profile',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ display_name: 'Quang Tran' }),
      }),
    );
  });

  it('does not offer to revoke the current session', async () => {
    const sessions = [
      {
        id: 'current-session',
        created_at: '2026-08-27T01:00:00Z',
        expires_at: '2026-09-27T01:00:00Z',
        is_current: true,
      },
      {
        id: 'other-session',
        created_at: '2026-08-20T01:00:00Z',
        expires_at: '2026-09-20T01:00:00Z',
        is_current: false,
      },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(sessions)));
    renderSettings('security');

    const currentRow = (await screen.findByText('Current session')).closest(
      '.settings-row',
    );
    expect(currentRow).not.toBeNull();
    expect(
      within(currentRow as HTMLElement).queryByRole('button', {
        name: 'Revoke',
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
  });

  it('accepts an invitation addressed to the account', async () => {
    const invitation = {
      id: 'invitation-1',
      workspace_id: 'workspace-2',
      workspace_name: 'Shared Notes',
      workspace_identifier: 'shared-notes',
      email: user.email,
      role: 'member',
      invited_by_display_name: 'Workspace Owner',
      status: 'pending',
      expires_at: '2026-09-01T01:00:00Z',
      created_at: '2026-08-27T01:00:00Z',
      updated_at: '2026-08-27T01:00:00Z',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([invitation]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse([joinedWorkspace]));
    vi.stubGlobal('fetch', fetchMock);
    const onWorkspaceJoined = vi.fn();
    renderSettings('invitations', onWorkspaceJoined);

    expect(await screen.findByText('Shared Notes')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Accept invitation to Shared Notes (/shared-notes)',
      }),
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'https://kanleaf.example.com/api/invitations/invitation-1/accept',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect(
      await screen.findByText('No pending invitations'),
    ).toBeInTheDocument();
    expect(onWorkspaceJoined).toHaveBeenCalledWith(joinedWorkspace);
  });

  it('forwards the resolved Workspace after accepting an invitation token', async () => {
    const invitation: WorkspaceInvitation = {
      id: 'invitation-1',
      workspace_id: joinedWorkspace.id,
      workspace_name: joinedWorkspace.name,
      workspace_identifier: joinedWorkspace.identifier,
      email: user.email,
      role: 'member',
      invited_by_display_name: 'Workspace Owner',
      status: 'pending',
      expires_at: '2026-09-01T01:00:00Z',
      created_at: '2026-08-27T01:00:00Z',
      updated_at: '2026-08-27T01:00:00Z',
    };
    let invitationReads = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith('/api/invitations/accept-token')) {
          return new Response(null, { status: 204 });
        }
        if (url.endsWith('/api/invitations')) {
          invitationReads += 1;
          return jsonResponse(invitationReads === 1 ? [invitation] : []);
        }
        if (url.endsWith('/api/workspaces')) {
          return jsonResponse([joinedWorkspace]);
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    const onWorkspaceJoined = vi.fn();
    renderSettings('invitations', onWorkspaceJoined);

    await screen.findByText('Shared Notes');
    fireEvent.change(screen.getByLabelText('Invitation token'), {
      target: { value: 'shared-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Accept token' }));

    await waitFor(() =>
      expect(onWorkspaceJoined).toHaveBeenCalledWith(joinedWorkspace),
    );
  });
});

function renderSettings(
  section:
    'profile' | 'preferences' | 'security' | 'invitations' | 'notifications',
  onWorkspaceJoined = vi.fn(),
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AccountSettings
        context={context}
        initialUser={user}
        section={section}
        onWorkspaceJoined={onWorkspaceJoined}
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
