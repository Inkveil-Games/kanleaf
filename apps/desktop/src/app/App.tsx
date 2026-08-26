import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Wordmark } from '../components/ui/Wordmark';
import { AuthScreen } from '../features/auth/AuthScreen';
import { ConnectionScreen } from '../features/connection/ConnectionScreen';
import {
  readServerUrl,
  readSessionToken,
  writeServerUrl,
  writeSessionToken,
} from '../features/connection/storage';
import { WorkspaceShell } from '../features/workspace/WorkspaceShell';
import { ApiError, apiRequest } from '../lib/api/client';
import type { AuthResponse, SessionResponse } from '../lib/api/types';

export function App() {
  const [serverUrl, setServerUrl] = useState(readServerUrl);
  const [token, setToken] = useState(readSessionToken);
  const session = useQuery({
    queryKey: ['session', serverUrl, token],
    queryFn: () =>
      apiRequest<SessionResponse>(serverUrl!, '/api/session', { token }),
    enabled: Boolean(serverUrl && token),
  });

  useEffect(() => {
    if (session.error instanceof ApiError && session.error.status === 401) {
      const timeout = window.setTimeout(() => {
        writeSessionToken(null);
        setToken(null);
      });
      return () => window.clearTimeout(timeout);
    }
  }, [session.error]);

  function connect(nextServerUrl: string) {
    writeServerUrl(nextServerUrl);
    writeSessionToken(null);
    setServerUrl(nextServerUrl);
    setToken(null);
  }

  function authenticated(response: AuthResponse) {
    writeSessionToken(response.token);
    setToken(response.token);
  }

  function changeServer() {
    writeServerUrl(null);
    writeSessionToken(null);
    setServerUrl(null);
    setToken(null);
  }

  async function logout() {
    if (serverUrl && token) {
      try {
        await apiRequest<void>(serverUrl, '/api/auth/logout', {
          method: 'POST',
          token,
        });
      } catch {
        // Local sign-out must remain available when the server is offline.
      }
    }
    writeSessionToken(null);
    setToken(null);
  }

  if (!serverUrl) {
    return <ConnectionScreen onConnected={connect} />;
  }
  if (!token) {
    return (
      <AuthScreen
        serverUrl={serverUrl}
        onAuthenticated={authenticated}
        onChangeServer={changeServer}
      />
    );
  }
  if (session.isPending) {
    return <AppLoading />;
  }
  if (session.error) {
    if (session.error instanceof ApiError && session.error.status === 401) {
      return null;
    }
    return (
      <ConnectionFailure
        serverUrl={serverUrl}
        onRetry={() => void session.refetch()}
        onChangeServer={changeServer}
      />
    );
  }

  return (
    <WorkspaceShell
      serverUrl={serverUrl}
      token={token}
      user={session.data.user}
      onChangeServer={changeServer}
      onSignOut={() => void logout()}
    />
  );
}

function AppLoading() {
  return (
    <main className="status-page" aria-live="polite">
      <Wordmark quiet />
      <p>Restoring your session…</p>
    </main>
  );
}

interface ConnectionFailureProps {
  serverUrl: string;
  onRetry: () => void;
  onChangeServer: () => void;
}

function ConnectionFailure({
  serverUrl,
  onRetry,
  onChangeServer,
}: ConnectionFailureProps) {
  return (
    <main className="status-page">
      <Wordmark quiet />
      <div className="form-heading">
        <h1>Server unavailable</h1>
        <p>Kanleaf could not restore your session from {serverUrl}.</p>
      </div>
      <div className="button-row">
        <button className="primary-button" type="button" onClick={onRetry}>
          Try again
        </button>
        <button
          className="secondary-button"
          type="button"
          onClick={onChangeServer}
        >
          Change server
        </button>
      </div>
    </main>
  );
}
