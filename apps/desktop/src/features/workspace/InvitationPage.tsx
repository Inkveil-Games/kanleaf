import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { routePaths } from '../../app/routing/routePaths';
import { Button } from '../../components/ui/Button';
import { Wordmark } from '../../components/ui/Wordmark';
import { AuthForm } from '../auth/AuthForm';
import type { AuthResponse, User } from '../../lib/api/types';
import { formatDateTime, titleCase } from '../settings/utils';
import { acceptInvitationToken, resolveInvitationToken } from './api';
import { invitationTokenFromHash } from './invitationToken';

type AuthMode = 'login' | 'register';

interface InvitationPageProps {
  serverUrl: string;
  accountToken: string | null;
  user: User | null;
  onAuthenticated: (response: AuthResponse) => void | Promise<void>;
  onSessionChanged: () => Promise<void>;
  onSignOut: () => void | Promise<void>;
  flushDocumentSaves: () => Promise<void>;
}

export function InvitationPage({
  serverUrl,
  accountToken,
  user,
  onAuthenticated,
  onSessionChanged,
  onSignOut,
  flushDocumentSaves,
}: InvitationPageProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const invitationToken = invitationTokenFromHash(location.hash);
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [acceptanceState, setAcceptanceState] = useState<
    'idle' | 'accepting' | 'accepted' | 'refreshing'
  >('idle');
  const [acceptanceError, setAcceptanceError] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const preview = useQuery({
    queryKey: ['invitation-preview', serverUrl, invitationToken, accountToken],
    queryFn: () =>
      resolveInvitationToken(serverUrl, invitationToken ?? '', accountToken),
    enabled: invitationToken !== null,
    retry: false,
  });

  useEffect(() => {
    if (acceptanceError) errorRef.current?.focus();
  }, [acceptanceError]);

  if (!invitationToken) {
    return <InvitationStatus title="Invitation link is invalid" />;
  }
  if (preview.isPending) {
    return <InvitationStatus title="Checking invitation…" busy />;
  }
  if (preview.error) {
    return (
      <InvitationStatus
        title="Invitation unavailable"
        description="Kanleaf could not check this invitation. Try again."
        action={
          <Button variant="secondary" onClick={() => void preview.refetch()}>
            Try again
          </Button>
        }
      />
    );
  }

  const invitation = preview.data;
  if (invitation.status !== 'pending') {
    const copy = resolvedStatusCopy(invitation.status);
    return (
      <InvitationStatus title={copy.title} description={copy.description} />
    );
  }

  const canJoin = Boolean(
    accountToken && user && invitation.account_email_matches,
  );
  const needsAccountDetails = canJoin && user?.setup_stage === 'account';

  async function joinWorkspace() {
    if (!accountToken || !invitation.workspace_identifier || !invitationToken) {
      return;
    }
    setAcceptanceState('accepting');
    setAcceptanceError(null);
    try {
      await flushDocumentSaves();
      await acceptInvitationToken(
        { serverUrl, token: accountToken },
        invitationToken,
      );
    } catch {
      setAcceptanceState('idle');
      setAcceptanceError(
        'Kanleaf could not join this Workspace. Check the invitation and try again.',
      );
      return;
    }

    setAcceptanceState('accepted');
    await openJoinedWorkspace();
  }

  async function openJoinedWorkspace() {
    if (!accountToken || !invitation.workspace_identifier) return;
    setAcceptanceState('refreshing');
    setAcceptanceError(null);
    try {
      await onSessionChanged();
      await queryClient.invalidateQueries({
        queryKey: ['workspaces', serverUrl, accountToken],
        refetchType: 'none',
      });
      navigate(routePaths.workspaceMyWork(invitation.workspace_identifier), {
        replace: true,
      });
    } catch {
      setAcceptanceState('accepted');
      setAcceptanceError(
        'Workspace joined, but Kanleaf could not refresh your session. Try opening it again.',
      );
    }
  }

  function completeAccountDetails() {
    navigate(routePaths.setupAccount(), {
      state: {
        invitationReturnTo: `${routePaths.invite()}${location.hash}`,
      },
    });
  }

  return (
    <main className="invitation-page">
      <header className="invitation-page-header">
        <Wordmark quiet />
        <p className="eyebrow">You're invited</p>
        <h1>{invitation.workspace_name}</h1>
        <p>
          {invitation.invited_by_display_name ?? 'A Workspace admin'} invited
          you to join this Workspace on Kanleaf.
        </p>
      </header>

      <dl className="invitation-details">
        <div>
          <dt>Role</dt>
          <dd>{invitation.role ? titleCase(invitation.role) : 'Member'}</dd>
        </div>
        <div>
          <dt>Expires</dt>
          <dd>
            {invitation.expires_at
              ? formatDateTime(invitation.expires_at)
              : 'Soon'}
          </dd>
        </div>
      </dl>

      {!accountToken ? (
        <section
          className="invitation-auth"
          aria-labelledby={authMode ? 'auth-title' : 'invitation-auth-title'}
        >
          {authMode ? (
            <AuthForm
              key={authMode}
              serverUrl={serverUrl}
              initialMode={authMode}
              onAuthenticated={onAuthenticated}
            />
          ) : (
            <>
              <div className="form-heading">
                <h2 id="invitation-auth-title">Continue with Kanleaf</h2>
                <p>
                  Sign in or create the account this invitation was sent to (
                  {invitation.invitee_email_hint}).
                </p>
              </div>
              <div className="invitation-actions">
                <Button variant="primary" onClick={() => setAuthMode('login')}>
                  Sign in
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setAuthMode('register')}
                >
                  Create account
                </Button>
              </div>
            </>
          )}
        </section>
      ) : invitation.account_email_matches === false ? (
        <section
          className="invitation-auth"
          aria-labelledby="wrong-account-title"
        >
          <div className="form-heading">
            <h2 id="wrong-account-title">Use the invited account</h2>
            <p>
              This invitation was sent to {invitation.invitee_email_hint}. Sign
              in with that account to join this Workspace.
            </p>
          </div>
          <Button variant="secondary" onClick={() => void onSignOut()}>
            Sign out and use another account
          </Button>
        </section>
      ) : (
        <section className="invitation-acceptance" aria-live="polite">
          {needsAccountDetails ? (
            <>
              <p>Finish your account details, then return here to join.</p>
              <Button variant="primary" onClick={completeAccountDetails}>
                Complete account setup
              </Button>
            </>
          ) : acceptanceState === 'accepted' ||
            acceptanceState === 'refreshing' ? (
            <>
              <p role="status">
                {acceptanceState === 'refreshing'
                  ? 'Workspace joined. Opening it now…'
                  : 'Workspace joined.'}
              </p>
              <Button
                variant="primary"
                loading={acceptanceState === 'refreshing'}
                loadingLabel="Opening…"
                onClick={() => void openJoinedWorkspace()}
              >
                Open workspace
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              loading={acceptanceState === 'accepting'}
              loadingLabel="Joining…"
              onClick={() => void joinWorkspace()}
            >
              Join workspace
            </Button>
          )}
          {acceptanceError ? (
            <p className="form-error" role="alert" tabIndex={-1} ref={errorRef}>
              {acceptanceError}
            </p>
          ) : null}
        </section>
      )}
    </main>
  );
}

function resolvedStatusCopy(status: string) {
  switch (status) {
    case 'expired':
      return {
        title: 'Invitation expired',
        description: 'Ask a Workspace admin to renew this invitation.',
      };
    case 'revoked':
      return {
        title: 'Invitation revoked',
        description: 'This invitation is no longer available.',
      };
    case 'accepted':
      return {
        title: 'Invitation already accepted',
        description: 'This invitation cannot be used again.',
      };
    case 'declined':
      return {
        title: 'Invitation declined',
        description: 'Ask a Workspace admin to renew it if you want to join.',
      };
    default:
      return {
        title: 'Invitation link is invalid',
        description: 'Check that you opened the complete invitation link.',
      };
  }
}

function InvitationStatus({
  title,
  description,
  action,
  busy = false,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  busy?: boolean;
}) {
  return (
    <main className="status-page" aria-live={busy ? 'polite' : undefined}>
      <Wordmark quiet />
      <div className="form-heading">
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {action}
    </main>
  );
}
