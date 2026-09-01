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
      return routePaths.workspaceSettings(
        workspaceIdentifier,
        location.section,
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
        documentId: params.documentId ?? null,
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
        documentId: params.documentId ?? null,
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
    case 'workspace-settings':
      return {
        kind,
        workspaceId,
        section: requiredParameter(params, 'section'),
        returnTo,
      };
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

function taskSelection(search: string) {
  const values = new URLSearchParams(search).getAll('task');
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
