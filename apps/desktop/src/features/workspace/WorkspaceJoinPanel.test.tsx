import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Workspace, WorkspaceInvitation } from './types';
import { WorkspaceJoinPanel } from './WorkspaceJoinPanel';

const invitation: WorkspaceInvitation = {
  id: 'invitation-1',
  workspace_id: 'workspace-1',
  workspace_name: 'Kanleaf Core',
  workspace_identifier: 'kanleaf-core',
  email: 'member@example.com',
  role: 'member',
  invited_by_display_name: 'Owner',
  status: 'pending',
  expires_at: '2026-09-08T00:00:00Z',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

const joinedWorkspace: Workspace = {
  id: 'workspace-1',
  identifier: 'kanleaf-core',
  name: 'Kanleaf Core',
  accent: 'sage',
  role: 'member',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

describe('WorkspaceJoinPanel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('accepts a pending invitation and reports the joined Workspace', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([invitation]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([joinedWorkspace]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const onJoined = vi.fn();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <WorkspaceJoinPanel
          context={{
            serverUrl: 'https://kanleaf.example.com',
            token: 'session-token',
          }}
          onJoined={onJoined}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Accept invitation to Kanleaf Core (/kanleaf-core)',
      }),
    );

    await waitFor(() => expect(onJoined).toHaveBeenCalledWith(joinedWorkspace));
    expect(fetchMock).toHaveBeenCalledWith(
      'https://kanleaf.example.com/api/invitations/invitation-1/accept',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://kanleaf.example.com/api/workspaces',
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
  });

  it('resolves a token acceptance through the removed invitation and fresh memberships', async () => {
    const remainingInvitation: WorkspaceInvitation = {
      ...invitation,
      id: 'invitation-2',
      workspace_id: 'workspace-other',
      workspace_name: 'Other Workspace',
      workspace_identifier: 'other-workspace',
    };
    let invitationReads = 0;
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/api/invitations/accept-token')) {
          expect(init).toEqual(expect.objectContaining({ method: 'POST' }));
          return new Response(null, { status: 204 });
        }
        if (url.endsWith('/api/invitations')) {
          invitationReads += 1;
          return new Response(
            JSON.stringify(
              invitationReads === 1
                ? [remainingInvitation, invitation]
                : [remainingInvitation],
            ),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          );
        }
        if (url.endsWith('/api/workspaces')) {
          return new Response(JSON.stringify([joinedWorkspace]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const onJoined = vi.fn();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <WorkspaceJoinPanel
          context={{
            serverUrl: 'https://kanleaf.example.com',
            token: 'session-token',
          }}
          onJoined={onJoined}
        />
      </QueryClientProvider>,
    );

    await screen.findByText('Kanleaf Core');
    fireEvent.change(screen.getByLabelText('Invitation token'), {
      target: { value: 'shared-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Accept token' }));

    await waitFor(() => expect(onJoined).toHaveBeenCalledWith(joinedWorkspace));
    expect(invitationReads).toBe(2);
  });

  it('distinguishes invitations to Workspaces with the same name by public ID', async () => {
    const duplicateName = {
      ...invitation,
      id: 'invitation-2',
      workspace_id: 'workspace-2',
      workspace_identifier: 'kanleaf-community',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify([invitation, duplicateName]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <WorkspaceJoinPanel
          context={{
            serverUrl: 'https://kanleaf.example.com',
            token: 'session-token',
          }}
          onJoined={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole('button', {
        name: 'Accept invitation to Kanleaf Core (/kanleaf-core)',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Accept invitation to Kanleaf Core (/kanleaf-community)',
      }),
    ).toBeInTheDocument();
  });
});
