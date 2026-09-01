import type { AccountSettingsSection } from '../../features/account/settingsSections';
import type { ProjectSettingsSection } from '../../features/project/settingsSections';
import type { WorkspaceSettingsSection } from '../../features/workspace/settingsSections';

const segment = encodeURIComponent;

export const routePatterns = {
  root: '/',
  host: '/host',
  hostAccess: '/host/access',
  workspace: '/w/:workspaceId',
  workspaceMyWork: '/w/:workspaceId/my-work',
  workspaceInbox: '/w/:workspaceId/inbox',
  workspaceTasks: '/w/:workspaceId/tasks',
  workspaceView: '/w/:workspaceId/views/:viewId',
  workspaceLibrary: '/w/:workspaceId/library',
  workspaceDocument: '/w/:workspaceId/library/:documentId',
  project: '/w/:workspaceId/projects/:projectId',
  projectWorkItems: '/w/:workspaceId/projects/:projectId/work-items',
  projectCycles: '/w/:workspaceId/projects/:projectId/cycles',
  projectCycle: '/w/:workspaceId/projects/:projectId/cycles/:cycleId',
  projectModules: '/w/:workspaceId/projects/:projectId/modules',
  projectModule: '/w/:workspaceId/projects/:projectId/modules/:moduleId',
  projectLibrary: '/w/:workspaceId/projects/:projectId/library',
  projectDocument: '/w/:workspaceId/projects/:projectId/library/:documentId',
  projectViews: '/w/:workspaceId/projects/:projectId/views',
  projectView: '/w/:workspaceId/projects/:projectId/views/:viewId',
  accountSettings: '/w/:workspaceId/settings/account/:section',
  workspaceSettings: '/w/:workspaceId/settings/workspace/:section',
  projectSettings: '/w/:workspaceId/projects/:projectId/settings/:section',
} as const;

function workspacePath(workspaceId: string) {
  return `/w/${segment(workspaceId)}`;
}

function projectPath(workspaceId: string, projectId: string) {
  return `${workspacePath(workspaceId)}/projects/${segment(projectId)}`;
}

export const routePaths = {
  root: () => '/',
  host: () => '/host',
  hostAccess: () => '/host/access',
  workspace: (workspaceId: string) => workspacePath(workspaceId),
  workspaceMyWork: (workspaceId: string) =>
    `${workspacePath(workspaceId)}/my-work`,
  workspaceInbox: (workspaceId: string) =>
    `${workspacePath(workspaceId)}/inbox`,
  workspaceTasks: (workspaceId: string) =>
    `${workspacePath(workspaceId)}/tasks`,
  workspaceView: (workspaceId: string, viewId: string) =>
    `${workspacePath(workspaceId)}/views/${segment(viewId)}`,
  workspaceLibrary: (workspaceId: string) =>
    `${workspacePath(workspaceId)}/library`,
  workspaceDocument: (workspaceId: string, documentId: string) =>
    `${workspacePath(workspaceId)}/library/${segment(documentId)}`,
  project: (workspaceId: string, projectId: string) =>
    projectPath(workspaceId, projectId),
  projectWorkItems: (workspaceId: string, projectId: string) =>
    `${projectPath(workspaceId, projectId)}/work-items`,
  projectCycles: (workspaceId: string, projectId: string) =>
    `${projectPath(workspaceId, projectId)}/cycles`,
  projectCycle: (workspaceId: string, projectId: string, cycleId: string) =>
    `${projectPath(workspaceId, projectId)}/cycles/${segment(cycleId)}`,
  projectModules: (workspaceId: string, projectId: string) =>
    `${projectPath(workspaceId, projectId)}/modules`,
  projectModule: (workspaceId: string, projectId: string, moduleId: string) =>
    `${projectPath(workspaceId, projectId)}/modules/${segment(moduleId)}`,
  projectLibrary: (workspaceId: string, projectId: string) =>
    `${projectPath(workspaceId, projectId)}/library`,
  projectDocument: (
    workspaceId: string,
    projectId: string,
    documentId: string,
  ) => `${projectPath(workspaceId, projectId)}/library/${segment(documentId)}`,
  projectViews: (workspaceId: string, projectId: string) =>
    `${projectPath(workspaceId, projectId)}/views`,
  projectView: (workspaceId: string, projectId: string, viewId: string) =>
    `${projectPath(workspaceId, projectId)}/views/${segment(viewId)}`,
  accountSettings: (workspaceId: string, section: AccountSettingsSection) =>
    `${workspacePath(workspaceId)}/settings/account/${segment(section)}`,
  workspaceSettings: (workspaceId: string, section: WorkspaceSettingsSection) =>
    `${workspacePath(workspaceId)}/settings/workspace/${segment(section)}`,
  projectSettings: (
    workspaceId: string,
    projectId: string,
    section: ProjectSettingsSection,
  ) => `${projectPath(workspaceId, projectId)}/settings/${segment(section)}`,
} as const;

export function withTask(path: string, taskId: string) {
  return updateTask(path, taskId);
}

export function withoutTask(path: string) {
  return updateTask(path);
}

function updateTask(path: string, taskId?: string) {
  const hashIndex = path.indexOf('#');
  const hash = hashIndex === -1 ? '' : path.slice(hashIndex);
  const pathAndSearch = hashIndex === -1 ? path : path.slice(0, hashIndex);
  const searchIndex = pathAndSearch.indexOf('?');
  const pathname =
    searchIndex === -1 ? pathAndSearch : pathAndSearch.slice(0, searchIndex);
  const search = searchIndex === -1 ? '' : pathAndSearch.slice(searchIndex + 1);
  const parameters = new URLSearchParams(search);

  if (taskId === undefined) {
    parameters.delete('task');
  } else {
    parameters.set('task', taskId);
  }

  const nextSearch = parameters.toString();
  return `${pathname}${nextSearch ? `?${nextSearch}` : ''}${hash}`;
}
