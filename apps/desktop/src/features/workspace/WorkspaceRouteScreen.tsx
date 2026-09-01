import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { Wordmark } from '../../components/ui/Wordmark';
import { routePaths } from '../../app/routing/routePaths';
import type {
  WorkspaceContentLocation,
  WorkspaceLocation,
  WorkspaceReplacementLocation,
} from './workspaceLocation';
import { listWorkspaces } from './api';
import {
  parseWorkspaceContentPath,
  workspaceContentPath,
} from './workspaceLocation';
import { WorkspaceShell, type WorkspaceShellProps } from './WorkspaceShell';
import type { Workspace } from './types';
import {
  workspaceLocationFromRoute,
  workspaceLocationPath,
  type WorkspaceRouteKind,
} from './workspaceRouteAdapter';

export type WorkspaceRouteScreenProps = Omit<
  WorkspaceShellProps,
  'location' | 'onNavigate' | 'workspaceAccessVerified'
> & {
  routeKind: WorkspaceRouteKind;
};

export function WorkspaceRouteScreen({
  routeKind,
  ...shellProps
}: WorkspaceRouteScreenProps) {
  const params = useParams();
  const routerLocation = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const workspaces = useWorkspaceList(shellProps.serverUrl, shellProps.token);
  const workspaceForIdentifier = workspaces.data?.find(
    ({ identifier }) => identifier === params.workspaceIdentifier,
  );
  const resolveWorkspaceId = useCallback(
    (workspaceIdentifier: string) =>
      queryClient
        .getQueryData<Workspace[]>([
          'workspaces',
          shellProps.serverUrl,
          shellProps.token,
        ])
        ?.find(({ identifier }) => identifier === workspaceIdentifier)?.id ??
      null,
    [queryClient, shellProps.serverUrl, shellProps.token],
  );
  const resolveWorkspaceIdentifier = useCallback(
    (workspaceId: string) =>
      queryClient
        .getQueryData<Workspace[]>([
          'workspaces',
          shellProps.serverUrl,
          shellProps.token,
        ])
        ?.find(({ id }) => id === workspaceId)?.identifier ?? null,
    [queryClient, shellProps.serverUrl, shellProps.token],
  );
  const returnTo = readReturnTo(routerLocation.state, resolveWorkspaceId);
  const location =
    routeKind === 'root' || workspaceForIdentifier
      ? workspaceLocationFromRoute(
          routeKind,
          workspaceForIdentifier?.id ?? null,
          params,
          routerLocation.search,
          returnTo,
        )
      : null;
  const currentReturnToPath = returnTo
    ? serializeContentLocation(returnTo, resolveWorkspaceIdentifier)
    : null;
  const canonicalPath = canonicalWorkspacePath(
    location,
    routerLocation.pathname,
    resolveWorkspaceIdentifier,
  );
  const currentPath = `${routerLocation.pathname}${routerLocation.search}`;

  const onNavigate = useCallback(
    (
      nextLocation: WorkspaceReplacementLocation,
      options?: { replace?: boolean },
    ) => {
      const path = serializeWorkspaceLocation(
        nextLocation,
        resolveWorkspaceIdentifier,
      );
      const nextReturnToPath = settingsReturnToPath(
        nextLocation,
        resolveWorkspaceIdentifier,
      );
      const samePath = path === currentPath;

      if (samePath && nextReturnToPath === currentReturnToPath) return;

      navigate(path, {
        replace: Boolean(options?.replace || samePath),
        state: nextReturnToPath ? { returnTo: nextReturnToPath } : null,
      });
    },
    [currentPath, currentReturnToPath, navigate, resolveWorkspaceIdentifier],
  );

  if (workspaces.error) {
    return <WorkspaceListFailure query={workspaces} />;
  }

  if (
    workspaces.isPending ||
    !workspaces.isFetchedAfterMount ||
    (routeKind !== 'root' && !workspaceForIdentifier && workspaces.isFetching)
  ) {
    return <WorkspaceListOpening />;
  }

  if (routeKind !== 'root' && !workspaceForIdentifier) {
    return <Navigate replace to="/" />;
  }

  if (canonicalPath !== currentPath) {
    return (
      <Navigate
        replace
        state={routerLocation.state}
        to={`${canonicalPath}${routerLocation.hash}`}
      />
    );
  }

  return (
    <WorkspaceShell
      key={shellProps.user.id}
      {...shellProps}
      location={location}
      workspaceAccessVerified
      onNavigate={onNavigate}
    />
  );
}

export function LegacyWorkspaceRedirect({
  serverUrl,
  token,
}: Pick<WorkspaceShellProps, 'serverUrl' | 'token'>) {
  const params = useParams();
  const routerLocation = useLocation();
  const workspaces = useWorkspaceList(serverUrl, token);

  if (workspaces.error) {
    return <WorkspaceListFailure query={workspaces} />;
  }
  if (workspaces.isPending || workspaces.isFetching) {
    return <WorkspaceListOpening />;
  }

  const workspace = workspaces.data.find(
    ({ id }) => id === params.workspaceUuid,
  );
  if (!workspace) {
    return <Navigate replace to={routePaths.root()} />;
  }

  const suffixStart = routerLocation.pathname.indexOf('/', '/w/'.length);
  const suffix =
    suffixStart === -1
      ? '/my-work'
      : routerLocation.pathname.slice(suffixStart);
  return (
    <Navigate
      replace
      to={{
        pathname: `${routePaths.workspace(workspace.identifier)}${suffix}`,
        search: routerLocation.search,
        hash: routerLocation.hash,
      }}
    />
  );
}

function useWorkspaceList(serverUrl: string, token: string) {
  const context = useMemo(() => ({ serverUrl, token }), [serverUrl, token]);
  return useQuery({
    queryKey: ['workspaces', serverUrl, token],
    queryFn: () => listWorkspaces(context),
    refetchOnMount: 'always',
  });
}

function canonicalWorkspacePath(
  location: WorkspaceLocation | null,
  pathname: string,
  resolveWorkspaceIdentifier: (workspaceId: string) => string | null,
) {
  if (!location) return '/';
  if (location.kind.endsWith('-settings')) return pathname;
  return serializeWorkspaceLocation(location, resolveWorkspaceIdentifier);
}

function readReturnTo(
  state: unknown,
  resolveWorkspaceId: (workspaceIdentifier: string) => string | null,
): WorkspaceContentLocation | null {
  if (
    !state ||
    typeof state !== 'object' ||
    !('returnTo' in state) ||
    typeof state.returnTo !== 'string'
  ) {
    return null;
  }

  return parseWorkspaceContentPath(state.returnTo, resolveWorkspaceId);
}

function settingsReturnToPath(
  location: WorkspaceReplacementLocation,
  resolveWorkspaceIdentifier: (workspaceId: string) => string | null,
): string | null {
  switch (location.kind) {
    case 'account-settings':
    case 'workspace-settings':
    case 'project-settings':
      return location.returnTo
        ? serializeContentLocation(
            location.returnTo,
            resolveWorkspaceIdentifier,
          )
        : null;
    default:
      return null;
  }
}

function serializeWorkspaceLocation(
  location: WorkspaceReplacementLocation,
  resolveWorkspaceIdentifier: (workspaceId: string) => string | null,
) {
  if (location.kind === 'root') return '/';
  const workspaceIdentifier = resolveWorkspaceIdentifier(location.workspaceId);
  return workspaceIdentifier
    ? workspaceLocationPath(location, workspaceIdentifier)
    : '/';
}

function serializeContentLocation(
  location: WorkspaceContentLocation,
  resolveWorkspaceIdentifier: (workspaceId: string) => string | null,
) {
  const workspaceIdentifier = resolveWorkspaceIdentifier(location.workspaceId);
  return workspaceIdentifier
    ? workspaceContentPath(location, workspaceIdentifier)
    : null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Could not load Workspaces.';
}

function WorkspaceListOpening() {
  return (
    <main className="status-page" aria-live="polite">
      <Wordmark quiet />
      <p>Opening your workspace…</p>
    </main>
  );
}

function WorkspaceListFailure({
  query,
}: {
  query: ReturnType<typeof useWorkspaceList>;
}) {
  return (
    <main className="status-page">
      <Wordmark quiet />
      <div className="form-heading" role="alert">
        <h1>Workspace unavailable</h1>
        <p>{errorMessage(query.error)}</p>
      </div>
      <button
        className="primary-button"
        type="button"
        onClick={() => void query.refetch()}
      >
        Try again
      </button>
    </main>
  );
}
