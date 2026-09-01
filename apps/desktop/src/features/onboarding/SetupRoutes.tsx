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

  if (user.setup_stage === 'complete') {
    return <Navigate replace to={routePaths.root()} />;
  }

  const canonicalPath = setupPathForStage(user.setup_stage);
  if (location.pathname !== canonicalPath) {
    return <Navigate replace to={canonicalPath} />;
  }

  async function accountCompleted() {
    await onSessionChanged();
    navigate(routePaths.setupWorkspace(), { replace: true });
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
