import type { AccountSettingsSection } from '../../features/account/settingsSections';
import type { ProjectSettingsSection } from '../../features/project/settingsSections';
import type { WorkspaceSettingsSection } from '../../features/workspace/settingsSections';
import type { SetupStage } from '../../lib/api/types';

const segment = encodeURIComponent;

export const routePatterns = {
  root: '/',
  invite: '/invite',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  host: '/host',
  hostAccess: '/host/access',
  setupAccount: '/setup/account',
  setupWorkspace: '/setup/workspace',
  setupInvite: '/setup/invite',
  setupWildcard: '/setup/*',
  legacyWorkspace: '/:legacyWorkspaceIdentifier',
  legacyWorkspaceWildcard: '/:legacyWorkspaceIdentifier/*',
  legacyProject: '/w/:legacyWorkspaceIdentifier/projects/:legacyProjectId',
  legacyProjectWildcard:
    '/w/:legacyWorkspaceIdentifier/projects/:legacyProjectId/*',
  workspace: '/w/:workspaceIdentifier',
  workspaceMyWork: '/w/:workspaceIdentifier/my-work',
  workspaceInbox: '/w/:workspaceIdentifier/inbox',
  workspaceTasks: '/w/:workspaceIdentifier/tasks',
  workspaceView: '/w/:workspaceIdentifier/views/:viewId',
  workspaceLibrary: '/w/:workspaceIdentifier/library',
  legacyWorkspaceDocument: '/w/:workspaceIdentifier/library/:documentId',
  project: '/w/:workspaceIdentifier/p/:projectIdentifier',
  projectWorkItems: '/w/:workspaceIdentifier/p/:projectIdentifier/work-items',
  projectCycles: '/w/:workspaceIdentifier/p/:projectIdentifier/cycles',
  projectCycle: '/w/:workspaceIdentifier/p/:projectIdentifier/cycles/:cycleId',
  projectModules: '/w/:workspaceIdentifier/p/:projectIdentifier/modules',
  projectModule:
    '/w/:workspaceIdentifier/p/:projectIdentifier/modules/:moduleId',
  projectLibrary: '/w/:workspaceIdentifier/p/:projectIdentifier/library',
  legacyProjectDocument:
    '/w/:workspaceIdentifier/p/:projectIdentifier/library/:documentId',
  projectViews: '/w/:workspaceIdentifier/p/:projectIdentifier/views',
  projectView: '/w/:workspaceIdentifier/p/:projectIdentifier/views/:viewId',
  accountSettings: '/w/:workspaceIdentifier/settings/account/:section',
  workspaceSettings: '/w/:workspaceIdentifier/settings/workspace/:section',
  workspaceSettingsDetail:
    '/w/:workspaceIdentifier/settings/workspace/:section/:detail',
  projectSettings:
    '/w/:workspaceIdentifier/p/:projectIdentifier/settings/:section',
} as const;

function workspacePath(workspaceIdentifier: string) {
  return `/w/${segment(workspaceIdentifier)}`;
}

function projectPath(workspaceIdentifier: string, projectIdentifier: string) {
  return `${workspacePath(workspaceIdentifier)}/p/${segment(projectIdentifier)}`;
}

export const routePaths = {
  root: () => '/',
  invite: () => '/invite',
  forgotPassword: () => '/forgot-password',
  resetPassword: () => '/reset-password',
  host: () => '/host',
  hostAccess: () => '/host/access',
  setupAccount: () => '/setup/account',
  setupWorkspace: () => '/setup/workspace',
  setupInvite: () => '/setup/invite',
  workspace: (workspaceIdentifier: string) =>
    workspacePath(workspaceIdentifier),
  workspaceMyWork: (workspaceIdentifier: string) =>
    `${workspacePath(workspaceIdentifier)}/my-work`,
  workspaceInbox: (workspaceIdentifier: string) =>
    `${workspacePath(workspaceIdentifier)}/inbox`,
  workspaceTasks: (workspaceIdentifier: string) =>
    `${workspacePath(workspaceIdentifier)}/tasks`,
  workspaceView: (workspaceIdentifier: string, viewId: string) =>
    `${workspacePath(workspaceIdentifier)}/views/${segment(viewId)}`,
  workspaceLibrary: (workspaceIdentifier: string) =>
    `${workspacePath(workspaceIdentifier)}/library`,
  project: (workspaceIdentifier: string, projectId: string) =>
    projectPath(workspaceIdentifier, projectId),
  projectWorkItems: (workspaceIdentifier: string, projectId: string) =>
    `${projectPath(workspaceIdentifier, projectId)}/work-items`,
  projectCycles: (workspaceIdentifier: string, projectId: string) =>
    `${projectPath(workspaceIdentifier, projectId)}/cycles`,
  projectCycle: (
    workspaceIdentifier: string,
    projectId: string,
    cycleId: string,
  ) =>
    `${projectPath(workspaceIdentifier, projectId)}/cycles/${segment(cycleId)}`,
  projectModules: (workspaceIdentifier: string, projectId: string) =>
    `${projectPath(workspaceIdentifier, projectId)}/modules`,
  projectModule: (
    workspaceIdentifier: string,
    projectId: string,
    moduleId: string,
  ) =>
    `${projectPath(workspaceIdentifier, projectId)}/modules/${segment(moduleId)}`,
  projectLibrary: (workspaceIdentifier: string, projectId: string) =>
    `${projectPath(workspaceIdentifier, projectId)}/library`,
  projectViews: (workspaceIdentifier: string, projectId: string) =>
    `${projectPath(workspaceIdentifier, projectId)}/views`,
  projectView: (
    workspaceIdentifier: string,
    projectId: string,
    viewId: string,
  ) =>
    `${projectPath(workspaceIdentifier, projectId)}/views/${segment(viewId)}`,
  accountSettings: (
    workspaceIdentifier: string,
    section: AccountSettingsSection,
  ) =>
    `${workspacePath(workspaceIdentifier)}/settings/account/${segment(section)}`,
  workspaceSettings: (
    workspaceIdentifier: string,
    section: WorkspaceSettingsSection,
  ) =>
    `${workspacePath(workspaceIdentifier)}/settings/workspace/${segment(section)}`,
  workspaceSettingsDetail: (
    workspaceIdentifier: string,
    section: WorkspaceSettingsSection,
    detail: string,
  ) =>
    `${workspacePath(workspaceIdentifier)}/settings/workspace/${segment(section)}/${segment(detail)}`,
  projectSettings: (
    workspaceIdentifier: string,
    projectId: string,
    section: ProjectSettingsSection,
  ) =>
    `${projectPath(workspaceIdentifier, projectId)}/settings/${segment(section)}`,
} as const;

export function setupPathForStage(stage: Exclude<SetupStage, 'complete'>) {
  switch (stage) {
    case 'account':
      return routePaths.setupAccount();
    case 'workspace':
      return routePaths.setupWorkspace();
    case 'invite':
      return routePaths.setupInvite();
  }
}

export function withTask(path: string, taskId: string) {
  return updateSearchParameter(path, 'task', taskId);
}

export function withoutTask(path: string) {
  return updateSearchParameter(path, 'task');
}

export function withPage(path: string, pageNumber: string) {
  return updateSearchParameter(path, 'page', pageNumber);
}

export function withoutPage(path: string) {
  return updateSearchParameter(path, 'page');
}

function updateSearchParameter(
  path: string,
  name: 'task' | 'page',
  value?: string,
) {
  const hashIndex = path.indexOf('#');
  const hash = hashIndex === -1 ? '' : path.slice(hashIndex);
  const pathAndSearch = hashIndex === -1 ? path : path.slice(0, hashIndex);
  const searchIndex = pathAndSearch.indexOf('?');
  const pathname =
    searchIndex === -1 ? pathAndSearch : pathAndSearch.slice(0, searchIndex);
  const search = searchIndex === -1 ? '' : pathAndSearch.slice(searchIndex + 1);
  const parameters = new URLSearchParams(search);

  if (value === undefined) {
    parameters.delete(name);
  } else {
    parameters.set(name, value);
  }

  const nextSearch = parameters.toString();
  return `${pathname}${nextSearch ? `?${nextSearch}` : ''}${hash}`;
}
