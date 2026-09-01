import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import type { User } from '../../lib/api/types';
import { LoadError } from '../settings/SettingsControls';
import { errorMessage } from '../settings/utils';
import { listWorkspaces, type ApiContext } from '../workspace/api';
import { InvitationComposer } from '../workspace/InvitationComposer';
import type { Workspace } from '../workspace/types';
import { completeAccountSetup } from './api';

interface InviteSetupStepProps {
  context: ApiContext;
  user: User;
  onCompleted: (user: User, workspace: Workspace) => void | Promise<void>;
  onSignOut: () => void;
  workspaceRecovery?: ReactNode;
}

export function InviteSetupStep({
  context,
  user,
  onCompleted,
  onSignOut,
  workspaceRecovery,
}: InviteSetupStepProps) {
  const workspaces = useQuery({
    queryKey: ['workspaces', context.serverUrl, context.token],
    queryFn: () => listWorkspaces(context),
  });
  const [invitationCount, setInvitationCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (workspaces.isPending) {
    return <p className="settings-muted">Opening your Workspace…</p>;
  }
  if (workspaces.error) {
    return (
      <LoadError
        error={workspaces.error}
        onRetry={() => workspaces.refetch()}
      />
    );
  }

  const workspace =
    workspaces.data.find(({ id }) => id === user.active_workspace_id) ??
    workspaces.data[0];
  if (!workspace) {
    return (
      workspaceRecovery ?? (
        <div className="settings-empty">
          <strong>Your first Workspace is no longer available</strong>
          <p>Create or join a Workspace to continue setup.</p>
        </div>
      )
    );
  }

  async function complete() {
    setBusy(true);
    setError(null);
    try {
      const updated = await completeAccountSetup(context);
      await onCompleted(updated, workspace);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="setup-step">
      <header className="setup-step-heading">
        <p className="eyebrow">Invite your team</p>
        <h1>Bring collaborators into {workspace.name}</h1>
        <p>
          Create invitations now, or skip this step and invite people later from
          Workspace Settings.
        </p>
        <span className="workspace-route-preview">/{workspace.identifier}</span>
      </header>
      <InvitationComposer
        context={context}
        workspaceId={workspace.id}
        onInvitationCreated={() => setInvitationCount((count) => count + 1)}
      />
      {error ? (
        <p className="settings-error" role="alert">
          {error}
        </p>
      ) : null}
      <footer className="setup-actions">
        <button
          className="text-button"
          type="button"
          disabled={busy}
          onClick={onSignOut}
        >
          Sign out
        </button>
        <div>
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={() => void complete()}
          >
            Skip for now
          </button>
          {invitationCount > 0 ? (
            <button
              className="primary-button compact-button"
              type="button"
              disabled={busy}
              onClick={() => void complete()}
            >
              {busy ? 'Finishing…' : 'Finish setup'}
            </button>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
