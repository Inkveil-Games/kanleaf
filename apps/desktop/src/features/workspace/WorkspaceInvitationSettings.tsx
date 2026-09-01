import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { SettingsArticle } from '../settings/SettingsArticle';
import {
  ActionMessage,
  LoadError,
  type ActionState,
} from '../settings/SettingsControls';
import { errorMessage, formatDateTime, titleCase } from '../settings/utils';
import {
  listWorkspaceInvitations,
  renewWorkspaceInvitation,
  revokeWorkspaceInvitation,
  type ApiContext,
} from './api';
import { canManageWorkspace } from './permissions';
import type { IssuedWorkspaceInvitation, Workspace } from './types';
import {
  InvitationComposer,
  IssuedInvitationToken,
} from './InvitationComposer';

interface WorkspaceInvitationSettingsProps {
  context: ApiContext;
  workspace: Workspace;
}

export function WorkspaceInvitationSettings({
  context,
  workspace,
}: WorkspaceInvitationSettingsProps) {
  const queryClient = useQueryClient();
  const invitations = useQuery({
    queryKey: ['workspace-invitations', workspace.id],
    queryFn: () => listWorkspaceInvitations(context, workspace.id),
    enabled: canManageWorkspace(workspace),
  });
  const [issued, setIssued] = useState<IssuedWorkspaceInvitation | null>(null);
  const [state, setState] = useState<ActionState>({ status: 'idle' });

  if (!canManageWorkspace(workspace)) {
    return (
      <SettingsArticle
        eyebrow="Workspace"
        title="Invitations"
        description="Invite people to collaborate in this Workspace."
      >
        <div className="settings-empty">
          <strong>Admin access required</strong>
          <p>Only Workspace Owners and Admins can manage invitations.</p>
        </div>
      </SettingsArticle>
    );
  }

  async function refresh() {
    await queryClient.invalidateQueries({
      queryKey: ['workspace-invitations', workspace.id],
    });
  }

  async function renew(invitationId: string) {
    setState({ status: 'saving' });
    try {
      const invitation = await renewWorkspaceInvitation(
        context,
        workspace.id,
        invitationId,
      );
      setIssued(invitation);
      await refresh();
      setState({ status: 'saved', message: 'Invitation renewed' });
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) });
    }
  }

  async function revoke(invitationId: string) {
    setState({ status: 'saving' });
    try {
      await revokeWorkspaceInvitation(context, workspace.id, invitationId);
      await refresh();
      setState({ status: 'saved', message: 'Invitation revoked' });
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) });
    }
  }

  return (
    <SettingsArticle
      eyebrow="Workspace"
      title="Invitations"
      description="Create a seven-day invitation and share its one-time token manually."
    >
      <InvitationComposer
        context={context}
        workspaceId={workspace.id}
        onInvitationCreated={refresh}
      />
      {issued ? <IssuedInvitationToken invitation={issued} /> : null}
      <ActionMessage state={state} />
      <section
        className="settings-section"
        aria-labelledby="invitation-history-heading"
      >
        <div className="settings-section-heading">
          <div>
            <h2 id="invitation-history-heading">Invitation history</h2>
            <p>Resolved invitations remain visible for audit context.</p>
          </div>
        </div>
        {invitations.isPending ? (
          <p className="settings-muted">Loading invitations…</p>
        ) : invitations.error ? (
          <LoadError
            error={invitations.error}
            onRetry={() => invitations.refetch()}
          />
        ) : invitations.data.length === 0 ? (
          <div className="settings-empty">
            <strong>No invitations yet</strong>
            <p>Create one above when this Workspace is ready to share.</p>
          </div>
        ) : (
          <div className="settings-rows">
            {invitations.data.map((invitation) => (
              <div className="settings-row" key={invitation.id}>
                <div>
                  <strong>{invitation.email}</strong>
                  <small>
                    {titleCase(invitation.role)} ·{' '}
                    {titleCase(invitation.status)} · expires{' '}
                    {formatDateTime(invitation.expires_at)}
                  </small>
                </div>
                <div className="row-actions">
                  {invitation.status !== 'accepted' && (
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => void renew(invitation.id)}
                    >
                      <RefreshCw aria-hidden="true" size={13} /> Renew
                    </button>
                  )}
                  {invitation.status === 'pending' && (
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => void revoke(invitation.id)}
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </SettingsArticle>
  );
}
