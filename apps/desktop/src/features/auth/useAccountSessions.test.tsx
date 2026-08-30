import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthResponse, SessionResponse, User } from '../../lib/api/types';
import {
  readLegacySessionToken,
  readServerAccountSessions,
  upsertAccountSession,
  writeLegacySessionToken,
  writeServerAccountSessions,
  type AccountSession,
} from './accountSessionStore';
import { useAccountSessions } from './useAccountSessions';

const serverUrl = 'https://kanleaf.example.com';

describe('useAccountSessions', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('validates and commits an explicit account switch', async () => {
    retainAccounts(account('user-1'), account('user-2'));
    const flushDocumentSaves = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue(sessionResponse('user-2'));
    vi.stubGlobal('fetch', fetchMock);
    const { result, queryClient } = renderAccountSessions(flushDocumentSaves);
    queryClient.setQueryData(['health', serverUrl], true);
    queryClient.setQueryData(['tasks', 'workspace-1'], ['private task']);

    await act(() => result.current.switchAccount('user-2'));

    expect(flushDocumentSaves).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      `${serverUrl}/api/session`,
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(request.headers).get('authorization')).toBe(
      'Bearer user-2-token',
    );
    expect(result.current.token).toBe('user-2-token');
    expect(result.current.sessions.active_user_id).toBe('user-2');
    expect(readServerAccountSessions(serverUrl).active_user_id).toBe('user-2');
    expect(queryClient.getQueryData(['tasks', 'workspace-1'])).toBeUndefined();
    expect(queryClient.getQueryData(['health', serverUrl])).toBe(true);
  });

  it('removes an expired target without changing the active identity', async () => {
    retainAccounts(account('user-1'), account('user-2'));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'unauthorized', message: 'Session expired' },
          }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    const { result } = renderAccountSessions(
      vi.fn().mockResolvedValue(undefined),
    );

    await act(() => result.current.switchAccount('user-2'));

    expect(result.current.token).toBe('user-1-token');
    expect(
      result.current.sessions.accounts.map(({ user_id }) => user_id),
    ).toEqual(['user-1']);
    expect(result.current.error).toBe('Session expired');
  });

  it('retains a newly authenticated account when Markdown blocks switching', async () => {
    retainAccounts(account('user-1'));
    const { result } = renderAccountSessions(
      vi.fn().mockRejectedValue(new Error('Resolve unsaved Markdown')),
    );

    await act(() => result.current.addAuthenticated(authResponse('user-2')));

    expect(result.current.token).toBe('user-1-token');
    expect(
      result.current.sessions.accounts.map(({ user_id }) => user_id),
    ).toEqual(expect.arrayContaining(['user-1', 'user-2']));
    expect(result.current.error).toBe(
      'Account added. Resolve unsaved Markdown before switching.',
    );
  });

  it('keeps a target account after a network failure', async () => {
    retainAccounts(account('user-1'), account('user-2'));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Network down')),
    );
    const { result } = renderAccountSessions(
      vi.fn().mockResolvedValue(undefined),
    );

    await act(() => result.current.switchAccount('user-2'));

    expect(result.current.token).toBe('user-1-token');
    expect(result.current.sessions.accounts).toHaveLength(2);
    expect(result.current.error).toBe('Network down');
  });

  it('replaces a duplicate active user only after its document flushes', async () => {
    retainAccounts(account('user-1'));
    const flushDocumentSaves = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderAccountSessions(flushDocumentSaves);

    await act(() =>
      result.current.addAuthenticated({
        ...authResponse('user-1'),
        token: 'replacement-token',
      }),
    );

    expect(flushDocumentSaves).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.current.token).toBe('replacement-token');
    expect(result.current.sessions.accounts).toHaveLength(1);
    expect(result.current.sessions.accounts[0]?.token).toBe(
      'replacement-token',
    );
  });

  it('migrates a validated legacy token into the registry', () => {
    writeLegacySessionToken('legacy-token');
    const { result } = renderAccountSessions(
      vi.fn().mockResolvedValue(undefined),
    );
    expect(result.current.token).toBe('legacy-token');

    act(() =>
      result.current.synchronizeValidatedSession(
        'legacy-token',
        sessionPayload('user-1'),
      ),
    );

    expect(readLegacySessionToken()).toBeNull();
    expect(result.current.sessions.active_user_id).toBe('user-1');
    expect(result.current.sessions.accounts[0]?.token).toBe('legacy-token');
  });

  it('signs out only the active account without choosing another identity', async () => {
    retainAccounts(account('user-1'), account('user-2'));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );
    const { result } = renderAccountSessions(
      vi.fn().mockResolvedValue(undefined),
    );

    await act(() => result.current.signOutCurrent());

    expect(result.current.token).toBeNull();
    expect(result.current.sessions.active_user_id).toBeNull();
    expect(
      result.current.sessions.accounts.map(({ user_id }) => user_id),
    ).toEqual(['user-2']);
  });
});

function renderAccountSessions(flushDocumentSaves: () => Promise<void>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const rendered = renderHook(
    () => useAccountSessions(serverUrl, flushDocumentSaves),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    },
  );
  return { ...rendered, queryClient };
}

function retainAccounts(active: AccountSession, ...others: AccountSession[]) {
  const sessions = others.reduce(
    (current, candidate) => upsertAccountSession(current, candidate, false),
    upsertAccountSession({ active_user_id: null, accounts: [] }, active, true),
  );
  writeServerAccountSessions(serverUrl, sessions);
}

function account(userId: string): AccountSession {
  return {
    user_id: userId,
    email: `${userId}@example.com`,
    display_name: `Account ${userId}`,
    token: `${userId}-token`,
    expires_at: '2026-09-29T01:00:00.000Z',
    last_used_at:
      userId === 'user-1'
        ? '2026-08-30T02:00:00.000Z'
        : '2026-08-30T01:00:00.000Z',
  };
}

function authResponse(userId: string): AuthResponse {
  return { token: `${userId}-token`, ...sessionPayload(userId) };
}

function sessionPayload(userId: string): SessionResponse {
  return {
    expires_at: '2026-09-29T01:00:00.000Z',
    user: user(userId),
  };
}

function sessionResponse(userId: string) {
  return new Response(JSON.stringify(sessionPayload(userId)), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function user(userId: string): User {
  return {
    id: userId,
    email: `${userId}@example.com`,
    display_name: `Account ${userId}`,
    theme: 'system',
    timezone: 'UTC',
    week_start: 'monday',
    date_format: 'locale',
    active_workspace_id: `${userId}-workspace`,
  };
}
