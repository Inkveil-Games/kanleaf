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
};

const context = {
  serverUrl: 'https://kanleaf.example.com',
  token: 'session-token',
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
      .mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);
    renderSettings('invitations');

    expect(await screen.findByText('Shared Notes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'https://kanleaf.example.com/api/invitations/invitation-1/accept',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect(
      await screen.findByText('No pending invitations'),
    ).toBeInTheDocument();
  });
});

function renderSettings(
  section: 'profile' | 'preferences' | 'security' | 'invitations',
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AccountSettings context={context} initialUser={user} section={section} />
    </QueryClientProvider>,
  );
}

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
