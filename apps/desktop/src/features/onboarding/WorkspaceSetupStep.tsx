import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../settings/utils';
import { createWorkspace, type ApiContext } from '../workspace/api';
import { InvitationComposer } from '../workspace/InvitationComposer';
import type { Workspace } from '../workspace/types';
import {
  WorkspaceIdentityForm,
  type WorkspaceIdentity,
} from '../workspace/WorkspaceIdentityForm';
import { WorkspaceJoinPanel } from '../workspace/WorkspaceJoinPanel';

interface WorkspaceSetupStepProps {
  context: ApiContext;
  isHost: boolean;
  inviteAfterCreate?: boolean;
  invalidateAfterCreate?: boolean;
  createWorkspaceAction?: (identity: WorkspaceIdentity) => Promise<Workspace>;
  onWorkspaceCreated: (workspace: Workspace) => void | Promise<void>;
  onJoined: (workspace: Workspace) => void | Promise<void>;
  onHostContinue: () => void | Promise<void>;
  onSignOut: () => void;
}

export function WorkspaceSetupStep({
  context,
  isHost,
  inviteAfterCreate = false,
  invalidateAfterCreate = true,
  createWorkspaceAction,
  onWorkspaceCreated,
  onJoined,
  onHostContinue,
  onSignOut,
}: WorkspaceSetupStepProps) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [hostBusy, setHostBusy] = useState(false);
  const [hostError, setHostError] = useState<string | null>(null);
  const [createdWorkspace, setCreatedWorkspace] = useState<Workspace | null>(
    null,
  );
  const [invitationCount, setInvitationCount] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  async function create(identity: WorkspaceIdentity) {
    const workspace = createWorkspaceAction
      ? await createWorkspaceAction(identity)
      : await createWorkspace(context, identity.name, identity.identifier);
    setCreatedWorkspace(workspace);
    await synchronizeCreatedWorkspace(workspace, !inviteAfterCreate);
  }

  async function finishCreatedWorkspace() {
    if (!createdWorkspace) return;
    await synchronizeCreatedWorkspace(createdWorkspace, true);
  }

  async function synchronizeCreatedWorkspace(
    workspace: Workspace,
    continueSetup: boolean,
  ) {
    setFinishing(true);
    setFinishError(null);
    try {
      if (invalidateAfterCreate) {
        await queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      }
      if (continueSetup) await onWorkspaceCreated(workspace);
    } catch (caught) {
      setFinishError(errorMessage(caught));
    } finally {
      setFinishing(false);
    }
  }

  async function continueToHost() {
    setHostBusy(true);
    setHostError(null);
    try {
      await onHostContinue();
    } catch (caught) {
      setHostError(errorMessage(caught));
    } finally {
      setHostBusy(false);
    }
  }

  if (createdWorkspace) {
    return (
      <div className="setup-step">
        <header className="setup-step-heading">
          <p className="eyebrow">Invite your team</p>
          <h1>Invite people to {createdWorkspace.name}</h1>
          <p>
            Invitations are optional. You can also add people later from
            Workspace Settings.
          </p>
          <span className="workspace-route-preview">
            /{createdWorkspace.identifier}
          </span>
        </header>
        <InvitationComposer
          context={context}
          workspaceId={createdWorkspace.id}
          onInvitationCreated={() =>
            setInvitationCount((current) => current + 1)
          }
        />
        {finishError ? (
          <p className="settings-error" role="alert">
            <strong>{createdWorkspace.name} was created.</strong> {finishError}{' '}
            Retry to continue; you do not need to create it again.
          </p>
        ) : null}
        <footer className="setup-quiet-actions">
          <button
            className="text-button"
            type="button"
            disabled={finishing}
            onClick={onSignOut}
          >
            Sign out
          </button>
          <button
            className="primary-button compact-button"
            type="button"
            disabled={finishing}
            onClick={() => void finishCreatedWorkspace()}
          >
            {finishing
              ? 'Opening…'
              : finishError
                ? 'Retry opening Workspace'
                : invitationCount > 0
                  ? 'Done'
                  : 'Skip invitations'}
          </button>
        </footer>
      </div>
    );
  }

  return (
    <div className="setup-step">
      <header className="setup-step-heading">
        <p className="eyebrow">Your first Workspace</p>
        <h1>Create a home for your work, or join one</h1>
        <p>
          Workspaces keep projects, Tasks, and Markdown together for one team.
        </p>
      </header>
      <div
        className="mode-switch setup-mode-switch"
        aria-label="Workspace setup mode"
      >
        <button
          type="button"
          aria-pressed={mode === 'create'}
          onClick={() => setMode('create')}
        >
          Create a Workspace
        </button>
        <button
          type="button"
          aria-pressed={mode === 'join'}
          onClick={() => setMode('join')}
        >
          Join a Workspace
        </button>
      </div>
      {mode === 'create' ? (
        <WorkspaceIdentityForm
          submitLabel="Create Workspace"
          onSubmit={create}
        />
      ) : (
        <WorkspaceJoinPanel context={context} onJoined={onJoined} />
      )}
      {hostError ? (
        <p className="settings-error" role="alert">
          {hostError}
        </p>
      ) : null}
      <footer className="setup-quiet-actions">
        <button className="text-button" type="button" onClick={onSignOut}>
          Sign out
        </button>
        {isHost ? (
          <button
            className="secondary-button"
            type="button"
            disabled={hostBusy}
            onClick={() => void continueToHost()}
          >
            {hostBusy ? 'Continuing…' : 'Continue to Host Console'}
          </button>
        ) : null}
      </footer>
    </div>
  );
}
