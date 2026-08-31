import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Wordmark } from '../components/ui/Wordmark';
import { AccountChooser } from '../features/auth/AccountChooser';
import { AddAccountDialog } from '../features/auth/AddAccountDialog';
import { AuthScreen } from '../features/auth/AuthScreen';
import { useAccountSessions } from '../features/auth/useAccountSessions';
import { applyTheme } from '../features/account/theme';
import { HostConsole } from '../features/host/HostConsole';
import { useDocumentSaveCoordinator } from '../features/markdown/documentSaveCoordinatorContext';
import { WorkspaceShell } from '../features/workspace/WorkspaceShell';
import {
  ApiError,
  apiRequest,
  subscribeToUnauthorizedRequests,
} from '../lib/api/client';
import type { SessionResponse } from '../lib/api/types';
import {
  checkServerHealth,
  readConfiguredServerUrl,
} from '../lib/config/server';

export function App() {
  const configuration = readServerConfiguration();

  if (configuration.error) {
    return <ConfigurationFailure message={configuration.error} />;
  }
  return <ConfiguredApp serverUrl={configuration.serverUrl!} />;
}

function ConfiguredApp({ serverUrl }: { serverUrl: string }) {
  const [pathname, navigate] = usePathname();
  const { flushDocumentSaves } = useDocumentSaveCoordinator();
  const {
    sessions: retainedSessions,
    token,
    transitioning,
    error: accountError,
    clearError: clearAccountError,
    synchronizeValidatedSession,
    discardInvalidSession,
    switchAccount,
    addAuthenticated,
    signOutCurrent,
  } = useAccountSessions(serverUrl, flushDocumentSaves);
  const [addingAccount, setAddingAccount] = useState(false);
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
    return subscribeToUnauthorizedRequests((unauthorizedToken) => {
      window.setTimeout(() => void discardInvalidSession(unauthorizedToken));
    });
  }, [discardInvalidSession]);

  useEffect(() => {
    if (session.error instanceof ApiError && session.error.status === 401) {
      const timeout = window.setTimeout(() => {
        if (token) void discardInvalidSession(token);
      });
      return () => window.clearTimeout(timeout);
    }
  }, [discardInvalidSession, session.error, token]);

  useEffect(() => {
    if (token && session.data) {
      synchronizeValidatedSession(token, session.data);
    }
  }, [session.data, synchronizeValidatedSession, token]);

  useEffect(() => {
    if (!session.data) return;
    applyTheme(session.data.user.theme);
    return () => applyTheme('system');
  }, [session.data]);

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
    const content =
      retainedSessions.accounts.length > 0 ? (
        <AccountChooser
          accounts={retainedSessions.accounts}
          transitioning={transitioning}
          error={accountError}
          onSelect={(userId) => void switchAccount(userId)}
          onUseAnother={() => setAddingAccount(true)}
        />
      ) : (
        <AuthScreen
          serverUrl={serverUrl}
          onAuthenticated={async (response) => {
            await addAuthenticated(response);
          }}
        />
      );
    return (
      <>
        {content}
        {addingAccount && (
          <AddAccountDialog
            serverUrl={serverUrl}
            onAuthenticated={async (response) => {
              await addAuthenticated(response);
              setAddingAccount(false);
            }}
            onClose={() => setAddingAccount(false)}
          />
        )}
      </>
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

  const accountProps = {
    accountSessions: retainedSessions.accounts,
    accountTransitioning: transitioning,
    accountError,
    onSwitchAccount: (userId: string) => void switchAccount(userId),
    onAddAccount: () => {
      clearAccountError();
      setAddingAccount(true);
    },
    onDismissAccountError: clearAccountError,
    onSignOut: () => void signOutCurrent(),
  };
  const isHostPath = pathname === '/host';
  const surface = isHostPath ? (
    session.data.user.is_host ? (
      <HostConsole
        key={session.data.user.id}
        context={{ serverUrl, token }}
        user={session.data.user}
        {...accountProps}
        onClose={() => navigate('/')}
      />
    ) : (
      <HostAccessRequired onBack={() => navigate('/')} />
    )
  ) : (
    <WorkspaceShell
      key={session.data.user.id}
      serverUrl={serverUrl}
      token={token}
      user={session.data.user}
      {...accountProps}
      onOpenHostConsole={
        session.data.user.is_host ? () => navigate('/host') : undefined
      }
    />
  );

  return (
    <>
      {surface}
      {addingAccount && (
        <AddAccountDialog
          serverUrl={serverUrl}
          onAuthenticated={async (response) => {
            await addAuthenticated(response);
            setAddingAccount(false);
          }}
          onClose={() => setAddingAccount(false)}
        />
      )}
    </>
  );
}

function usePathname(): [string, (pathname: string) => void] {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    function updatePathname() {
      setPathname(window.location.pathname);
    }
    window.addEventListener('popstate', updatePathname);
    return () => window.removeEventListener('popstate', updatePathname);
  }, []);

  function navigate(nextPathname: string) {
    if (window.location.pathname !== nextPathname) {
      window.history.pushState(null, '', nextPathname);
    }
    setPathname(nextPathname);
  }

  return [pathname, navigate];
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

function HostAccessRequired({ onBack }: { onBack: () => void }) {
  return (
    <main className="status-page">
      <Wordmark quiet />
      <div className="form-heading">
        <h1>Host access required</h1>
        <p>Sign in with the Host account configured for this Kanleaf server.</p>
      </div>
      <button className="secondary-button" type="button" onClick={onBack}>
        Back to Workspace
      </button>
    </main>
  );
}
