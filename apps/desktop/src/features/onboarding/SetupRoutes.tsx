import { Navigate, useLocation, useNavigate } from 'react-router';
import type { User } from '../../lib/api/types';
import { routePaths, setupPathForStage } from '../../app/routing/routePaths';
import type { ApiContext } from '../workspace/api';
import { AccountSetupStep } from './AccountSetupStep';
import { completeAccountSetup } from './api';
import { InviteSetupStep } from './InviteSetupStep';
import { SetupLayout } from './SetupLayout';
import { WorkspaceSetupStep } from './WorkspaceSetupStep';

interface SetupRoutesProps {
  context: ApiContext;
  user: User;
  onSessionChanged: () => Promise<void>;
  onSignOut: () => void;
}

export function SetupRoutes({
  context,
  user,
  onSessionChanged,
  onSignOut,
}: SetupRoutesProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const invitationReturnTo = validatedInvitationReturnTo(location.state);

  if (user.setup_stage === 'complete') {
    return <Navigate replace to={routePaths.root()} />;
  }

  if (user.setup_stage === 'workspace' && invitationReturnTo) {
    return <Navigate replace to={invitationReturnTo} />;
  }

  const canonicalPath = setupPathForStage(user.setup_stage);
  if (location.pathname !== canonicalPath) {
    return <Navigate replace state={location.state} to={canonicalPath} />;
  }

  async function accountCompleted() {
    await onSessionChanged();
    navigate(invitationReturnTo ?? routePaths.setupWorkspace(), {
      replace: true,
    });
  }

  async function workspaceCreated() {
    await onSessionChanged();
    navigate(routePaths.setupInvite(), { replace: true });
  }

  async function workspaceJoined() {
    await onSessionChanged();
    navigate(routePaths.root(), { replace: true });
  }

  async function continueAsHost() {
    await completeAccountSetup(context);
    await onSessionChanged();
    navigate(routePaths.host(), { replace: true });
  }

  const workspaceStep = (
    <WorkspaceSetupStep
      context={context}
      isHost={user.is_host}
      onWorkspaceCreated={workspaceCreated}
      onJoined={workspaceJoined}
      onHostContinue={continueAsHost}
      onSignOut={onSignOut}
    />
  );

  return (
    <SetupLayout stage={user.setup_stage}>
      {user.setup_stage === 'account' ? (
        <AccountSetupStep
          context={context}
          user={user}
          onCompleted={accountCompleted}
          onSignOut={onSignOut}
        />
      ) : user.setup_stage === 'workspace' ? (
        workspaceStep
      ) : (
        <InviteSetupStep
          context={context}
          user={user}
          workspaceRecovery={workspaceStep}
          onCompleted={async (_updated, workspace) => {
            await onSessionChanged();
            navigate(routePaths.workspaceMyWork(workspace.identifier), {
              replace: true,
            });
          }}
          onSignOut={onSignOut}
        />
      )}
    </SetupLayout>
  );
}

function validatedInvitationReturnTo(state: unknown) {
  if (!state || typeof state !== 'object' || !('invitationReturnTo' in state)) {
    return null;
  }
  const returnTo = state.invitationReturnTo;
  if (typeof returnTo !== 'string') return null;
  const prefix = `${routePaths.invite()}#token=`;
  const token = returnTo.startsWith(prefix)
    ? returnTo.slice(prefix.length)
    : '';
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? returnTo : null;
}
