import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../../lib/api/types';
import { InviteSetupStep } from './InviteSetupStep';

const user: User = {
  id: 'user-1',
  email: 'owner@example.com',
  display_name: 'Owner',
  is_host: false,
  theme: 'system',
  timezone: 'UTC',
  week_start: 'monday',
  date_format: 'locale',
  active_workspace_id: 'workspace-1',
  setup_stage: 'invite',
};

describe('InviteSetupStep', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('makes invitations optional and completes setup against the server', async () => {
    const workspace = {
      id: 'workspace-1',
      identifier: 'kanleaf-core',
      name: 'Kanleaf Core',
      accent: 'sage',
      role: 'owner',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
    };
    const completed = { ...user, setup_stage: 'complete' as const };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([workspace]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(completed), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const onCompleted = vi.fn();
    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false } },
          })
        }
      >
        <InviteSetupStep
          context={{
            serverUrl: 'https://kanleaf.example.com',
            token: 'session-token',
          }}
          user={user}
          onCompleted={onCompleted}
          onSignOut={vi.fn()}
        />
      </QueryClientProvider>,
    );

    const skip = await screen.findByRole('button', { name: 'Skip for now' });
    expect(
      screen.queryByRole('button', { name: 'Finish without invitations' }),
    ).not.toBeInTheDocument();
    fireEvent.click(skip);

    await waitFor(() =>
      expect(onCompleted).toHaveBeenCalledWith(completed, workspace),
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://kanleaf.example.com/api/account/setup/complete',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
