import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Wordmark } from '../components/ui/Wordmark';
import { AuthScreen } from '../features/auth/AuthScreen';
import { readSessionToken, writeSessionToken } from '../features/auth/storage';
import { WorkspaceShell } from '../features/workspace/WorkspaceShell';
import { ApiError, apiRequest } from '../lib/api/client';
import type { AuthResponse, SessionResponse } from '../lib/api/types';
import {
  checkServerHealth,
  readConfiguredServerUrl,
} from '../lib/config/server';

export function App() {
  const configuration = readServerConfiguration();
  const serverUrl = configuration.serverUrl;
  const [token, setToken] = useState(readSessionToken);
  const health = useQuery({
    queryKey: ['health', serverUrl],
    queryFn: ({ signal }) => checkServerHealth(serverUrl!, signal),
    enabled: Boolean(serverUrl),
    retry: false,
  });
  const session = useQuery({
    queryKey: ['session', serverUrl, token],
    queryFn: () =>
      apiRequest<SessionResponse>(serverUrl!, '/api/session', { token }),
    enabled: health.isSuccess && Boolean(serverUrl && token),
    retry: false,
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

  function authenticated(response: AuthResponse) {
    writeSessionToken(response.token);
    setToken(response.token);
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

  if (configuration.error) {
    return <ConfigurationFailure message={configuration.error} />;
  }
  if (health.isPending) {
    return <AppLoading message="Connecting to your server…" />;
  }
  if (health.error) {
    return (
      <ConnectionFailure
        serverUrl={serverUrl!}
        onRetry={() => void health.refetch()}
      />
    );
  }
  if (!token) {
    return (
      <AuthScreen serverUrl={serverUrl!} onAuthenticated={authenticated} />
    );
  }
  if (session.isPending) {
    return <AppLoading message="Restoring your session…" />;
  }
  if (session.error) {
    if (session.error instanceof ApiError && session.error.status === 401) {
      return null;
    }
    return (
      <ConnectionFailure
        serverUrl={serverUrl!}
        onRetry={() => void session.refetch()}
      />
    );
  }

  return (
    <WorkspaceShell
      serverUrl={serverUrl!}
      token={token}
      user={session.data.user}
      onSignOut={() => void logout()}
    />
  );
}

function readServerConfiguration(): {
  serverUrl: string | null;
  error: string | null;
} {
  try {
    return { serverUrl: readConfiguredServerUrl(), error: null };
  } catch (cause) {
    return {
      serverUrl: null,
      error:
        cause instanceof Error
          ? cause.message
          : 'VITE_KANLEAF_SERVER_URL is invalid',
    };
  }
}

function AppLoading({ message }: { message: string }) {
  return (
    <main className="status-page" aria-live="polite">
      <Wordmark quiet />
      <p>{message}</p>
    </main>
  );
}

function ConfigurationFailure({ message }: { message: string }) {
  return (
    <main className="status-page">
      <Wordmark quiet />
      <div className="form-heading">
        <h1>Server not configured</h1>
        <p>
          {message}. Restart the development client or rebuild Kanleaf after
          changing it.
        </p>
      </div>
    </main>
  );
}

interface ConnectionFailureProps {
  serverUrl: string;
  onRetry: () => void;
}

function ConnectionFailure({ serverUrl, onRetry }: ConnectionFailureProps) {
  return (
    <main className="status-page">
      <Wordmark quiet />
      <div className="form-heading">
        <h1>Server unavailable</h1>
        <p>Kanleaf could not reach the configured server at {serverUrl}.</p>
      </div>
      <button className="primary-button" type="button" onClick={onRetry}>
        Try again
      </button>
    </main>
  );
}
