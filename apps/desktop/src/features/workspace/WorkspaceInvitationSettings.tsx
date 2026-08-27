import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, RefreshCw } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { SettingsArticle } from '../settings/SettingsArticle';
import {
  FormActions,
  LoadError,
  type ActionState,
} from '../settings/SettingsControls';
import { errorMessage, formatDateTime, titleCase } from '../settings/utils';
import {
  createWorkspaceInvitation,
  listWorkspaceInvitations,
  renewWorkspaceInvitation,
  revokeWorkspaceInvitation,
  type ApiContext,
} from './api';
import { canManageWorkspace } from './permissions';
import type {
  AssignableWorkspaceRole,
  IssuedWorkspaceInvitation,
  Workspace,
} from './types';

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
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AssignableWorkspaceRole>('member');
  const [issued, setIssued] = useState<IssuedWorkspaceInvitation | null>(null);
  const [state, setState] = useState<ActionState>({ status: 'idle' });
  const [copyState, setCopyState] = useState<string | null>(null);

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

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState({ status: 'saving' });
    try {
      const invitation = await createWorkspaceInvitation(
        context,
        workspace.id,
        email,
        role,
      );
      setIssued(invitation);
      setEmail('');
      await refresh();
      setState({ status: 'saved', message: 'Invitation created' });
    } catch (error) {
      setState({ status: 'error', message: errorMessage(error) });
    }
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

  async function copyToken() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.token);
      setCopyState('Copied');
    } catch {
      setCopyState('Select and copy the token manually');
    }
  }

  return (
    <SettingsArticle
      eyebrow="Workspace"
      title="Invitations"
      description="Create a seven-day invitation and share its one-time token manually."
    >
      <form
        className="settings-form invite-form"
        onSubmit={(event) => void submit(event)}
      >
        <label className="settings-field">
          <span>Email</span>
          <input
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="settings-field">
          <span>Role</span>
          <select
            value={role}
            onChange={(event) =>
              setRole(event.target.value as AssignableWorkspaceRole)
            }
          >
            <option value="admin">Admin</option>
            <option value="member">Member</option>
            <option value="guest">Guest</option>
          </select>
        </label>
        <FormActions state={state} label="Create invitation" />
      </form>
      {issued && (
        <section
          className="issued-token"
          aria-labelledby="issued-token-heading"
        >
          <div>
            <strong id="issued-token-heading">
              Copy this invitation token now
            </strong>
            <small>
              Kanleaf stores only its hash and cannot show it again.
            </small>
          </div>
          <div className="token-copy-row">
            <input
              readOnly
              value={issued.token}
              aria-label="Issued invitation token"
            />
            <button
              className="secondary-button"
              type="button"
              onClick={() => void copyToken()}
            >
              <Copy aria-hidden="true" size={14} /> Copy
            </button>
          </div>
          {copyState && <small role="status">{copyState}</small>}
        </section>
      )}
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
