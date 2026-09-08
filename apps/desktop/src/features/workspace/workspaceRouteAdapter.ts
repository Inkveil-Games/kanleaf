import { routePaths } from '../../app/routing/routePaths';
import { isAccountSettingsSection } from '../account/settingsSections';
import { isProjectSettingsSection } from '../project/settingsSections';
import { isWorkspaceSettingsSection } from './settingsSections';
import type {
  WorkspaceContentLocation,
  WorkspaceLocation,
  WorkspaceReplacementLocation,
} from './workspaceLocation';
import { workspaceContentPath } from './workspaceLocation';

export type WorkspaceRouteKind =
  | 'root'
  | 'my-work'
  | 'inbox'
  | 'all-tasks'
  | 'workspace-view'
  | 'workspace-library'
  | 'project-overview'
  | 'project-work-items'
  | 'project-cycles'
  | 'project-modules'
  | 'project-library'
  | 'project-views'
  | 'project-view'
  | 'account-settings'
  | 'workspace-settings'
  | 'project-settings';

export function workspaceLocationPath(
  location: WorkspaceReplacementLocation,
  workspaceIdentifier: string,
  resolveProjectIdentifier: (projectId: string) => string | null = (value) =>
    value,
  resolveTaskNumber: (taskId: string) => string | null = (value) => value,
  resolveDocumentNumber: (documentId: string) => string | null = (value) =>
    value,
): string {
  switch (location.kind) {
    case 'root':
      return routePaths.root();
    case 'account-settings':
      if (!isAccountSettingsSection(location.section)) {
        throw new Error('Invalid Account Settings section');
      }
      return routePaths.accountSettings(workspaceIdentifier, location.section);
    case 'workspace-settings':
      if (!isWorkspaceSettingsSection(location.section)) {
        throw new Error('Invalid Workspace Settings section');
      }
      return withDefineProperty(
        location.detail
          ? routePaths.workspaceSettingsDetail(
              workspaceIdentifier,
              location.section,
              location.detail,
            )
          : routePaths.workspaceSettings(workspaceIdentifier, location.section),
        location.definePropertyName,
      );
    case 'project-settings':
      if (!isProjectSettingsSection(location.section)) {
        throw new Error('Invalid Project Settings section');
      }
      return routePaths.projectSettings(
        workspaceIdentifier,
        resolveProjectIdentifier(location.projectId) ?? location.projectId,
        location.section,
      );
    default:
      return workspaceContentPath(
        location,
        workspaceIdentifier,
        resolveProjectIdentifier,
        resolveTaskNumber,
        resolveDocumentNumber,
      );
  }
}

export function workspaceLocationFromRoute(
  kind: WorkspaceRouteKind,
  workspaceId: string | null,
  params: Readonly<Record<string, string | undefined>>,
  search: string,
  returnTo: WorkspaceContentLocation | null,
): WorkspaceLocation | null {
  if (kind === 'root') return null;

  if (!workspaceId) {
    throw new Error('Missing resolved Workspace ID');
  }
  const taskId = taskSelection(search);
  const documentId = pageSelection(search);

  switch (kind) {
    case 'my-work':
    case 'inbox':
      return { kind, workspaceId, taskId };
    case 'all-tasks':
      return { kind, workspaceId, taskId };
    case 'workspace-view':
      return {
        kind,
        workspaceId,
        viewId: requiredParameter(params, 'viewId'),
        taskId,
      };
    case 'workspace-library':
      return {
        kind,
        workspaceId,
        documentId: documentId ?? params.documentId ?? null,
      };
    case 'project-overview':
    case 'project-views':
      return {
        kind,
        workspaceId,
        projectId: requiredParameter(params, 'projectId'),
      };
    case 'project-work-items':
      return {
        kind,
        workspaceId,
        projectId: requiredParameter(params, 'projectId'),
        taskId,
      };
    case 'project-cycles':
      return {
        kind,
        workspaceId,
        projectId: requiredParameter(params, 'projectId'),
        cycleId: params.cycleId ?? null,
      };
    case 'project-modules':
      return {
        kind,
        workspaceId,
        projectId: requiredParameter(params, 'projectId'),
        moduleId: params.moduleId ?? null,
      };
    case 'project-library':
      return {
        kind,
        workspaceId,
        projectId: requiredParameter(params, 'projectId'),
        documentId: documentId ?? params.documentId ?? null,
      };
    case 'project-view':
      return {
        kind,
        workspaceId,
        projectId: requiredParameter(params, 'projectId'),
        viewId: requiredParameter(params, 'viewId'),
        taskId,
      };
    case 'account-settings':
      return {
        kind,
        workspaceId,
        section: requiredParameter(params, 'section'),
        returnTo,
      };
    case 'workspace-settings': {
      const section = requiredParameter(params, 'section');
      const detail = params.detail;
      const defineValues = new URLSearchParams(search).getAll('define');
      const definePropertyName =
        section === 'properties' && (!detail || detail === 'new')
          ? defineValues.length === 1 && defineValues[0]
            ? defineValues[0]
            : undefined
          : undefined;
      return {
        kind,
        workspaceId,
        section: section === 'invitations' ? 'members' : section,
        ...(detail ? { detail } : {}),
        definePropertyName,
        returnTo,
      };
    }
    case 'project-settings':
      return {
        kind,
        workspaceId,
        projectId: requiredParameter(params, 'projectId'),
        section: requiredParameter(params, 'section'),
        returnTo,
      };
  }
}

function withDefineProperty(path: string, name?: string) {
  if (!name) return path;
  return `${path}?${new URLSearchParams({ define: name }).toString()}`;
}

function taskSelection(search: string) {
  const values = new URLSearchParams(search).getAll('task');
  return values.length === 1 && values[0] ? values[0] : null;
}

function pageSelection(search: string) {
  const values = new URLSearchParams(search).getAll('page');
  return values.length === 1 && values[0] ? values[0] : null;
}

function requiredParameter(
  params: Readonly<Record<string, string | undefined>>,
  name: string,
) {
  const value = params[name];
  if (!value) throw new Error(`Missing route parameter: ${name}`);
  return value;
}
