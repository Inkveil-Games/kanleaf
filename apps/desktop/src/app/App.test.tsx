import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  upsertAccountSession,
  writeServerAccountSessions,
  type AccountSession,
} from '../features/auth/accountSessionStore';
import { apiRequest } from '../lib/api/client';
import { App } from './App';
import { Providers } from './providers';

vi.mock('../features/workspace/WorkspaceShell', () => ({
  WorkspaceShell: ({
    user,
    onOpenHostConsole,
  }: {
    user: { email: string };
    onOpenHostConsole?: () => void;
  }) => (
    <div>
      Workspace for {user.email}
      {onOpenHostConsole ? (
        <button type="button" onClick={onOpenHostConsole}>
          Host Console
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock('../features/host/HostConsole', () => ({
  HostConsole: ({ onClose }: { onClose: () => void }) => (
    <div>
      <h1>Host Console</h1>
      <button type="button" onClick={onClose}>
        Back to Workspace
      </button>
    </div>
  ),
}));

describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/');
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

  it('restores a Host session directly into /host', async () => {
    window.history.replaceState(null, '', '/host');
    retainAccount('host-1');
    stubHealthySession('host-1', true);

    render(
      <Providers>
        <App />
      </Providers>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Host Console' }),
    ).toBeInTheDocument();
  });

  it('keeps anonymous /host visitors on normal authentication', async () => {
    window.history.replaceState(null, '', '/host');
    vi.stubEnv('VITE_KANLEAF_SERVER_URL', 'https://kanleaf.example.com');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(healthResponse()));

    render(
      <Providers>
        <App />
      </Providers>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Sign in to Kanleaf' }),
    ).toBeInTheDocument();
  });

  it('denies /host to a restored non-Host session', async () => {
    window.history.replaceState(null, '', '/host');
    retainAccount('user-1');
    stubHealthySession('user-1', false);

    render(
      <Providers>
        <App />
      </Providers>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Host access required' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Workspace' }));
    expect(
      await screen.findByText('Workspace for user-1@example.com'),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });

  it('opens Host Console from the Host account action and handles history', async () => {
    retainAccount('host-1');
    stubHealthySession('host-1', true);

    render(
      <Providers>
        <App />
      </Providers>,
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Host Console' }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Host Console' }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe('/host');

    window.history.pushState(null, '', '/');
    fireEvent.popState(window);
    expect(
      await screen.findByText('Workspace for host-1@example.com'),
    ).toBeInTheDocument();
  });

  it('discards the exact retained token after any authenticated request receives 401', async () => {
    retainAccount('user-1');
    const fetchMock = stubHealthySession('user-1', false);

    render(
      <Providers>
        <App />
      </Providers>,
    );
    expect(
      await screen.findByText('Workspace for user-1@example.com'),
    ).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: 'unauthorized',
            message: 'Session is no longer valid',
          },
        }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      ),
    );
    const requestError = await apiRequest(
      'https://kanleaf.example.com',
      '/api/workspaces',
      {
        token: 'user-1-token',
      },
    ).catch((cause: unknown) => cause);
    expect((requestError as { status: number }).status).toBe(401);

    expect(
      await screen.findByRole('heading', { name: 'Sign in to Kanleaf' }),
    ).toBeInTheDocument();
    expect(readRetainedUserIds('https://kanleaf.example.com')).not.toContain(
      'user-1',
    );
  });
});

function retainAccount(userId: string) {
  vi.stubEnv('VITE_KANLEAF_SERVER_URL', 'https://kanleaf.example.com');
  writeServerAccountSessions(
    'https://kanleaf.example.com',
    upsertAccountSession(
      { active_user_id: null, accounts: [] },
      account(userId),
      true,
    ),
  );
}

function stubHealthySession(userId: string, isHost: boolean) {
  const fetchMock = vi.fn().mockImplementation((url: string) =>
    Promise.resolve(
      url.endsWith('/api/health')
        ? healthResponse()
        : new Response(JSON.stringify(session(userId, isHost)), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function readRetainedUserIds(serverUrl: string) {
  const value = localStorage.getItem('kanleaf.account-sessions.v1');
  if (!value) return [];
  const registry = JSON.parse(value) as {
    servers: Record<string, { accounts: AccountSession[] }>;
  };
  return (registry.servers[serverUrl]?.accounts ?? []).map(
    ({ user_id }) => user_id,
  );
}

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

function session(userId: string, isHost = false) {
  return {
    expires_at: '2026-09-30T00:00:00Z',
    user: {
      id: userId,
      email: `${userId}@example.com`,
      display_name: `Account ${userId}`,
      is_host: isHost,
      theme: 'system',
      timezone: 'UTC',
      week_start: 'monday',
      date_format: 'locale',
      active_workspace_id: `${userId}-workspace`,
    },
  };
}
