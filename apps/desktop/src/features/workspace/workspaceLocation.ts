import type { WorkspaceDocument } from '../document/types';
import type { SavedView } from '../view/types';
import { routePaths, withPage, withTask } from '../../app/routing/routePaths';
import type { Project, Task, Workspace } from './types';

export type TaskCollectionLocation =
  | {
      kind: 'my-work' | 'inbox' | 'all-tasks';
      workspaceId: string;
      taskId: string | null;
    }
  | {
      kind: 'workspace-view';
      workspaceId: string;
      viewId: string;
      taskId: string | null;
    }
  | {
      kind: 'project-work-items';
      workspaceId: string;
      projectId: string;
      taskId: string | null;
    }
  | {
      kind: 'project-view';
      workspaceId: string;
      projectId: string;
      viewId: string;
      taskId: string | null;
    };

export type WorkspaceContentLocation =
  | TaskCollectionLocation
  | {
      kind: 'workspace-library';
      workspaceId: string;
      documentId: string | null;
    }
  | {
      kind: 'project-overview' | 'project-views';
      workspaceId: string;
      projectId: string;
    }
  | {
      kind: 'project-library';
      workspaceId: string;
      projectId: string;
      documentId: string | null;
    }
  | {
      kind: 'project-cycles';
      workspaceId: string;
      projectId: string;
      cycleId: string | null;
    }
  | {
      kind: 'project-modules';
      workspaceId: string;
      projectId: string;
      moduleId: string | null;
    };

export type WorkspaceSettingsLocation =
  | {
      kind: 'account-settings';
      workspaceId: string;
      section: string;
      returnTo: WorkspaceContentLocation | null;
    }
  | {
      kind: 'workspace-settings';
      workspaceId: string;
      section: string;
      detail?: string;
      definePropertyName?: string;
      returnTo: WorkspaceContentLocation | null;
    }
  | {
      kind: 'project-settings';
      workspaceId: string;
      projectId: string;
      section: string;
      returnTo: WorkspaceContentLocation | null;
    };

export type WorkspaceLocation =
  WorkspaceContentLocation | WorkspaceSettingsLocation;

export type SettingsDetailHistory = 'push' | 'replace' | 'back';

export function parseWorkspaceContentPath(
  value: string,
  resolveWorkspaceId: (workspaceIdentifier: string) => string | null,
  resolveProjectId: (projectIdentifier: string) => string | null = (value) =>
    value,
  resolveTaskId: (taskNumber: string) => string | null = (value) => value,
  resolveDocumentId: (pageNumber: string) => string | null = (value) => value,
): WorkspaceContentLocation | null {
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('#')) {
    return null;
  }

  const searchIndex = value.indexOf('?');
  const pathname = searchIndex === -1 ? value : value.slice(0, searchIndex);
  const search = searchIndex === -1 ? '' : value.slice(searchIndex + 1);
  const parameters = new URLSearchParams(search);
  if ([...parameters.keys()].some((key) => key !== 'task' && key !== 'page')) {
    return null;
  }

  const taskValues = parameters.getAll('task');
  if (taskValues.length > 1 || taskValues[0] === '') {
    return null;
  }
  const pageValues = parameters.getAll('page');
  if (pageValues.length > 1 || pageValues[0] === '') {
    return null;
  }

  let segments: string[];
  try {
    segments = pathname
      .split('/')
      .slice(1)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }

  if (
    segments.some(
      (segment) => segment.length === 0 || segment === '.' || segment === '..',
    )
  ) {
    return null;
  }

  if (segments[0] !== 'w') return null;
  const workspaceIdentifier = segments[1];
  const workspaceId = workspaceIdentifier
    ? resolveWorkspaceId(workspaceIdentifier)
    : null;
  if (!workspaceIdentifier || !workspaceId) {
    return null;
  }

  const publicLocation = contentLocationFromSegments(
    segments.slice(2),
    workspaceIdentifier,
  );
  const publicTaskNumber = taskValues[0] ?? null;
  const publicPageNumber = pageValues[0] ?? null;
  if (
    !publicLocation ||
    (publicTaskNumber !== null && !hasTask(publicLocation)) ||
    (publicPageNumber !== null && !hasDocument(publicLocation)) ||
    (publicTaskNumber !== null && publicPageNumber !== null)
  ) {
    return null;
  }

  const publicSelection = hasTask(publicLocation)
    ? { ...publicLocation, taskId: publicTaskNumber }
    : hasDocument(publicLocation)
      ? { ...publicLocation, documentId: publicPageNumber }
      : publicLocation;
  if (workspaceContentPath(publicSelection, workspaceIdentifier) !== value) {
    return null;
  }

  const projectIdentifier =
    'projectId' in publicSelection ? publicSelection.projectId : null;
  const projectId = projectIdentifier
    ? resolveProjectId(projectIdentifier)
    : null;
  if (projectIdentifier && !projectId) return null;
  const taskId = publicTaskNumber ? resolveTaskId(publicTaskNumber) : null;
  if (publicTaskNumber && !taskId) return null;
  const documentId = publicPageNumber
    ? resolveDocumentId(publicPageNumber)
    : null;
  if (publicPageNumber && !documentId) return null;
  return {
    ...publicSelection,
    workspaceId,
    ...(projectId ? { projectId } : {}),
    ...(hasTask(publicSelection) ? { taskId } : {}),
    ...(hasDocument(publicSelection) ? { documentId } : {}),
  };
}

export function workspaceContentPath(
  location: WorkspaceContentLocation,
  workspaceIdentifier: string,
  resolveProjectIdentifier: (projectId: string) => string | null = (value) =>
    value,
  resolveTaskNumber: (taskId: string) => string | null = (value) => value,
  resolveDocumentNumber: (documentId: string) => string | null = (value) =>
    value,
) {
  const path = contentPathWithoutSelection(
    location,
    workspaceIdentifier,
    resolveProjectIdentifier,
  );
  return hasTask(location) && location.taskId
    ? withTask(path, resolveTaskNumber(location.taskId) ?? location.taskId)
    : hasDocument(location) && location.documentId
      ? withPage(
          path,
          resolveDocumentNumber(location.documentId) ?? location.documentId,
        )
      : path;
}

export type Resolution<T> =
  | { status: 'pending' }
  | { status: 'transient-error' }
  | { status: 'resolved'; value: T }
  | { status: 'absent' }
  | { status: 'forbidden' };

export type WorkspaceRouteAccess = Pick<Workspace, 'id' | 'role'>;
export type ProjectRouteAccess = Pick<
  Project,
  | 'id'
  | 'workspace_id'
  | 'visibility'
  | 'effective_role'
  | 'can_join'
  | 'cycles_enabled'
  | 'modules_enabled'
  | 'pages_enabled'
  | 'views_enabled'
>;
export type SavedViewRouteAccess = Pick<
  SavedView,
  'id' | 'workspace_id' | 'project_id'
>;
export type DocumentRouteAccess = Pick<
  WorkspaceDocument,
  'id' | 'workspace_id' | 'project_id'
>;
export type PlanningRouteAccess = {
  id: string;
  workspace_id: string;
  project_id: string;
};
export type TaskRouteAccess = Pick<Task, 'id' | 'workspace_id' | 'project_id'>;

export interface WorkspaceLocationAccess {
  activeWorkspaceId: string | null;
  workspaces: Resolution<readonly WorkspaceRouteAccess[]>;
  project?: Resolution<ProjectRouteAccess>;
  savedView?: Resolution<SavedViewRouteAccess>;
  document?: Resolution<DocumentRouteAccess>;
  cycle?: Resolution<PlanningRouteAccess>;
  module?: Resolution<PlanningRouteAccess>;
  task?: Resolution<TaskRouteAccess>;
  settingsSections?: Resolution<readonly string[]>;
}

export type WorkspaceReplacementLocation = WorkspaceLocation | { kind: 'root' };

export type WorkspaceReconciliation =
  | { status: 'wait' }
  | { status: 'keep' }
  | {
      status: 'replace';
      location: WorkspaceReplacementLocation;
      notice?: 'task-unavailable';
    };

export function reconcileWorkspaceLocation(
  location: WorkspaceLocation,
  access: WorkspaceLocationAccess,
): WorkspaceReconciliation {
  if (access.workspaces.status === 'pending') {
    return { status: 'wait' };
  }
  if (access.workspaces.status === 'transient-error') {
    return { status: 'keep' };
  }

  if (access.workspaces.status !== 'resolved') {
    return { status: 'replace', location: { kind: 'root' } };
  }

  const workspace = access.workspaces.value.find(
    ({ id }) => id === location.workspaceId,
  );
  if (!workspace) {
    return {
      status: 'replace',
      location: fallbackWorkspace(access),
    };
  }

  if (workspace.role === 'guest' && isGuestRestricted(location)) {
    if (location.kind !== 'my-work' || location.taskId !== null) {
      return {
        status: 'replace',
        location: myWork(location.workspaceId),
      };
    }
  }

  const routedProjectId = projectIdForLocation(location);
  let routedProject: ProjectRouteAccess | null = null;
  if (routedProjectId) {
    const project = access.project;
    if (!project || project.status === 'pending') {
      return { status: 'wait' };
    }
    if (project.status === 'transient-error') {
      return { status: 'keep' };
    }
    if (
      project.status !== 'resolved' ||
      project.value.id !== routedProjectId ||
      project.value.workspace_id !== location.workspaceId
    ) {
      return {
        status: 'replace',
        location: myWork(location.workspaceId),
      };
    }

    const projectOverview = overview(location.workspaceId, routedProjectId);
    if (project.value.effective_role === null) {
      const discoverable =
        project.value.visibility === 'public' && project.value.can_join;
      if (!discoverable) {
        return {
          status: 'replace',
          location: myWork(location.workspaceId),
        };
      }
      return location.kind === 'project-overview'
        ? { status: 'keep' }
        : { status: 'replace', location: projectOverview };
    }
    routedProject = project.value;

    if (
      location.kind !== 'project-view' &&
      (projectFeatureDisabled(location, project.value) ||
        (location.kind === 'project-settings' &&
          project.value.effective_role !== 'admin'))
    ) {
      return { status: 'replace', location: projectOverview };
    }
  }

  let viewUnavailable = false;
  if (location.kind === 'workspace-view' || location.kind === 'project-view') {
    const view = access.savedView;
    if (!view || view.status === 'pending') {
      return { status: 'wait' };
    }
    if (view.status === 'transient-error') {
      return { status: 'keep' };
    }
    viewUnavailable =
      view.status !== 'resolved' ||
      view.value.id !== location.viewId ||
      view.value.workspace_id !== location.workspaceId;

    if (!viewUnavailable && view.status === 'resolved') {
      const canonicalView: TaskCollectionLocation = view.value.project_id
        ? {
            kind: 'project-view',
            workspaceId: location.workspaceId,
            projectId: view.value.project_id,
            viewId: location.viewId,
            taskId: location.taskId,
          }
        : {
            kind: 'workspace-view',
            workspaceId: location.workspaceId,
            viewId: location.viewId,
            taskId: location.taskId,
          };
      const scopeMatches =
        canonicalView.kind === location.kind &&
        (canonicalView.kind !== 'project-view' ||
          (location.kind === 'project-view' &&
            canonicalView.projectId === location.projectId));
      if (!scopeMatches) {
        return { status: 'replace', location: canonicalView };
      }
    }
  }

  if (
    location.kind === 'project-view' &&
    routedProject &&
    !routedProject.views_enabled
  ) {
    return {
      status: 'replace',
      location: overview(location.workspaceId, location.projectId),
    };
  }

  if (
    viewUnavailable &&
    (location.kind === 'workspace-view' || location.kind === 'project-view')
  ) {
    return { status: 'replace', location: viewParent(location) };
  }

  if (
    (location.kind === 'workspace-library' ||
      location.kind === 'project-library') &&
    location.documentId !== null
  ) {
    const expectedProjectId =
      location.kind === 'project-library' ? location.projectId : null;
    const documentResult = reconcileResource(
      access.document,
      (document) =>
        document.id === location.documentId &&
        document.workspace_id === location.workspaceId &&
        document.project_id === expectedProjectId,
      { ...location, documentId: null },
    );
    if (documentResult) {
      return documentResult;
    }
  }

  if (location.kind === 'project-cycles' && location.cycleId !== null) {
    const cycleResult = reconcileResource(
      access.cycle,
      (cycle) =>
        cycle.id === location.cycleId &&
        cycle.workspace_id === location.workspaceId &&
        cycle.project_id === location.projectId,
      { ...location, cycleId: null },
    );
    if (cycleResult) {
      return cycleResult;
    }
  }

  if (location.kind === 'project-modules' && location.moduleId !== null) {
    const moduleResult = reconcileResource(
      access.module,
      (module) =>
        module.id === location.moduleId &&
        module.workspace_id === location.workspaceId &&
        module.project_id === location.projectId,
      { ...location, moduleId: null },
    );
    if (moduleResult) {
      return moduleResult;
    }
  }

  if (isSettingsLocation(location)) {
    const sections = access.settingsSections;
    if (!sections || sections.status === 'pending') {
      return { status: 'wait' };
    }
    if (sections.status === 'transient-error') {
      return { status: 'keep' };
    }
    if (sections.status !== 'resolved' || sections.value.length === 0) {
      return { status: 'replace', location: settingsReturnTarget(location) };
    }
    if (!sections.value.includes(location.section)) {
      return {
        status: 'replace',
        location: {
          ...location,
          section: sections.value[0],
          ...(location.kind === 'workspace-settings'
            ? { detail: undefined, definePropertyName: undefined }
            : {}),
          returnTo: settingsReturnTarget(location),
        },
      };
    }

    const returnTarget = settingsReturnTarget(location);
    if (location.returnTo && returnTarget !== location.returnTo) {
      return {
        status: 'replace',
        location: { ...location, returnTo: returnTarget },
      };
    }

    const background = reconcileWorkspaceLocation(returnTarget, access);
    if (background.status === 'wait') {
      return background;
    }
    if (background.status === 'replace') {
      const replacement = background.location;
      const returnTo =
        replacement.kind === 'root' || isSettingsLocation(replacement)
          ? settingsFallback(location)
          : replacement;
      return {
        status: 'replace',
        location: { ...location, returnTo },
        ...(background.notice ? { notice: background.notice } : {}),
      };
    }
  }

  if (hasTask(location) && location.taskId !== null) {
    const task = access.task;
    if (!task || task.status === 'pending') {
      return { status: 'wait' };
    }
    if (task.status === 'transient-error') {
      return { status: 'keep' };
    }

    const expectedProjectId =
      location.kind === 'project-work-items' || location.kind === 'project-view'
        ? location.projectId
        : undefined;
    const taskMatches =
      task.status === 'resolved' &&
      task.value.id === location.taskId &&
      task.value.workspace_id === location.workspaceId &&
      (expectedProjectId === undefined ||
        task.value.project_id === expectedProjectId);
    if (!taskMatches) {
      return {
        status: 'replace',
        location: { ...location, taskId: null },
        notice: 'task-unavailable',
      };
    }
  }

  return { status: 'keep' };
}

export function settingsReturnTarget(
  location: WorkspaceSettingsLocation,
): WorkspaceContentLocation {
  const fallback = settingsFallback(location);
  const candidate = location.returnTo;

  if (!candidate || candidate.workspaceId !== location.workspaceId) {
    return fallback;
  }

  if (location.kind === 'project-settings') {
    return projectId(candidate) === location.projectId ? candidate : fallback;
  }

  return candidate;
}

// This strips overlays for Task query/layout draft identity. Render a Settings
// background with settingsReturnTarget() so an open Task remains visible.
export function workspaceBaseLocation(
  location: WorkspaceLocation,
): WorkspaceContentLocation {
  const content = isSettingsLocation(location)
    ? settingsReturnTarget(location)
    : location;

  return hasTask(content) && content.taskId !== null
    ? { ...content, taskId: null }
    : content;
}

export function workspaceLocationIdentity(location: WorkspaceLocation): string {
  const content = workspaceBaseLocation(location);

  switch (content.kind) {
    case 'my-work':
    case 'inbox':
    case 'all-tasks':
      return `${content.workspaceId}:${content.kind}`;
    case 'workspace-library':
      return [content.workspaceId, content.kind, content.documentId]
        .filter(Boolean)
        .join(':');
    case 'workspace-view':
      return `${content.workspaceId}:${content.kind}:${content.viewId}`;
    case 'project-overview':
    case 'project-work-items':
    case 'project-views':
      return `${content.workspaceId}:${content.kind}:${content.projectId}`;
    case 'project-library':
      return [
        content.workspaceId,
        content.kind,
        content.projectId,
        content.documentId,
      ]
        .filter(Boolean)
        .join(':');
    case 'project-cycles':
      return [
        content.workspaceId,
        content.kind,
        content.projectId,
        content.cycleId,
      ]
        .filter(Boolean)
        .join(':');
    case 'project-modules':
      return [
        content.workspaceId,
        content.kind,
        content.projectId,
        content.moduleId,
      ]
        .filter(Boolean)
        .join(':');
    case 'project-view':
      return `${content.workspaceId}:${content.kind}:${content.projectId}:${content.viewId}`;
  }
}

function isSettingsLocation(
  location: WorkspaceLocation,
): location is WorkspaceSettingsLocation {
  return location.kind.endsWith('-settings');
}

function hasTask(
  location: WorkspaceLocation,
): location is TaskCollectionLocation {
  return (
    location.kind === 'my-work' ||
    location.kind === 'inbox' ||
    location.kind === 'all-tasks' ||
    location.kind === 'workspace-view' ||
    location.kind === 'project-work-items' ||
    location.kind === 'project-view'
  );
}

function hasDocument(
  location: WorkspaceLocation,
): location is Extract<
  WorkspaceContentLocation,
  { kind: 'workspace-library' | 'project-library' }
> {
  return (
    location.kind === 'workspace-library' || location.kind === 'project-library'
  );
}

function projectId(location: WorkspaceContentLocation): string | null {
  return 'projectId' in location ? location.projectId : null;
}

function projectIdForLocation(location: WorkspaceLocation): string | null {
  return 'projectId' in location ? location.projectId : null;
}

function settingsFallback(
  location: WorkspaceSettingsLocation,
): WorkspaceContentLocation {
  if (location.kind === 'project-settings') {
    return {
      kind: 'project-overview',
      workspaceId: location.workspaceId,
      projectId: location.projectId,
    };
  }

  return {
    kind: 'my-work',
    workspaceId: location.workspaceId,
    taskId: null,
  };
}

function fallbackWorkspace(
  access: WorkspaceLocationAccess,
): WorkspaceReplacementLocation {
  if (access.workspaces.status !== 'resolved') {
    return { kind: 'root' };
  }

  const active = access.workspaces.value.find(
    ({ id }) => id === access.activeWorkspaceId,
  );
  const workspaceId = active?.id ?? access.workspaces.value[0]?.id;

  return workspaceId ? myWork(workspaceId) : { kind: 'root' };
}

function myWork(workspaceId: string): WorkspaceContentLocation {
  return { kind: 'my-work', workspaceId, taskId: null };
}

function overview(
  workspaceId: string,
  projectId: string,
): WorkspaceContentLocation {
  return { kind: 'project-overview', workspaceId, projectId };
}

function viewParent(
  location: Extract<
    WorkspaceContentLocation,
    { kind: 'workspace-view' | 'project-view' }
  >,
): WorkspaceContentLocation {
  if (location.kind === 'project-view') {
    return {
      kind: 'project-views',
      workspaceId: location.workspaceId,
      projectId: location.projectId,
    };
  }

  return {
    kind: 'all-tasks',
    workspaceId: location.workspaceId,
    taskId: null,
  };
}

function isGuestRestricted(location: WorkspaceLocation): boolean {
  return (
    location.kind === 'my-work' ||
    location.kind === 'inbox' ||
    location.kind === 'all-tasks' ||
    location.kind === 'workspace-view' ||
    location.kind === 'workspace-library'
  );
}

function projectFeatureDisabled(
  location: WorkspaceLocation,
  project: ProjectRouteAccess,
): boolean {
  switch (location.kind) {
    case 'project-cycles':
      return !project.cycles_enabled;
    case 'project-modules':
      return !project.modules_enabled;
    case 'project-library':
      return !project.pages_enabled;
    case 'project-views':
    case 'project-view':
      return !project.views_enabled;
    default:
      return false;
  }
}

function reconcileResource<T>(
  resolution: Resolution<T> | undefined,
  matches: (value: T) => boolean,
  parent: WorkspaceContentLocation,
): WorkspaceReconciliation | null {
  if (!resolution) {
    return null;
  }
  if (resolution.status === 'pending') {
    return { status: 'wait' };
  }
  if (resolution.status === 'transient-error') {
    return { status: 'keep' };
  }
  if (resolution.status !== 'resolved' || !matches(resolution.value)) {
    return { status: 'replace', location: parent };
  }
  return null;
}

function contentLocationFromSegments(
  segments: string[],
  workspaceId: string,
): WorkspaceContentLocation | null {
  const [area, projectId, surface, resourceId] = segments;

  if (segments.length === 1) {
    if (area === 'my-work' || area === 'inbox') {
      return { kind: area, workspaceId, taskId: null };
    }
    if (area === 'tasks') {
      return { kind: 'all-tasks', workspaceId, taskId: null };
    }
    if (area === 'library') {
      return { kind: 'workspace-library', workspaceId, documentId: null };
    }
    return null;
  }

  if (segments.length === 2 && area !== 'p' && projectId) {
    if (area === 'views') {
      return {
        kind: 'workspace-view',
        workspaceId,
        viewId: projectId,
        taskId: null,
      };
    }
    if (area === 'library') {
      return {
        kind: 'workspace-library',
        workspaceId,
        documentId: projectId,
      };
    }
    return null;
  }

  if (area !== 'p' || !projectId) {
    return null;
  }
  if (segments.length === 2) {
    return { kind: 'project-overview', workspaceId, projectId };
  }
  if (segments.length === 3) {
    switch (surface) {
      case 'work-items':
        return {
          kind: 'project-work-items',
          workspaceId,
          projectId,
          taskId: null,
        };
      case 'cycles':
        return {
          kind: 'project-cycles',
          workspaceId,
          projectId,
          cycleId: null,
        };
      case 'modules':
        return {
          kind: 'project-modules',
          workspaceId,
          projectId,
          moduleId: null,
        };
      case 'library':
        return {
          kind: 'project-library',
          workspaceId,
          projectId,
          documentId: null,
        };
      case 'views':
        return { kind: 'project-views', workspaceId, projectId };
      default:
        return null;
    }
  }
  if (segments.length !== 4 || !resourceId) {
    return null;
  }

  switch (surface) {
    case 'cycles':
      return {
        kind: 'project-cycles',
        workspaceId,
        projectId,
        cycleId: resourceId,
      };
    case 'modules':
      return {
        kind: 'project-modules',
        workspaceId,
        projectId,
        moduleId: resourceId,
      };
    case 'library':
      return {
        kind: 'project-library',
        workspaceId,
        projectId,
        documentId: resourceId,
      };
    case 'views':
      return {
        kind: 'project-view',
        workspaceId,
        projectId,
        viewId: resourceId,
        taskId: null,
      };
    default:
      return null;
  }
}

function contentPathWithoutSelection(
  location: WorkspaceContentLocation,
  workspaceIdentifier: string,
  resolveProjectIdentifier: (projectId: string) => string | null,
): string {
  const publicProjectId = (projectId: string) =>
    resolveProjectIdentifier(projectId) ?? projectId;
  switch (location.kind) {
    case 'my-work':
      return routePaths.workspaceMyWork(workspaceIdentifier);
    case 'inbox':
      return routePaths.workspaceInbox(workspaceIdentifier);
    case 'all-tasks':
      return routePaths.workspaceTasks(workspaceIdentifier);
    case 'workspace-view':
      return routePaths.workspaceView(workspaceIdentifier, location.viewId);
    case 'workspace-library':
      return routePaths.workspaceLibrary(workspaceIdentifier);
    case 'project-overview':
      return routePaths.project(
        workspaceIdentifier,
        publicProjectId(location.projectId),
      );
    case 'project-work-items':
      return routePaths.projectWorkItems(
        workspaceIdentifier,
        publicProjectId(location.projectId),
      );
    case 'project-cycles':
      return location.cycleId
        ? routePaths.projectCycle(
            workspaceIdentifier,
            publicProjectId(location.projectId),
            location.cycleId,
          )
        : routePaths.projectCycles(
            workspaceIdentifier,
            publicProjectId(location.projectId),
          );
    case 'project-modules':
      return location.moduleId
        ? routePaths.projectModule(
            workspaceIdentifier,
            publicProjectId(location.projectId),
            location.moduleId,
          )
        : routePaths.projectModules(
            workspaceIdentifier,
            publicProjectId(location.projectId),
          );
    case 'project-library':
      return routePaths.projectLibrary(
        workspaceIdentifier,
        publicProjectId(location.projectId),
      );
    case 'project-views':
      return routePaths.projectViews(
        workspaceIdentifier,
        publicProjectId(location.projectId),
      );
    case 'project-view':
      return routePaths.projectView(
        workspaceIdentifier,
        publicProjectId(location.projectId),
        location.viewId,
      );
  }
}
