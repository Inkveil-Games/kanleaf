import type { UseQueryResult } from '@tanstack/react-query';
import { RefreshCw, Trash2 } from 'lucide-react';
import { ContextMenu } from '../../components/ui/ContextMenu';
import { LoadError } from '../settings/SettingsControls';
import { formatDateTime, monogram, titleCase } from '../settings/utils';
import type { WorkspaceInvitation } from './types';

interface WorkspaceInvitationListProps {
  query: UseQueryResult<WorkspaceInvitation[], Error>;
  pending: WorkspaceInvitation[];
  history: WorkspaceInvitation[];
  busyInvitation: string | null;
  onRenew: (invitation: WorkspaceInvitation) => Promise<void>;
  onRevoke: (invitation: WorkspaceInvitation) => Promise<void>;
}

export function WorkspaceInvitationList({
  query,
  pending,
  history,
  busyInvitation,
  onRenew,
  onRevoke,
}: WorkspaceInvitationListProps) {
  return (
    <section
      className="settings-section member-invitations"
      aria-labelledby="pending-invitations-heading"
    >
      <div className="settings-section-heading">
        <div>
          <h2 id="pending-invitations-heading">Pending invitations</h2>
          <p>Tokens expire after seven days and are only shown when issued.</p>
        </div>
      </div>
      {query.isPending ? (
        <p className="settings-muted">Loading invitations…</p>
      ) : query.error ? (
        <LoadError error={query.error} onRetry={() => query.refetch()} />
      ) : pending.length === 0 ? (
        <div className="settings-empty compact-settings-empty">
          <strong>No pending invitations</strong>
          <p>New invitations will stay here until accepted or revoked.</p>
        </div>
      ) : (
        <div className="settings-rows invitation-rows">
          {pending.map((invitation) => (
            <InvitationRow
              key={invitation.id}
              invitation={invitation}
              busy={busyInvitation === invitation.id}
              onRenew={onRenew}
              onRevoke={onRevoke}
            />
          ))}
        </div>
      )}

      {history.length > 0 && (
        <details className="settings-disclosure invitation-history">
          <summary>
            Invitation history <span>{history.length}</span>
          </summary>
          <div className="settings-rows invitation-rows">
            {history.map((invitation) => (
              <InvitationRow
                key={invitation.id}
                invitation={invitation}
                busy={busyInvitation === invitation.id}
                onRenew={onRenew}
                onRevoke={onRevoke}
              />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function InvitationRow({
  invitation,
  busy,
  onRenew,
  onRevoke,
}: {
  invitation: WorkspaceInvitation;
  busy: boolean;
  onRenew: (invitation: WorkspaceInvitation) => Promise<void>;
  onRevoke: (invitation: WorkspaceInvitation) => Promise<void>;
}) {
  return (
    <div className="settings-row invitation-row">
      <span className="member-monogram invitation-monogram" aria-hidden="true">
        {monogram(invitation.email)}
      </span>
      <div className="member-copy">
        <strong>{invitation.email}</strong>
        <small>
          {titleCase(invitation.role)} · expires{' '}
          {formatDateTime(invitation.expires_at)}
        </small>
      </div>
      <span className={`invitation-status status-${invitation.status}`}>
        {titleCase(invitation.status)}
      </span>
      {invitation.status !== 'accepted' && (
        <ContextMenu
          label={`Manage invitation for ${invitation.email}`}
          disabled={busy}
        >
          <button type="button" onClick={() => void onRenew(invitation)}>
            <RefreshCw aria-hidden="true" size={14} /> Renew invitation
          </button>
          {invitation.status === 'pending' && (
            <button
              className="danger-menu-item"
              type="button"
              onClick={() => void onRevoke(invitation)}
            >
              <Trash2 aria-hidden="true" size={14} /> Revoke invitation
            </button>
          )}
        </ContextMenu>
      )}
    </div>
  );
}
