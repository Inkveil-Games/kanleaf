import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import {
  Navigate,
  useLocation,
  useNavigate,
  useParams,
  type NavigateFunction,
} from 'react-router';
import { Wordmark } from '../../components/ui/Wordmark';
import { routePaths } from '../../app/routing/routePaths';
import { ApiError } from '../../lib/api/client';
import { getDocument, getDocumentByNumber } from '../document/api';
import type { WorkspaceDocument } from '../document/types';
import type {
  WorkspaceContentLocation,
  WorkspaceLocation,
  WorkspaceReplacementLocation,
} from './workspaceLocation';
import {
  getTask,
  getTaskByNumber,
  listProjects,
  listWorkspaces,
  type ApiContext,
} from './api';
import {
  parseWorkspaceContentPath,
  workspaceContentPath,
} from './workspaceLocation';
import { WorkspaceShell, type WorkspaceShellProps } from './WorkspaceShell';
import type { Project, Task, Workspace } from './types';
import {
  workspaceLocationFromRoute,
  workspaceLocationPath,
  type WorkspaceRouteKind,
} from './workspaceRouteAdapter';

export type WorkspaceRouteScreenProps = Omit<
  WorkspaceShellProps,
  'location' | 'onNavigate' | 'routeActionError' | 'workspaceAccessVerified'
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
  const context = useMemo(
    () => ({ serverUrl: shellProps.serverUrl, token: shellProps.token }),
    [shellProps.serverUrl, shellProps.token],
  );
  const workspaces = useWorkspaceList(shellProps.serverUrl, shellProps.token);
  const workspaceForIdentifier = workspaces.data?.find(
    ({ identifier }) => identifier === params.workspaceIdentifier,
  );
  const workspaceForRoute =
    workspaceForIdentifier ??
    workspaces.data?.find(({ id }) => id === params.workspaceIdentifier);
  const returnToPath = returnToPathFromState(routerLocation.state);
  const pageLocator = pageRouteLocator(
    routeKind,
    params.documentId,
    routerLocation.search,
  );
  const returnToPageLocator = returnToPath
    ? pageSearchLocator(searchFromPath(returnToPath))
    : null;
  const requestedPageLocator = pageLocator ?? returnToPageLocator;
  const needsProject = projectRoute(routeKind);
  const returnToNeedsProject = returnToPath?.includes('/p/') ?? false;
  const projects = useQuery({
    queryKey: ['projects', workspaceForRoute?.id],
    queryFn: () => listProjects(context, workspaceForRoute!.id),
    enabled: Boolean(
      workspaceForRoute &&
      (needsProject || returnToNeedsProject || requestedPageLocator),
    ),
    retry: false,
  });
  const projectLocator = params.projectIdentifier ?? params.projectId;
  const projectForRoute = projects.data?.find(
    ({ identifier, id }) =>
      identifier === projectLocator || id === projectLocator,
  );
  const taskLocator = taskRouteLocator(routerLocation.search);
  const returnToTaskLocator = returnToPath
    ? taskRouteLocator(searchFromPath(returnToPath))
    : null;
  const requestedTaskLocator = taskLocator ?? returnToTaskLocator;
  const selectedTask = useQuery({
    queryKey: [
      'routed-task',
      workspaceForRoute?.id,
      requestedTaskLocator?.kind,
      requestedTaskLocator?.value,
    ],
    queryFn: () =>
      requestedTaskLocator?.kind === 'number'
        ? getTaskByNumber(
            context,
            workspaceForRoute!.id,
            requestedTaskLocator.value,
          )
        : getTask(context, workspaceForRoute!.id, requestedTaskLocator!.value),
    enabled: Boolean(workspaceForRoute && requestedTaskLocator),
    retry: false,
  });
  const selectedDocument = useQuery({
    queryKey: [
      'routed-document',
      workspaceForRoute?.id,
      requestedPageLocator?.kind,
      requestedPageLocator?.value,
    ],
    queryFn: () =>
      requestedPageLocator?.kind === 'number'
        ? getDocumentByNumber(
            context,
            workspaceForRoute!.id,
            requestedPageLocator.value,
          )
        : getDocument(
            context,
            workspaceForRoute!.id,
            requestedPageLocator!.value,
          ),
    enabled: Boolean(workspaceForRoute && requestedPageLocator),
    retry: false,
  });
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
  const resolveProjectIdentifier = useCallback(
    (projectId: string) =>
      projects.data?.find(({ id }) => id === projectId)?.identifier ?? null,
    [projects.data],
  );
  const resolveTaskNumber = useCallback(
    (taskId: string) =>
      taskNumberFromCache(
        queryClient,
        workspaceForRoute?.id ?? null,
        taskId,
        selectedTask.data,
      ),
    [queryClient, selectedTask.data, workspaceForRoute?.id],
  );
  const resolveDocumentNumber = useCallback(
    (documentId: string) =>
      documentNumberFromCache(
        queryClient,
        workspaceForRoute?.id ?? null,
        documentId,
        selectedDocument.data,
      ),
    [queryClient, selectedDocument.data, workspaceForRoute?.id],
  );
  const resolveProjectId = useCallback(
    (projectIdentifier: string) =>
      projects.data?.find(({ identifier }) => identifier === projectIdentifier)
        ?.id ?? null,
    [projects.data],
  );
  const resolveTaskId = useCallback(
    (publicTaskLocator: string) =>
      selectedTask.data &&
      (selectedTask.data.task_number === Number(publicTaskLocator) ||
        selectedTask.data.id === publicTaskLocator)
        ? selectedTask.data.id
        : null,
    [selectedTask.data],
  );
  const resolveDocumentId = useCallback(
    (publicPageLocator: string) =>
      selectedDocument.data &&
      (selectedDocument.data.document_number === Number(publicPageLocator) ||
        selectedDocument.data.id === publicPageLocator)
        ? selectedDocument.data.id
        : null,
    [selectedDocument.data],
  );
  const returnTo = readReturnTo(
    routerLocation.state,
    resolveWorkspaceId,
    resolveProjectId,
    resolveTaskId,
    resolveDocumentId,
  );
  const routedLocation =
    (routeKind === 'root' || workspaceForRoute) &&
    (!needsProject || projectForRoute) &&
    (taskLocator === null || selectedTask.data || selectedTask.error) &&
    (pageLocator === null || selectedDocument.data || selectedDocument.error)
      ? workspaceLocationFromRoute(
          routeKind,
          workspaceForRoute?.id ?? null,
          {
            ...params,
            projectId: projectForRoute?.id,
            documentId: selectedDocument.data?.id,
          },
          taskLocator !== null && selectedTask.data
            ? `?task=${encodeURIComponent(selectedTask.data.id)}`
            : pageLocator !== null && selectedDocument.data
              ? `?page=${encodeURIComponent(selectedDocument.data.id)}`
              : '',
          returnTo,
        )
      : null;
  const location = documentOwnerLocation(
    taskOwnerLocation(routedLocation, selectedTask.data, projects.data),
    selectedDocument.data,
    projects.data,
  );
  const currentReturnToPath = returnTo
    ? serializeContentLocation(
        returnTo,
        resolveWorkspaceIdentifier,
        resolveProjectIdentifier,
        resolveTaskNumber,
        resolveDocumentNumber,
      )
    : null;
  const canonicalPath = canonicalWorkspacePath(
    location,
    routerLocation.pathname,
    resolveWorkspaceIdentifier,
    resolveProjectIdentifier,
    resolveTaskNumber,
    resolveDocumentNumber,
  );
  const missingPage = Boolean(
    pageLocator &&
    selectedDocument.error &&
    isUnavailableResourceError(selectedDocument.error),
  );
  const routeActionError = missingPage
    ? 'That Page is unavailable or you no longer have access.'
    : routeActionErrorFromState(routerLocation.state);
  const currentPath = `${routerLocation.pathname}${routerLocation.search}`;

  const onNavigate = useCallback(
    (
      nextLocation: WorkspaceReplacementLocation,
      options?: { replace?: boolean },
    ) => {
      void navigateResolvedLocation(
        nextLocation,
        options,
        context,
        queryClient,
        resolveWorkspaceIdentifier,
        resolveProjectIdentifier,
        resolveTaskNumber,
        resolveDocumentNumber,
        currentPath,
        currentReturnToPath,
        navigate,
      );
    },
    [
      context,
      currentPath,
      currentReturnToPath,
      navigate,
      queryClient,
      resolveProjectIdentifier,
      resolveTaskNumber,
      resolveDocumentNumber,
      resolveWorkspaceIdentifier,
    ],
  );

  if (workspaces.error) {
    return <WorkspaceListFailure query={workspaces} />;
  }

  if (
    projects.error &&
    (needsProject || Boolean(selectedDocument.data?.project_id))
  ) {
    return (
      <RouteAccessFailure
        title="Project unavailable"
        error={projects.error}
        onRetry={() => void projects.refetch()}
      />
    );
  }

  if (
    workspaces.isPending ||
    !workspaces.isFetchedAfterMount ||
    (routeKind !== 'root' && !workspaceForRoute && workspaces.isFetching) ||
    (needsProject && projects.isPending) ||
    (Boolean(selectedDocument.data?.project_id) && projects.isPending) ||
    (workspaceForRoute &&
      requestedTaskLocator !== null &&
      selectedTask.isPending) ||
    (workspaceForRoute &&
      requestedPageLocator !== null &&
      selectedDocument.isPending)
  ) {
    return <WorkspaceListOpening />;
  }

  if (
    selectedDocument.error &&
    !isUnavailableResourceError(selectedDocument.error)
  ) {
    return (
      <RouteAccessFailure
        title="Page unavailable"
        error={selectedDocument.error}
        onRetry={() => void selectedDocument.refetch()}
      />
    );
  }

  if (routeKind !== 'root' && !workspaceForRoute) {
    return <Navigate replace to="/" />;
  }

  if (needsProject && !projectForRoute) {
    if (!workspaceForRoute) return <Navigate replace to="/" />;
    return (
      <Navigate
        replace
        to={routePaths.workspaceMyWork(workspaceForRoute.identifier)}
      />
    );
  }

  if (canonicalPath !== currentPath) {
    return (
      <Navigate
        replace
        state={
          missingPage
            ? stateWithRouteActionError(routerLocation.state, routeActionError)
            : routerLocation.state
        }
        to={`${canonicalPath}${routerLocation.hash}`}
      />
    );
  }

  return (
    <WorkspaceShell
      key={shellProps.user.id}
      {...shellProps}
      location={location}
      routeActionError={routeActionError}
      workspaceAccessVerified
      onNavigate={onNavigate}
    />
  );
}

export function LegacyWorkspaceRedirect({
  serverUrl,
  token,
  underWorkspaceRoot = false,
}: Pick<WorkspaceShellProps, 'serverUrl' | 'token'> & {
  underWorkspaceRoot?: boolean;
}) {
  const params = useParams();
  const routerLocation = useLocation();
  const workspaces = useWorkspaceList(serverUrl, token);
  const context = useMemo(() => ({ serverUrl, token }), [serverUrl, token]);
  const workspaceLocator = params.legacyWorkspaceIdentifier;
  const workspace = workspaces.data?.find(
    ({ id, identifier }) =>
      id === workspaceLocator || identifier === workspaceLocator,
  );
  const legacySuffix = legacyWorkspaceSuffix(
    routerLocation.pathname,
    underWorkspaceRoot,
  );
  const legacyProjectLocator =
    legacySuffix[0] === 'projects' ? decodeSegment(legacySuffix[1]) : null;
  const projects = useQuery({
    queryKey: ['projects', workspace?.id],
    queryFn: () => listProjects(context, workspace!.id),
    enabled: Boolean(workspace && legacyProjectLocator),
    retry: false,
  });

  if (workspaces.error) {
    return <WorkspaceListFailure query={workspaces} />;
  }
  if (
    workspaces.isPending ||
    workspaces.isFetching ||
    (legacyProjectLocator && projects.isPending)
  ) {
    return <WorkspaceListOpening />;
  }

  if (!workspace) {
    return <Navigate replace to={routePaths.root()} />;
  }
  if (legacyProjectLocator && projects.error) {
    return (
      <RouteAccessFailure
        title="Project unavailable"
        error={projects.error}
        onRetry={() => void projects.refetch()}
      />
    );
  }

  const legacyProject = legacyProjectLocator
    ? projects.data?.find(
        ({ id, identifier }) =>
          id === legacyProjectLocator || identifier === legacyProjectLocator,
      )
    : null;
  if (legacyProjectLocator && !legacyProject) {
    return (
      <Navigate replace to={routePaths.workspaceMyWork(workspace.identifier)} />
    );
  }

  const suffix = legacyProject
    ? [
        'p',
        encodeURIComponent(legacyProject.identifier),
        ...legacySuffix.slice(2),
      ]
    : legacySuffix;
  const suffixPath = suffix.length > 0 ? `/${suffix.join('/')}` : '/my-work';
  return (
    <Navigate
      replace
      to={{
        pathname: `${routePaths.workspace(workspace.identifier)}${suffixPath}`,
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
  resolveProjectIdentifier: (projectId: string) => string | null,
  resolveTaskNumber: (taskId: string) => string | null,
  resolveDocumentNumber: (documentId: string) => string | null,
) {
  if (!location) return '/';
  if (location.kind.endsWith('-settings')) {
    if (
      location.kind === 'workspace-settings' &&
      location.section === 'members' &&
      pathname.replace(/\/+$/, '').endsWith('/settings/workspace/invitations')
    ) {
      const workspaceIdentifier = resolveWorkspaceIdentifier(
        location.workspaceId,
      );
      return workspaceIdentifier
        ? routePaths.workspaceSettings(workspaceIdentifier, 'members')
        : pathname;
    }
    return pathname;
  }
  return serializeWorkspaceLocation(
    location,
    resolveWorkspaceIdentifier,
    resolveProjectIdentifier,
    resolveTaskNumber,
    resolveDocumentNumber,
  );
}

function readReturnTo(
  state: unknown,
  resolveWorkspaceId: (workspaceIdentifier: string) => string | null,
  resolveProjectId: (projectIdentifier: string) => string | null,
  resolveTaskId: (taskNumber: string) => string | null,
  resolveDocumentId: (pageNumber: string) => string | null,
): WorkspaceContentLocation | null {
  const value = returnToPathFromState(state);
  return value
    ? parseWorkspaceContentPath(
        value,
        resolveWorkspaceId,
        resolveProjectId,
        resolveTaskId,
        resolveDocumentId,
      )
    : null;
}

function returnToPathFromState(state: unknown): string | null {
  return state &&
    typeof state === 'object' &&
    'returnTo' in state &&
    typeof state.returnTo === 'string'
    ? state.returnTo
    : null;
}

function routeActionErrorFromState(state: unknown): string | null {
  return state &&
    typeof state === 'object' &&
    'routeActionError' in state &&
    typeof state.routeActionError === 'string'
    ? state.routeActionError
    : null;
}

function stateWithRouteActionError(state: unknown, message: string | null) {
  const current = state && typeof state === 'object' ? state : {};
  return { ...current, routeActionError: message };
}

function searchFromPath(path: string) {
  const queryStart = path.indexOf('?');
  if (queryStart === -1) return '';
  const hashStart = path.indexOf('#', queryStart);
  return path.slice(queryStart, hashStart === -1 ? undefined : hashStart);
}

function settingsReturnToPath(
  location: WorkspaceReplacementLocation,
  resolveWorkspaceIdentifier: (workspaceId: string) => string | null,
  resolveProjectIdentifier: (projectId: string) => string | null,
  resolveTaskNumber: (taskId: string) => string | null,
  resolveDocumentNumber: (documentId: string) => string | null,
): string | null {
  switch (location.kind) {
    case 'account-settings':
    case 'workspace-settings':
    case 'project-settings':
      return location.returnTo
        ? serializeContentLocation(
            location.returnTo,
            resolveWorkspaceIdentifier,
            resolveProjectIdentifier,
            resolveTaskNumber,
            resolveDocumentNumber,
          )
        : null;
    default:
      return null;
  }
}

async function navigateResolvedLocation(
  location: WorkspaceReplacementLocation,
  options: { replace?: boolean } | undefined,
  context: ApiContext,
  queryClient: QueryClient,
  resolveWorkspaceIdentifier: (workspaceId: string) => string | null,
  resolveProjectIdentifier: (projectId: string) => string | null,
  resolveTaskNumber: (taskId: string) => string | null,
  resolveDocumentNumber: (documentId: string) => string | null,
  currentPath: string,
  currentReturnToPath: string | null,
  navigate: NavigateFunction,
) {
  const workspaceId = location.kind === 'root' ? null : location.workspaceId;
  const taskId = taskIdForLocation(location);
  const documentId = documentIdForLocation(location);
  let fetchedTask: Task | null = null;
  if (workspaceId && taskId && !resolveTaskNumber(taskId)) {
    try {
      fetchedTask = await getTask(context, workspaceId, taskId);
      queryClient.setQueryData(['task', workspaceId, taskId], fetchedTask);
    } catch {
      return;
    }
  }
  let fetchedDocument: WorkspaceDocument | null = null;
  if (workspaceId && documentId && !resolveDocumentNumber(documentId)) {
    try {
      fetchedDocument = await getDocument(context, workspaceId, documentId);
      queryClient.setQueryData(
        ['document', workspaceId, documentId],
        fetchedDocument,
      );
    } catch {
      return;
    }
  }
  const taskNumber = (candidate: string) =>
    fetchedTask?.id === candidate
      ? String(fetchedTask.task_number)
      : resolveTaskNumber(candidate);
  const documentNumber = (candidate: string) =>
    fetchedDocument?.id === candidate
      ? String(fetchedDocument.document_number)
      : resolveDocumentNumber(candidate);
  const path = serializeWorkspaceLocation(
    location,
    resolveWorkspaceIdentifier,
    resolveProjectIdentifier,
    taskNumber,
    documentNumber,
  );
  const nextReturnToPath = settingsReturnToPath(
    location,
    resolveWorkspaceIdentifier,
    resolveProjectIdentifier,
    taskNumber,
    documentNumber,
  );
  const samePath = path === currentPath;
  if (samePath && nextReturnToPath === currentReturnToPath) return;
  navigate(path, {
    replace: Boolean(options?.replace || samePath),
    state: nextReturnToPath ? { returnTo: nextReturnToPath } : null,
  });
}

function projectRoute(kind: WorkspaceRouteKind) {
  return kind.startsWith('project-');
}

function taskRouteLocator(
  search: string,
):
  | { kind: 'number'; value: number }
  | { kind: 'legacy-id'; value: string }
  | null {
  const values = new URLSearchParams(search).getAll('task');
  if (values.length !== 1) return null;
  const value = values[0] ?? '';
  if (/^\d+$/.test(value)) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0
      ? { kind: 'number', value: number }
      : null;
  }
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
    ? { kind: 'legacy-id', value }
    : null;
}

type PublicResourceLocator =
  { kind: 'number'; value: number } | { kind: 'legacy-id'; value: string };

function pageRouteLocator(
  routeKind: WorkspaceRouteKind,
  legacyDocumentId: string | undefined,
  search: string,
): PublicResourceLocator | null {
  if (routeKind !== 'workspace-library' && routeKind !== 'project-library') {
    return null;
  }
  return legacyDocumentId
    ? legacyIdLocator(legacyDocumentId)
    : pageSearchLocator(search);
}

function pageSearchLocator(search: string): PublicResourceLocator | null {
  const values = new URLSearchParams(search).getAll('page');
  return values.length === 1 ? publicResourceLocator(values[0] ?? '') : null;
}

function publicResourceLocator(value: string): PublicResourceLocator | null {
  if (/^\d+$/.test(value)) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0
      ? { kind: 'number', value: number }
      : null;
  }
  return legacyIdLocator(value);
}

function legacyIdLocator(value: string): PublicResourceLocator | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
    ? { kind: 'legacy-id', value }
    : null;
}

function taskOwnerLocation(
  location: WorkspaceLocation | null,
  task: Task | undefined,
  projects: Project[] | undefined,
): WorkspaceLocation | null {
  if (
    !location ||
    !task ||
    !('taskId' in location) ||
    location.taskId !== task.id ||
    (location.kind !== 'project-work-items' &&
      location.kind !== 'project-view') ||
    location.projectId === task.project_id
  ) {
    return location;
  }

  if (task.project_id && projects?.some(({ id }) => id === task.project_id)) {
    return {
      kind: 'project-work-items',
      workspaceId: location.workspaceId,
      projectId: task.project_id,
      taskId: task.id,
    };
  }

  return {
    kind: 'all-tasks',
    workspaceId: location.workspaceId,
    taskId: task.project_id ? null : task.id,
  };
}

function documentOwnerLocation(
  location: WorkspaceLocation | null,
  document: WorkspaceDocument | undefined,
  projects: Project[] | undefined,
): WorkspaceLocation | null {
  if (
    !location ||
    !document ||
    !('documentId' in location) ||
    location.documentId !== document.id
  ) {
    return location;
  }

  if (document.project_id === null) {
    return location.kind === 'workspace-library'
      ? location
      : {
          kind: 'workspace-library',
          workspaceId: location.workspaceId,
          documentId: document.id,
        };
  }
  if (!projects?.some(({ id }) => id === document.project_id)) {
    return location;
  }
  return location.kind === 'project-library' &&
    location.projectId === document.project_id
    ? location
    : {
        kind: 'project-library',
        workspaceId: location.workspaceId,
        projectId: document.project_id,
        documentId: document.id,
      };
}

function legacyWorkspaceSuffix(pathname: string, underWorkspaceRoot: boolean) {
  const segments = pathname.split('/').slice(1);
  return segments.slice(underWorkspaceRoot ? 2 : 1);
}

function decodeSegment(value: string | undefined) {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function taskNumberFromCache(
  queryClient: QueryClient,
  workspaceId: string | null,
  taskId: string,
  routedTask?: Task,
): string | null {
  if (!workspaceId) return null;
  if (routedTask?.id === taskId) return String(routedTask.task_number);
  const detail = queryClient.getQueryData<Task>(['task', workspaceId, taskId]);
  if (detail) return String(detail.task_number);
  for (const [, data] of queryClient.getQueriesData<unknown>({
    queryKey: ['tasks', workspaceId],
  })) {
    if (!Array.isArray(data)) continue;
    const task = (data as Task[]).find(({ id }) => id === taskId);
    if (task) return String(task.task_number);
  }
  return null;
}

function documentNumberFromCache(
  queryClient: QueryClient,
  workspaceId: string | null,
  documentId: string,
  routedDocument?: WorkspaceDocument,
): string | null {
  if (!workspaceId) return null;
  if (routedDocument?.id === documentId) {
    return String(routedDocument.document_number);
  }
  const detail = queryClient.getQueryData<WorkspaceDocument>([
    'document',
    workspaceId,
    documentId,
  ]);
  if (detail) return String(detail.document_number);
  for (const [, data] of queryClient.getQueriesData<unknown>({
    queryKey: ['documents', workspaceId],
  })) {
    if (!Array.isArray(data)) continue;
    const document = (data as WorkspaceDocument[]).find(
      ({ id }) => id === documentId,
    );
    if (document) return String(document.document_number);
  }
  return null;
}

function taskIdForLocation(
  location: WorkspaceReplacementLocation,
): string | null {
  if (location.kind === 'root') return null;
  if ('taskId' in location) return location.taskId;
  return 'returnTo' in location && location.returnTo
    ? taskIdForLocation(location.returnTo)
    : null;
}

function documentIdForLocation(
  location: WorkspaceReplacementLocation,
): string | null {
  if (location.kind === 'root') return null;
  if ('documentId' in location) return location.documentId;
  return 'returnTo' in location && location.returnTo
    ? documentIdForLocation(location.returnTo)
    : null;
}

function serializeWorkspaceLocation(
  location: WorkspaceReplacementLocation,
  resolveWorkspaceIdentifier: (workspaceId: string) => string | null,
  resolveProjectIdentifier: (projectId: string) => string | null,
  resolveTaskNumber: (taskId: string) => string | null,
  resolveDocumentNumber: (documentId: string) => string | null,
) {
  if (location.kind === 'root') return '/';
  const workspaceIdentifier = resolveWorkspaceIdentifier(location.workspaceId);
  return workspaceIdentifier
    ? workspaceLocationPath(
        location,
        workspaceIdentifier,
        resolveProjectIdentifier,
        resolveTaskNumber,
        resolveDocumentNumber,
      )
    : '/';
}

function serializeContentLocation(
  location: WorkspaceContentLocation,
  resolveWorkspaceIdentifier: (workspaceId: string) => string | null,
  resolveProjectIdentifier: (projectId: string) => string | null,
  resolveTaskNumber: (taskId: string) => string | null,
  resolveDocumentNumber: (documentId: string) => string | null,
) {
  const workspaceIdentifier = resolveWorkspaceIdentifier(location.workspaceId);
  return workspaceIdentifier
    ? workspaceContentPath(
        location,
        workspaceIdentifier,
        resolveProjectIdentifier,
        resolveTaskNumber,
        resolveDocumentNumber,
      )
    : null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Could not load Workspaces.';
}

function isUnavailableResourceError(error: unknown) {
  return (
    error instanceof ApiError &&
    (error.status === 403 || error.status === 404 || error.status === 422)
  );
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

function RouteAccessFailure({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <main className="status-page">
      <Wordmark quiet />
      <div className="form-heading" role="alert">
        <h1>{title}</h1>
        <p>{errorMessage(error)}</p>
      </div>
      <button className="primary-button" type="button" onClick={onRetry}>
        Try again
      </button>
    </main>
  );
}
