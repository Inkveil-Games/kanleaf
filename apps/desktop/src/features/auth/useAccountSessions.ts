import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { ApiError, apiRequest } from '../../lib/api/client';
import type { AuthResponse, SessionResponse } from '../../lib/api/types';
import {
  activateAccountSession,
  clearServerAccountSessions,
  readLegacySessionToken,
  readServerAccountSessions,
  removeAccountSession,
  upsertAccountSession,
  writeLegacySessionToken,
  writeServerAccountSessions,
  type AccountSession,
  type ServerAccountSessions,
} from './accountSessionStore';

export function useAccountSessions(
  serverUrl: string,
  flushDocumentSaves: () => Promise<void>,
) {
  const queryClient = useQueryClient();
  const [sessions, setSessions] = useState(() =>
    readServerAccountSessions(serverUrl),
  );
  const sessionsRef = useRef(sessions);
  const [token, setToken] = useState<string | null>(() => {
    const retained = activeAccount(sessions)?.token;
    return (
      retained ??
      (sessions.accounts.length === 0 ? readLegacySessionToken() : null)
    );
  });
  const [transitioning, setTransitioning] = useState(false);
  const transitioningRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const persist = useCallback(
    (next: ServerAccountSessions) => {
      sessionsRef.current = next;
      setSessions(next);
      if (!writeServerAccountSessions(serverUrl, next)) {
        setError('Account sessions could not be retained on this device');
      }
    },
    [serverUrl],
  );

  const clearAccountQueries = useCallback(async () => {
    const accountQuery = (query: { queryKey: readonly unknown[] }) =>
      query.queryKey[0] !== 'health';
    await queryClient.cancelQueries({ predicate: accountQuery });
    queryClient.removeQueries({ predicate: accountQuery });
  }, [queryClient]);

  const commitIdentity = useCallback(
    async (
      base: ServerAccountSessions,
      nextToken: string,
      response: SessionResponse,
    ) => {
      const now = new Date().toISOString();
      const withAccount = upsertAccountSession(
        base,
        accountFromSession(nextToken, response, now),
        false,
      );
      const next = activateAccountSession(withAccount, response.user.id, now);
      await clearAccountQueries();
      persist(next);
      writeLegacySessionToken(null);
      queryClient.setQueryData(['session', serverUrl, nextToken], response);
      setToken(nextToken);
    },
    [clearAccountQueries, persist, queryClient, serverUrl],
  );

  const synchronizeValidatedSession = useCallback(
    (validatedToken: string, response: SessionResponse) => {
      const current = sessionsRef.current;
      const retained = current.accounts.find(
        ({ user_id }) => user_id === response.user.id,
      );
      const next = upsertAccountSession(
        current,
        accountFromSession(
          validatedToken,
          response,
          retained?.last_used_at ?? new Date().toISOString(),
        ),
        true,
      );
      persist(next);
      writeLegacySessionToken(null);
    },
    [persist],
  );

  async function switchAccount(userId: string): Promise<boolean> {
    if (!startTransition()) return false;
    setError(null);
    try {
      const target = sessionsRef.current.accounts.find(
        ({ user_id }) => user_id === userId,
      );
      if (!target) {
        setError('Account session is not retained');
        return false;
      }
      if (
        sessionsRef.current.active_user_id === userId &&
        target.token === token
      ) {
        return true;
      }
      try {
        await flushDocumentSaves();
      } catch (cause) {
        setError(errorMessage(cause));
        return false;
      }

      try {
        const response = await apiRequest<SessionResponse>(
          serverUrl,
          '/api/session',
          { token: target.token },
        );
        await commitIdentity(sessionsRef.current, target.token, response);
        return true;
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 401) {
          persist(removeAccountSession(sessionsRef.current, userId));
          setError('Session expired');
        } else {
          setError(errorMessage(cause));
        }
        return false;
      }
    } finally {
      finishTransition();
    }
  }

  async function addAuthenticated(response: AuthResponse): Promise<boolean> {
    if (!startTransition()) return false;
    setError(null);
    const current = sessionsRef.current;
    const existing = current.accounts.find(
      ({ user_id }) => user_id === response.user.id,
    );
    const replacingActive =
      existing?.user_id === current.active_user_id && existing.token === token;
    let staged = current;
    if (!replacingActive) {
      staged = upsertAccountSession(
        current,
        accountFromSession(response.token, response, new Date().toISOString()),
        false,
      );
      persist(staged);
      if (existing && existing.token !== response.token) {
        void revokeSession(existing.token);
      }
    }

    try {
      try {
        await flushDocumentSaves();
      } catch {
        if (replacingActive) void revokeSession(response.token);
        setError('Account added. Resolve unsaved Markdown before switching.');
        return false;
      }
      if (replacingActive && existing && existing.token !== response.token) {
        await revokeSession(existing.token);
      }
      await commitIdentity(staged, response.token, response);
      return true;
    } finally {
      finishTransition();
    }
  }

  async function signOutCurrent(): Promise<boolean> {
    if (!startTransition()) return false;
    setError(null);
    try {
      try {
        await flushDocumentSaves();
      } catch (cause) {
        setError(errorMessage(cause));
        return false;
      }
      if (token) await revokeSession(token);
      const current = sessionsRef.current;
      const retained = current.accounts.find(
        (account) => account.token === token,
      );
      const next = retained
        ? removeAccountSession(current, retained.user_id)
        : current;
      persist(next);
      writeLegacySessionToken(null);
      await clearAccountQueries();
      setToken(null);
      return true;
    } finally {
      finishTransition();
    }
  }

  async function signOutAll(): Promise<boolean> {
    if (!startTransition()) return false;
    setError(null);
    try {
      try {
        await flushDocumentSaves();
      } catch (cause) {
        setError(errorMessage(cause));
        return false;
      }
      const tokens = new Set(
        sessionsRef.current.accounts.map((account) => account.token),
      );
      if (token) tokens.add(token);
      await Promise.all([...tokens].map(revokeSession));
      const next = { active_user_id: null, accounts: [] };
      sessionsRef.current = next;
      setSessions(next);
      clearServerAccountSessions(serverUrl);
      writeLegacySessionToken(null);
      await clearAccountQueries();
      setToken(null);
      return true;
    } finally {
      finishTransition();
    }
  }

  const discardInvalidSession = useCallback(
    async (invalidToken: string) => {
      const current = sessionsRef.current;
      const invalid = current.accounts.find(
        (account) => account.token === invalidToken,
      );
      if (invalid) persist(removeAccountSession(current, invalid.user_id));
      if (readLegacySessionToken() === invalidToken) {
        writeLegacySessionToken(null);
      }
      await clearAccountQueries();
      setToken((activeToken) =>
        activeToken === invalidToken ? null : activeToken,
      );
    },
    [clearAccountQueries, persist],
  );

  function startTransition() {
    if (transitioningRef.current) return false;
    transitioningRef.current = true;
    setTransitioning(true);
    return true;
  }

  function finishTransition() {
    transitioningRef.current = false;
    setTransitioning(false);
  }

  async function revokeSession(sessionToken: string) {
    try {
      await apiRequest<void>(serverUrl, '/api/auth/logout', {
        method: 'POST',
        token: sessionToken,
      });
    } catch {
      // Local account removal must still work while the server is unavailable.
    }
  }

  return {
    sessions,
    token,
    transitioning,
    error,
    clearError: () => setError(null),
    synchronizeValidatedSession,
    discardInvalidSession,
    switchAccount,
    addAuthenticated,
    signOutCurrent,
    signOutAll,
  };
}

function activeAccount(sessions: ServerAccountSessions) {
  return sessions.accounts.find(
    ({ user_id }) => user_id === sessions.active_user_id,
  );
}

function accountFromSession(
  token: string,
  response: SessionResponse,
  lastUsedAt: string,
): AccountSession {
  return {
    user_id: response.user.id,
    email: response.user.email,
    display_name: response.user.display_name,
    token,
    expires_at: response.expires_at,
    last_used_at: lastUsedAt,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Request failed';
}
