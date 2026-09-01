import { useCallback } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router';
import type {
  WorkspaceContentLocation,
  WorkspaceLocation,
  WorkspaceReplacementLocation,
} from './workspaceLocation';
import {
  parseWorkspaceContentPath,
  workspaceContentPath,
} from './workspaceLocation';
import { WorkspaceShell, type WorkspaceShellProps } from './WorkspaceShell';
import {
  workspaceLocationFromRoute,
  workspaceLocationPath,
  type WorkspaceRouteKind,
} from './workspaceRouteAdapter';

export type WorkspaceRouteScreenProps = Omit<
  WorkspaceShellProps,
  'location' | 'onNavigate'
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
  const returnTo = readReturnTo(routerLocation.state);
  const location = workspaceLocationFromRoute(
    routeKind,
    params,
    routerLocation.search,
    returnTo,
  );
  const currentReturnToPath = returnTo ? workspaceContentPath(returnTo) : null;
  const canonicalPath = canonicalWorkspacePath(
    location,
    routerLocation.pathname,
  );
  const currentPath = `${routerLocation.pathname}${routerLocation.search}`;

  const onNavigate = useCallback(
    (
      nextLocation: WorkspaceReplacementLocation,
      options?: { replace?: boolean },
    ) => {
      const path = workspaceLocationPath(nextLocation);
      const nextReturnToPath = settingsReturnToPath(nextLocation);
      const samePath = path === currentPath;

      if (samePath && nextReturnToPath === currentReturnToPath) return;

      navigate(path, {
        replace: Boolean(options?.replace || samePath),
        state: nextReturnToPath ? { returnTo: nextReturnToPath } : null,
      });
    },
    [currentPath, currentReturnToPath, navigate],
  );

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
      onNavigate={onNavigate}
    />
  );
}

function canonicalWorkspacePath(
  location: WorkspaceLocation | null,
  pathname: string,
) {
  if (!location) return '/';
  if (location.kind.endsWith('-settings')) return pathname;
  return workspaceLocationPath(location);
}

function readReturnTo(state: unknown): WorkspaceContentLocation | null {
  if (
    !state ||
    typeof state !== 'object' ||
    !('returnTo' in state) ||
    typeof state.returnTo !== 'string'
  ) {
    return null;
  }

  return parseWorkspaceContentPath(state.returnTo);
}

function settingsReturnToPath(
  location: WorkspaceReplacementLocation,
): string | null {
  switch (location.kind) {
    case 'account-settings':
    case 'workspace-settings':
    case 'project-settings':
      return location.returnTo ? workspaceContentPath(location.returnTo) : null;
    default:
      return null;
  }
}
