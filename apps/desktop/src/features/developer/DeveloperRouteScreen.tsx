import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { routePaths } from '../../app/routing/routePaths';
import { Button } from '../../components/ui/Button';
import { Wordmark } from '../../components/ui/Wordmark';
import { errorMessage } from '../settings/utils';
import { listWorkspaces } from '../workspace/api';
import { canManageWorkspace } from '../workspace/permissions';
import { DeveloperShell, type DeveloperShellProps } from './DeveloperShell';
import { developerPath, type DeveloperSection } from './developerLocation';

export type DeveloperRouteScreenProps = Omit<
  DeveloperShellProps,
  'context' | 'workspace' | 'workspaces' | 'section' | 'webhookId'
> & {
  serverUrl: string;
  token: string;
  section: DeveloperSection | null;
};

export function DeveloperRouteScreen({
  serverUrl,
  token,
  section,
  ...props
}: DeveloperRouteScreenProps) {
  const { workspaceIdentifier, webhookId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const context = useMemo(() => ({ serverUrl, token }), [serverUrl, token]);
  const workspaces = useQuery({
    queryKey: ['workspaces', serverUrl, token],
    queryFn: () => listWorkspaces(context),
    refetchOnMount: 'always',
  });
  const workspace =
    workspaces.data?.find(
      ({ identifier }) => identifier === workspaceIdentifier,
    ) ?? workspaces.data?.find(({ id }) => id === workspaceIdentifier);

  if (workspaces.error) {
    return (
      <main className="status-page">
        <Wordmark quiet />
        <div className="form-heading" role="alert">
          <h1>Workspace unavailable</h1>
          <p>{errorMessage(workspaces.error)}</p>
        </div>
        <Button onClick={() => void workspaces.refetch()}>Try again</Button>
      </main>
    );
  }
  if (
    !workspaces.isFetchedAfterMount ||
    workspaces.isPending ||
    (workspaceIdentifier && !workspace && workspaces.isFetching)
  ) {
    return (
      <main className="status-page" aria-live="polite">
        <Wordmark quiet />
        <p>Opening Developer console…</p>
      </main>
    );
  }
  if (workspaceIdentifier && !workspace) {
    return <Navigate replace to={routePaths.developer()} />;
  }
  if (workspace && !canManageWorkspace(workspace)) {
    return (
      <main className="status-page">
        <Wordmark quiet />
        <div className="form-heading" role="alert">
          <h1>Workspace admin access required</h1>
          <p>Only Workspace Owners and Admins can manage developer tools.</p>
        </div>
        <Button onClick={() => navigate(routePaths.developer())}>
          Back to Developer console
        </Button>
      </main>
    );
  }
  if (workspace && section) {
    const pathname = developerPath(workspace.identifier, section, webhookId);
    if (pathname !== location.pathname) {
      return (
        <Navigate
          replace
          state={location.state}
          to={{ pathname, search: location.search, hash: location.hash }}
        />
      );
    }
  }
  return (
    <DeveloperShell
      key={props.user.id}
      {...props}
      context={context}
      workspaces={workspaces.data ?? []}
      workspace={workspace ?? null}
      section={section}
      webhookId={webhookId}
    />
  );
}
