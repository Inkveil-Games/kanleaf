import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router';
import { Wordmark } from '../../components/ui/Wordmark';
import { HostConsole, type HostSection } from '../../features/host/HostConsole';
import { SetupRoutes } from '../../features/onboarding/SetupRoutes';
import type { User } from '../../lib/api/types';
import type { AccountSession } from '../../features/auth/accountSessionStore';
import {
  LegacyWorkspaceRedirect,
  WorkspaceRouteScreen,
} from '../../features/workspace/WorkspaceRouteScreen';
import type { WorkspaceRouteKind } from '../../features/workspace/workspaceRouteAdapter';
import { routePaths, routePatterns } from './routePaths';

interface AuthenticatedRoutesProps {
  serverUrl: string;
  token: string;
  user: User;
  accountSessions: AccountSession[];
  accountTransitioning: boolean;
  accountError: string | null;
  onSwitchAccount: (userId: string) => void;
  onAddAccount: () => void;
  onDismissAccountError: () => void;
  onSignOut: () => void;
  onSessionChanged: () => Promise<void>;
  flushDocumentSaves: () => Promise<void>;
}

export function AuthenticatedRoutes(props: AuthenticatedRoutesProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const onOpenHostConsole = props.user.is_host
    ? () => navigate(routePaths.host())
    : undefined;

  if (location.pathname.length > 1 && location.pathname.endsWith('/')) {
    return (
      <Navigate
        replace
        state={location.state}
        to={{
          pathname: location.pathname.replace(/\/+$/, ''),
          search: location.search,
          hash: location.hash,
        }}
      />
    );
  }

  if (props.user.setup_stage !== 'complete') {
    return (
      <SetupRoutes
        context={{ serverUrl: props.serverUrl, token: props.token }}
        user={props.user}
        onSessionChanged={props.onSessionChanged}
        onSignOut={props.onSignOut}
      />
    );
  }

  function workspaceScreen(routeKind: WorkspaceRouteKind) {
    return (
      <WorkspaceRouteScreen
        {...props}
        routeKind={routeKind}
        onOpenHostConsole={onOpenHostConsole}
      />
    );
  }

  return (
    <Routes>
      <Route
        path={routePatterns.host}
        element={<HostRoute {...props} section="workspaces" />}
      />
      <Route
        path={routePatterns.hostAccess}
        element={<HostRoute {...props} section="access" />}
      />
      <Route
        path="/host/*"
        element={<Navigate replace to={routePaths.host()} />}
      />
      <Route
        path={routePatterns.setupWildcard}
        element={<Navigate replace to={routePaths.root()} />}
      />
      <Route
        path={routePatterns.legacyWorkspace}
        element={
          <LegacyWorkspaceRedirect
            serverUrl={props.serverUrl}
            token={props.token}
          />
        }
      />
      <Route
        path={routePatterns.legacyWorkspaceWildcard}
        element={
          <LegacyWorkspaceRedirect
            serverUrl={props.serverUrl}
            token={props.token}
          />
        }
      />
      <Route path={routePatterns.root} element={workspaceScreen('root')} />
      <Route
        path={routePatterns.workspace}
        element={<WorkspaceCanonicalRedirect />}
      />
      <Route
        path={routePatterns.workspaceMyWork}
        element={workspaceScreen('my-work')}
      />
      <Route
        path={routePatterns.workspaceInbox}
        element={workspaceScreen('inbox')}
      />
      <Route
        path={routePatterns.workspaceTasks}
        element={workspaceScreen('all-tasks')}
      />
      <Route
        path={routePatterns.workspaceView}
        element={workspaceScreen('workspace-view')}
      />
      <Route
        path={routePatterns.workspaceLibrary}
        element={workspaceScreen('workspace-library')}
      />
      <Route
        path={routePatterns.workspaceDocument}
        element={workspaceScreen('workspace-library')}
      />
      <Route
        path={routePatterns.project}
        element={workspaceScreen('project-overview')}
      />
      <Route
        path={routePatterns.projectWorkItems}
        element={workspaceScreen('project-work-items')}
      />
      <Route
        path={routePatterns.projectCycles}
        element={workspaceScreen('project-cycles')}
      />
      <Route
        path={routePatterns.projectCycle}
        element={workspaceScreen('project-cycles')}
      />
      <Route
        path={routePatterns.projectModules}
        element={workspaceScreen('project-modules')}
      />
      <Route
        path={routePatterns.projectModule}
        element={workspaceScreen('project-modules')}
      />
      <Route
        path={routePatterns.projectLibrary}
        element={workspaceScreen('project-library')}
      />
      <Route
        path={routePatterns.projectDocument}
        element={workspaceScreen('project-library')}
      />
      <Route
        path={routePatterns.projectViews}
        element={workspaceScreen('project-views')}
      />
      <Route
        path={routePatterns.projectView}
        element={workspaceScreen('project-view')}
      />
      <Route
        path={routePatterns.accountSettings}
        element={workspaceScreen('account-settings')}
      />
      <Route
        path={routePatterns.workspaceSettings}
        element={workspaceScreen('workspace-settings')}
      />
      <Route
        path={routePatterns.projectSettings}
        element={workspaceScreen('project-settings')}
      />
      <Route
        path="/:workspaceIdentifier/*"
        element={<WorkspaceCanonicalRedirect />}
      />
      <Route path="*" element={<Navigate replace to={routePaths.root()} />} />
    </Routes>
  );
}

function HostRoute({
  serverUrl,
  token,
  user,
  section,
  accountSessions,
  accountTransitioning,
  accountError,
  onSwitchAccount,
  onAddAccount,
  onDismissAccountError,
  onSignOut,
}: AuthenticatedRoutesProps & { section: HostSection }) {
  const navigate = useNavigate();

  if (!user.is_host) {
    return <HostAccessRequired onBack={() => navigate(routePaths.root())} />;
  }

  return (
    <HostConsole
      key={user.id}
      context={{ serverUrl, token }}
      user={user}
      section={section}
      onSectionChange={(nextSection) => {
        if (nextSection === section) return;
        navigate(
          nextSection === 'access'
            ? routePaths.hostAccess()
            : routePaths.host(),
        );
      }}
      accountSessions={accountSessions}
      accountTransitioning={accountTransitioning}
      accountError={accountError}
      onSwitchAccount={onSwitchAccount}
      onAddAccount={onAddAccount}
      onDismissAccountError={onDismissAccountError}
      onSignOut={onSignOut}
      onClose={() => navigate(routePaths.root())}
    />
  );
}

function WorkspaceCanonicalRedirect() {
  const { workspaceIdentifier } = useParams();

  return workspaceIdentifier ? (
    <Navigate replace to={routePaths.workspaceMyWork(workspaceIdentifier)} />
  ) : (
    <Navigate replace to={routePaths.root()} />
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
