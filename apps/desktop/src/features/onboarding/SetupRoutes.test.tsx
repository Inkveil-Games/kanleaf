import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../../lib/api/types';
import { SetupRoutes } from './SetupRoutes';

const user: User = {
  id: 'user-1',
  email: 'person@example.com',
  display_name: 'Person',
  is_host: false,
  theme: 'system',
  timezone: 'UTC',
  week_start: 'monday',
  date_format: 'locale',
  active_workspace_id: null,
  setup_stage: 'account',
};

describe('SetupRoutes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('replaces a mismatched setup URL with the server-owned stage', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/setup/invite']}>
          <SetupRoutes
            context={{
              serverUrl: 'https://kanleaf.example.com',
              token: 'session-token',
            }}
            user={user}
            onSessionChanged={vi.fn().mockResolvedValue(undefined)}
            onSignOut={vi.fn()}
          />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(
        screen.getByRole('status', { name: 'Current setup URL' }),
      ).toHaveTextContent('/setup/account'),
    );
    expect(
      screen.getByRole('heading', { name: 'Make Kanleaf feel like yours' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('1', { selector: '[aria-current="step"]' }),
    ).toBeInTheDocument();
  });

  it('keeps the created Workspace visible when session synchronization fails', async () => {
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

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/setup/workspace']}>
          <SetupRoutes
            context={{
              serverUrl: 'https://kanleaf.example.com',
              token: 'session-token',
            }}
            user={{ ...user, setup_stage: 'workspace' }}
            onSessionChanged={vi
              .fn()
              .mockRejectedValue(new Error('Session refresh failed'))}
            onSignOut={vi.fn()}
          />
          <LocationProbe />
        </MemoryRouter>
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
    expect(screen.queryByLabelText('Workspace name')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Kanleaf Core was created. Session refresh failed',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('status', { name: 'Current setup URL' }),
    ).toHaveTextContent('/setup/workspace');
  });
});

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current setup URL">{location.pathname}</output>;
}
