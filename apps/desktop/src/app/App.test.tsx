import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  MemoryRouter,
  useLocation,
  useNavigate,
  type InitialEntry,
} from 'react-router';
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
  HostConsole: ({
    section,
    onSectionChange,
    onClose,
  }: {
    section: 'workspaces' | 'access';
    onSectionChange: (section: 'workspaces' | 'access') => void;
    onClose: () => void;
  }) => (
    <div>
      <h1>Host Console</h1>
      <p>Host section: {section}</p>
      <button type="button" onClick={() => onSectionChange('access')}>
        Access
      </button>
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

    renderApp();

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

    renderApp();

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

    renderApp();

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

    renderApp();

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
      vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('/api/health'))
          return Promise.resolve(healthResponse());
        const payload = url.endsWith('/api/workspaces')
          ? [workspace('user-1')]
          : session('user-1');
        return Promise.resolve(
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }),
    );

    renderApp();

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

    renderApp();

    expect(
      await screen.findByRole('heading', { name: 'Choose an account' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('user-1@example.com')).not.toBeInTheDocument();
    expect(screen.getByText('user-2@example.com')).toBeInTheDocument();
  });

  it('restores a Host session directly into /host', async () => {
    retainAccount('host-1');
    stubHealthySession('host-1', true);

    renderApp(['/host']);

    expect(
      await screen.findByRole('heading', { name: 'Host Console' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Host section: workspaces')).toBeInTheDocument();
    expect(currentLocation()).toHaveTextContent(/^\/host$/);
  });

  it('restores a Host session directly into the Access route', async () => {
    retainAccount('host-1');
    stubHealthySession('host-1', true);

    renderApp(['/host/access']);

    expect(
      await screen.findByRole('heading', { name: 'Host Console' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Host section: access')).toBeInTheDocument();
    expect(currentLocation()).toHaveTextContent('/host/access');
  });

  it('does not add history when the active Host section is selected again', async () => {
    retainAccount('host-1');
    stubHealthySession('host-1', true);

    renderApp(['/host', '/host/access']);

    fireEvent.click(await screen.findByRole('button', { name: 'Access' }));
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));

    expect(currentLocation()).toHaveTextContent(/^\/host$/);
    expect(screen.getByText('Host section: workspaces')).toBeInTheDocument();
  });

  it('replaces a trailing slash without discarding search state', async () => {
    retainAccount('host-1');
    stubHealthySession('host-1', true);

    renderApp(['/host/access/?source=bookmark']);

    expect(
      await screen.findByRole('heading', { name: 'Host Console' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(currentLocation()).toHaveTextContent(
        '/host/access?source=bookmark',
      ),
    );
  });

  it('replaces an unknown Host child with Host Workspaces', async () => {
    retainAccount('host-1');
    stubHealthySession('host-1', true);

    renderApp(['/host/not-a-section']);

    expect(
      await screen.findByRole('heading', { name: 'Host Console' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Host section: workspaces')).toBeInTheDocument();
    expect(currentLocation()).toHaveTextContent('/host');
  });

  it('keeps anonymous /host visitors on normal authentication', async () => {
    vi.stubEnv('VITE_KANLEAF_SERVER_URL', 'https://kanleaf.example.com');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(healthResponse()));

    renderApp(['/host/access']);

    expect(
      await screen.findByRole('heading', { name: 'Sign in to Kanleaf' }),
    ).toBeInTheDocument();
    expect(currentLocation()).toHaveTextContent('/host/access');
  });

  it('opens an anonymous direct invitation before the generic auth route', async () => {
    vi.stubEnv('VITE_KANLEAF_SERVER_URL', 'https://kanleaf.example.com');
    const token = 'A'.repeat(43);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) =>
        Promise.resolve(
          url.endsWith('/api/health')
            ? healthResponse()
            : new Response(
                JSON.stringify({
                  status: 'pending',
                  workspace_name: 'Invited Workspace',
                  workspace_identifier: 'invited-workspace',
                  invited_by_display_name: 'Owner',
                  role: 'member',
                  expires_at: '2026-09-30T00:00:00Z',
                  invitee_email_hint: 'i***@example.com',
                  account_email_matches: null,
                }),
                {
                  status: 200,
                  headers: { 'content-type': 'application/json' },
                },
              ),
        ),
      ),
    );

    renderApp([`/invite/#token=${token}`]);

    expect(
      await screen.findByRole('heading', { name: 'Invited Workspace' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Sign in to Kanleaf' }),
    ).not.toBeInTheDocument();
    expect(currentLocation()).toHaveTextContent(`/invite#token=${token}`);
  });

  it('opens forgot-password as a public route without a session', async () => {
    vi.stubEnv('VITE_KANLEAF_SERVER_URL', 'https://kanleaf.example.com');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(healthResponse()));

    renderApp(['/forgot-password']);

    expect(
      await screen.findByRole('heading', { name: 'Forgot your password?' }),
    ).toBeInTheDocument();
    expect(currentLocation()).toHaveTextContent('/forgot-password');
  });

  it('navigates from normal sign-in to password recovery', async () => {
    vi.stubEnv('VITE_KANLEAF_SERVER_URL', 'https://kanleaf.example.com');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(healthResponse()));
    renderApp();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Forgot password?' }),
    );

    expect(
      screen.getByRole('heading', { name: 'Forgot your password?' }),
    ).toBeInTheDocument();
    expect(currentLocation()).toHaveTextContent('/forgot-password');
  });

  it('opens a reset fragment as a public route without leaking it to a query', async () => {
    vi.stubEnv('VITE_KANLEAF_SERVER_URL', 'https://kanleaf.example.com');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(healthResponse()));
    const token = 'R'.repeat(43);

    renderApp([`/reset-password#token=${token}`]);

    expect(
      await screen.findByRole('heading', { name: 'Set a new password' }),
    ).toBeInTheDocument();
    expect(currentLocation()).toHaveTextContent(
      `/reset-password#token=${token}`,
    );
    expect(currentLocation()).not.toHaveTextContent('?token=');
  });

  it('discards a retained session that the completed reset revoked', async () => {
    retainAccount('user-1');
    let sessionRequests = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('/api/health')) {
          return Promise.resolve(healthResponse());
        }
        if (url.endsWith('/api/auth/reset-password')) {
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        if (url.endsWith('/api/session')) {
          sessionRequests += 1;
          return Promise.resolve(
            sessionRequests === 1
              ? new Response(JSON.stringify(session('user-1')), {
                  status: 200,
                  headers: { 'content-type': 'application/json' },
                })
              : new Response(
                  JSON.stringify({
                    error: {
                      code: 'unauthorized',
                      message: 'Session is no longer valid',
                    },
                  }),
                  {
                    status: 401,
                    headers: { 'content-type': 'application/json' },
                  },
                ),
          );
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    const resetToken = 'R'.repeat(43);
    renderApp([`/reset-password#token=${resetToken}`]);
    await screen.findByRole('heading', { name: 'Set a new password' });
    await waitFor(() => expect(sessionRequests).toBe(1));

    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'new correct horse battery' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'new correct horse battery' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    await screen.findByRole('heading', { name: 'Password updated' });
    expect(sessionRequests).toBe(2);
    expect(readRetainedUserIds('https://kanleaf.example.com')).not.toContain(
      'user-1',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(
      await screen.findByRole('heading', { name: 'Sign in to Kanleaf' }),
    ).toBeInTheDocument();
  });

  it('denies /host to a restored non-Host session', async () => {
    retainAccount('user-1');
    stubHealthySession('user-1', false);

    renderApp(['/host/access']);

    expect(
      await screen.findByRole('heading', { name: 'Host access required' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Workspace' }));
    expect(
      await screen.findByText('Workspace for user-1@example.com'),
    ).toBeInTheDocument();
    expect(currentLocation()).toHaveTextContent('/');
  });

  it('opens Host Console from the Host account action and handles history', async () => {
    retainAccount('host-1');
    stubHealthySession('host-1', true);

    renderApp();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Host Console' }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Host Console' }),
    ).toBeInTheDocument();
    expect(currentLocation()).toHaveTextContent('/host');

    fireEvent.click(screen.getByRole('button', { name: 'Access' }));
    expect(currentLocation()).toHaveTextContent('/host/access');
    expect(screen.getByText('Host section: access')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(currentLocation()).toHaveTextContent('/host');
    fireEvent.click(screen.getByRole('button', { name: 'Go forward' }));
    expect(currentLocation()).toHaveTextContent('/host/access');

    fireEvent.click(screen.getByRole('button', { name: 'Back to Workspace' }));
    expect(
      await screen.findByText('Workspace for host-1@example.com'),
    ).toBeInTheDocument();
    expect(currentLocation()).toHaveTextContent('/');
  });

  it('discards the exact retained token after any authenticated request receives 401', async () => {
    retainAccount('user-1');
    const fetchMock = stubHealthySession('user-1', false);

    renderApp();
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

function renderApp(initialEntries: InitialEntry[] = ['/']) {
  return render(
    <Providers>
      <MemoryRouter initialEntries={initialEntries}>
        <App />
        <LocationProbe />
      </MemoryRouter>
    </Providers>,
  );
}

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div>
      <output aria-label="Current location">
        {location.pathname}
        {location.search}
        {location.hash}
      </output>
      <button type="button" onClick={() => navigate(-1)}>
        Go back
      </button>
      <button type="button" onClick={() => navigate(1)}>
        Go forward
      </button>
    </div>
  );
}

function currentLocation() {
  return screen.getByRole('status', { name: 'Current location' });
}

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
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url.endsWith('/api/health')) return Promise.resolve(healthResponse());
    const payload = url.endsWith('/api/workspaces')
      ? [workspace(userId)]
      : session(userId, isHost);
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
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
      setup_stage: 'complete',
    },
  };
}

function workspace(userId: string) {
  return {
    id: `${userId}-workspace`,
    identifier: `${userId}-workspace`,
    name: `Workspace ${userId}`,
    accent: 'sage',
    role: 'owner',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  };
}
