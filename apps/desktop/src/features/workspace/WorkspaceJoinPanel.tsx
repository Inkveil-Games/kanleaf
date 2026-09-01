import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { LoadError } from '../settings/SettingsControls';
import { errorMessage, formatDateTime, titleCase } from '../settings/utils';
import {
  acceptInvitation,
  acceptInvitationToken,
  declineInvitation,
  listPendingInvitations,
  listWorkspaces,
  type ApiContext,
} from './api';
import type { Workspace, WorkspaceInvitation } from './types';

interface WorkspaceJoinPanelProps {
  context: ApiContext;
  onJoined: (workspace: Workspace) => void | Promise<void>;
}

export function WorkspaceJoinPanel({
  context,
  onJoined,
}: WorkspaceJoinPanelProps) {
  const queryClient = useQueryClient();
  const queryKey = ['pending-invitations', context.serverUrl, context.token];
  const workspaceQueryKey = ['workspaces', context.serverUrl, context.token];
  const invitations = useQuery({
    queryKey,
    queryFn: () => listPendingInvitations(context),
  });
  const [token, setToken] = useState('');
  const [busyInvitationId, setBusyInvitationId] = useState<string | null>(null);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function removeInvitation(invitationId: string) {
    queryClient.setQueryData<WorkspaceInvitation[]>(queryKey, (current) =>
      current?.filter(({ id }) => id !== invitationId),
    );
  }

  async function refreshWorkspaces() {
    await queryClient.invalidateQueries({
      queryKey: workspaceQueryKey,
      refetchType: 'none',
    });
    return queryClient.fetchQuery({
      queryKey: workspaceQueryKey,
      queryFn: () => listWorkspaces(context),
    });
  }

  async function joinedWorkspace(
    expectedWorkspaceId: string | null,
    previousWorkspaceIds: Set<string>,
  ) {
    const memberships = await refreshWorkspaces();
    const workspace = expectedWorkspaceId
      ? memberships.find(({ id }) => id === expectedWorkspaceId)
      : onlyItem(memberships.filter(({ id }) => !previousWorkspaceIds.has(id)));
    if (!workspace) {
      throw new Error(
        'The invitation was accepted, but the joined Workspace is not available yet. Refresh and try again.',
      );
    }
    return workspace;
  }

  async function accept(invitation: WorkspaceInvitation) {
    setBusyInvitationId(invitation.id);
    setError(null);
    try {
      await acceptInvitation(context, invitation.id);
      removeInvitation(invitation.id);
      const workspace = await joinedWorkspace(
        invitation.workspace_id,
        new Set(),
      );
      await onJoined(workspace);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyInvitationId(null);
    }
  }

  async function decline(invitationId: string) {
    setBusyInvitationId(invitationId);
    setError(null);
    try {
      await declineInvitation(context, invitationId);
      removeInvitation(invitationId);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyInvitationId(null);
    }
  }

  async function acceptToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTokenBusy(true);
    setError(null);
    try {
      const pendingBeforeAcceptance = invitations.data ?? [];
      const previousWorkspaceIds = new Set(
        queryClient
          .getQueryData<Workspace[]>(workspaceQueryKey)
          ?.map(({ id }) => id) ?? [],
      );
      await acceptInvitationToken(context, token.trim());
      setToken('');
      await queryClient.invalidateQueries({ queryKey, refetchType: 'none' });
      const pendingAfterAcceptance = await queryClient.fetchQuery({
        queryKey,
        queryFn: () => listPendingInvitations(context),
      });
      const remainingInvitationIds = new Set(
        pendingAfterAcceptance.map(({ id }) => id),
      );
      const acceptedInvitation = onlyItem(
        pendingBeforeAcceptance.filter(
          ({ id }) => !remainingInvitationIds.has(id),
        ),
      );
      const workspace = await joinedWorkspace(
        acceptedInvitation?.workspace_id ?? null,
        previousWorkspaceIds,
      );
      await onJoined(workspace);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setTokenBusy(false);
    }
  }

  return (
    <div className="workspace-join-panel">
      {invitations.isPending ? (
        <p className="settings-muted" aria-live="polite">
          Loading invitations…
        </p>
      ) : invitations.error ? (
        <LoadError
          error={invitations.error}
          onRetry={() => invitations.refetch()}
        />
      ) : invitations.data.length === 0 ? (
        <div className="settings-empty">
          <strong>No pending invitations</strong>
          <p>Use an invitation token below if someone shared one with you.</p>
        </div>
      ) : (
        <div className="settings-rows">
          {invitations.data.map((invitation) => (
            <div className="settings-row" key={invitation.id}>
              <div>
                <strong>{invitation.workspace_name}</strong>
                <small>
                  /{invitation.workspace_identifier} ·{' '}
                  {titleCase(invitation.role)} · expires{' '}
                  {formatDateTime(invitation.expires_at)}
                </small>
              </div>
              <div className="row-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busyInvitationId !== null || tokenBusy}
                  aria-label={`Decline invitation to ${invitation.workspace_name} (/${invitation.workspace_identifier})`}
                  onClick={() => void decline(invitation.id)}
                >
                  Decline
                </button>
                <button
                  className="primary-button compact-button"
                  type="button"
                  disabled={busyInvitationId !== null || tokenBusy}
                  aria-label={`Accept invitation to ${invitation.workspace_name} (/${invitation.workspace_identifier})`}
                  onClick={() => void accept(invitation)}
                >
                  {busyInvitationId === invitation.id ? 'Joining…' : 'Accept'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <form
        className="settings-form token-form"
        onSubmit={(event) => void acceptToken(event)}
      >
        <label className="settings-field">
          <span>Invitation token</span>
          <input
            required
            value={token}
            onChange={(event) => setToken(event.target.value)}
            autoComplete="off"
            disabled={tokenBusy || busyInvitationId !== null}
          />
        </label>
        <button
          className="primary-button compact-button"
          type="submit"
          disabled={tokenBusy || busyInvitationId !== null}
        >
          {tokenBusy ? 'Joining…' : 'Accept token'}
        </button>
      </form>
      {error ? (
        <p className="settings-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function onlyItem<T>(items: T[]) {
  return items.length === 1 ? items[0] : undefined;
}
