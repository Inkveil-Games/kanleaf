import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSetupStep } from './WorkspaceSetupStep';

describe('WorkspaceSetupStep', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('creates the first Workspace with its reviewed public identifier', async () => {
    const workspace = {
      id: 'workspace-1',
      identifier: 'kanleaf-core',
      name: 'Kanleaf Core',
      accent: 'sage',
      role: 'owner',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(workspace), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onWorkspaceCreated = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <WorkspaceSetupStep
          context={{
            serverUrl: 'https://kanleaf.example.com',
            token: 'session-token',
          }}
          isHost={false}
          onWorkspaceCreated={onWorkspaceCreated}
          onJoined={vi.fn()}
          onHostContinue={vi.fn()}
          onSignOut={vi.fn()}
        />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: 'Kanleaf Core' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Workspace' }));

    await waitFor(() =>
      expect(onWorkspaceCreated).toHaveBeenCalledWith(workspace),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://kanleaf.example.com/api/workspaces',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'Kanleaf Core',
          identifier: 'kanleaf-core',
        }),
      }),
    );
  });

  it('keeps a created Workspace and retries setup transition without creating it twice', async () => {
    const workspace = {
      id: 'workspace-1',
      identifier: 'kanleaf-core',
      name: 'Kanleaf Core',
      accent: 'sage',
      role: 'owner',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(workspace), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onWorkspaceCreated = vi
      .fn()
      .mockRejectedValueOnce(new Error('Session refresh failed'))
      .mockResolvedValueOnce(undefined);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <WorkspaceSetupStep
          context={{
            serverUrl: 'https://kanleaf.example.com',
            token: 'session-token',
          }}
          isHost={false}
          onWorkspaceCreated={onWorkspaceCreated}
          onJoined={vi.fn()}
          onHostContinue={vi.fn()}
          onSignOut={vi.fn()}
        />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: 'Kanleaf Core' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Workspace' }));

    expect(
      await screen.findByRole('heading', {
        name: 'Invite people to Kanleaf Core',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('/kanleaf-core')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.queryByLabelText('Workspace name')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Kanleaf Core was created. Session refresh failed',
    );
    const retry = screen.getByRole('button', {
      name: 'Retry opening Workspace',
    });

    fireEvent.click(retry);

    await waitFor(() => expect(onWorkspaceCreated).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Workspace name')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Skip invitations' }),
    ).toBeInTheDocument();
  });

  it('can delegate creation to the Workspace transition coordinator', async () => {
    const workspace = {
      id: 'workspace-1',
      identifier: 'kanleaf-core',
      name: 'Kanleaf Core',
      accent: 'sage' as const,
      role: 'owner' as const,
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
    };
    const createWorkspaceAction = vi.fn().mockResolvedValue(workspace);
    const onWorkspaceCreated = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(
      <QueryClientProvider client={new QueryClient()}>
        <WorkspaceSetupStep
          context={{
            serverUrl: 'https://kanleaf.example.com',
            token: 'session-token',
          }}
          isHost={false}
          createWorkspaceAction={createWorkspaceAction}
          onWorkspaceCreated={onWorkspaceCreated}
          onJoined={vi.fn()}
          onHostContinue={vi.fn()}
          onSignOut={vi.fn()}
        />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: 'Kanleaf Core' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Workspace' }));

    await waitFor(() =>
      expect(createWorkspaceAction).toHaveBeenCalledWith({
        name: 'Kanleaf Core',
        identifier: 'kanleaf-core',
      }),
    );
    expect(onWorkspaceCreated).toHaveBeenCalledWith(workspace);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows a retryable error when the Host Console shortcut fails', async () => {
    const onHostContinue = vi
      .fn()
      .mockRejectedValueOnce(new Error('Setup could not be completed'))
      .mockResolvedValueOnce(undefined);

    render(
      <QueryClientProvider client={new QueryClient()}>
        <WorkspaceSetupStep
          context={{
            serverUrl: 'https://kanleaf.example.com',
            token: 'session-token',
          }}
          isHost
          onWorkspaceCreated={vi.fn()}
          onJoined={vi.fn()}
          onHostContinue={onHostContinue}
          onSignOut={vi.fn()}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Continue to Host Console' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Setup could not be completed',
    );
    const retry = screen.getByRole('button', {
      name: 'Continue to Host Console',
    });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    await waitFor(() => expect(onHostContinue).toHaveBeenCalledTimes(2));
  });
});
