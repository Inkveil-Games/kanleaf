import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  upsertAccountSession,
  writeServerAccountSessions,
  type AccountSession,
} from '../features/auth/accountSessionStore';
import { App } from './App';
import { Providers } from './providers';

vi.mock('../features/workspace/WorkspaceShell', () => ({
  WorkspaceShell: ({ user }: { user: { email: string } }) => (
    <div>Workspace for {user.email}</div>
  ),
}));

describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('connects to the configured server before showing authentication', async () => {
    vi.stubEnv('VITE_KANLEAF_SERVER_URL', 'https://kanleaf.example.com/base/');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'ok',
          service: 'kanleaf',
          version: '0.1.0',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <Providers>
        <App />
      </Providers>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Sign in to Kanleaf' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'https://kanleaf.example.com/base/api/health',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
  });

  it('explains when the server environment variable is missing', () => {
    vi.stubEnv('VITE_KANLEAF_SERVER_URL', '');

    render(
      <Providers>
        <App />
      </Providers>,
    );

    expect(
      screen.getByRole('heading', { name: 'Server not configured' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/VITE_KANLEAF_SERVER_URL/)).toBeInTheDocument();
  });

  it('allows retrying an unavailable configured server', async () => {
    vi.stubEnv('VITE_KANLEAF_SERVER_URL', 'http://127.0.0.1:3000');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'ok', service: 'other' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'ok',
            service: 'kanleaf',
            version: '0.1.0',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <Providers>
        <App />
      </Providers>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Server unavailable' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('heading', { name: 'Sign in to Kanleaf' }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('requires an explicit choice when retained accounts have no active identity', async () => {
    vi.stubEnv('VITE_KANLEAF_SERVER_URL', 'https://kanleaf.example.com');
    writeServerAccountSessions('https://kanleaf.example.com', {
      active_user_id: null,
      accounts: [account('user-1')],
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(healthResponse()));

    render(
      <Providers>
        <App />
      </Providers>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Choose an account' }),
    ).toBeInTheDocument();
    expect(screen.getByText('user-1@example.com')).toBeInTheDocument();
  });

  it('restores and validates the explicitly active retained account', async () => {
    vi.stubEnv('VITE_KANLEAF_SERVER_URL', 'https://kanleaf.example.com');
    writeServerAccountSessions(
      'https://kanleaf.example.com',
      upsertAccountSession(
        { active_user_id: null, accounts: [] },
        account('user-1'),
        true,
      ),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) =>
        Promise.resolve(
          url.endsWith('/api/health')
            ? healthResponse()
            : new Response(JSON.stringify(session('user-1')), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }),
        ),
      ),
    );

    render(
      <Providers>
        <App />
      </Providers>,
    );

    expect(
      await screen.findByText('Workspace for user-1@example.com'),
    ).toBeInTheDocument();
  });

  it('does not silently fall back after the active session expires', async () => {
    vi.stubEnv('VITE_KANLEAF_SERVER_URL', 'https://kanleaf.example.com');
    const retained = upsertAccountSession(
      upsertAccountSession(
        { active_user_id: null, accounts: [] },
        account('user-1'),
        true,
      ),
      account('user-2'),
      false,
    );
    writeServerAccountSessions('https://kanleaf.example.com', retained);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) =>
        Promise.resolve(
          url.endsWith('/api/health')
            ? healthResponse()
            : new Response(
                JSON.stringify({
                  error: { code: 'unauthorized', message: 'Session expired' },
                }),
                {
                  status: 401,
                  headers: { 'content-type': 'application/json' },
                },
              ),
        ),
      ),
    );

    render(
      <Providers>
        <App />
      </Providers>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Choose an account' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('user-1@example.com')).not.toBeInTheDocument();
    expect(screen.getByText('user-2@example.com')).toBeInTheDocument();
  });
});

function account(userId: string): AccountSession {
  return {
    user_id: userId,
    email: `${userId}@example.com`,
    display_name: `Account ${userId}`,
    token: `${userId}-token`,
    expires_at: '2026-09-30T00:00:00Z',
    last_used_at: '2026-08-30T00:00:00Z',
  };
}

function healthResponse() {
  return new Response(
    JSON.stringify({ status: 'ok', service: 'kanleaf', version: '0.1.0' }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function session(userId: string) {
  return {
    expires_at: '2026-09-30T00:00:00Z',
    user: {
      id: userId,
      email: `${userId}@example.com`,
      display_name: `Account ${userId}`,
      theme: 'system',
      timezone: 'UTC',
      week_start: 'monday',
      date_format: 'locale',
      active_workspace_id: `${userId}-workspace`,
    },
  };
}
