import { apiRequest } from '../../lib/api/client';
import type { Collection, Project, Task, TaskPatch, Workspace } from './types';

interface ApiContext {
  serverUrl: string;
  token: string;
}

export function listWorkspaces(context: ApiContext) {
  return apiRequest<Workspace[]>(context.serverUrl, '/api/workspaces', {
    token: context.token,
  });
}

export function createWorkspace(context: ApiContext, name: string) {
  return apiRequest<Workspace>(context.serverUrl, '/api/workspaces', {
    method: 'POST',
    token: context.token,
    body: JSON.stringify({ name }),
  });
}

export function renameWorkspace(
  context: ApiContext,
  workspaceId: string,
  name: string,
) {
  return apiRequest<Workspace>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}`,
    {
      method: 'PATCH',
      token: context.token,
      body: JSON.stringify({ name }),
    },
  );
}

export function activateWorkspace(context: ApiContext, workspaceId: string) {
  return apiRequest<void>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/activate`,
    { method: 'POST', token: context.token },
  );
}

export function listProjects(context: ApiContext, workspaceId: string) {
  return apiRequest<Project[]>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/projects`,
    { token: context.token },
  );
}

export function createProject(
  context: ApiContext,
  workspaceId: string,
  name: string,
) {
  return apiRequest<Project>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/projects`,
    {
      method: 'POST',
      token: context.token,
      body: JSON.stringify({ name }),
    },
  );
}

export function renameProject(
  context: ApiContext,
  workspaceId: string,
  projectId: string,
  name: string,
) {
  return apiRequest<Project>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/projects/${projectId}`,
    {
      method: 'PATCH',
      token: context.token,
      body: JSON.stringify({ name }),
    },
  );
}

export function archiveProject(
  context: ApiContext,
  workspaceId: string,
  projectId: string,
) {
  return apiRequest<void>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/projects/${projectId}`,
    { method: 'DELETE', token: context.token },
  );
}

export function listTasks(
  context: ApiContext,
  workspaceId: string,
  collection: Collection,
  query: string,
) {
  const parameters = new URLSearchParams();
  if (collection.kind === 'inbox') parameters.set('inbox', 'true');
  if (collection.kind === 'project') {
    parameters.set('project_id', collection.projectId);
  }
  if (query.trim()) parameters.set('query', query.trim());
  const search = parameters.size ? `?${parameters.toString()}` : '';
  return apiRequest<Task[]>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/tasks${search}`,
    { token: context.token },
  );
}

export function getTask(
  context: ApiContext,
  workspaceId: string,
  taskId: string,
) {
  return apiRequest<Task>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/tasks/${taskId}`,
    { token: context.token },
  );
}

export function createTask(
  context: ApiContext,
  workspaceId: string,
  title: string,
  collection: Collection,
) {
  return apiRequest<Task>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/tasks`,
    {
      method: 'POST',
      token: context.token,
      body: JSON.stringify({
        title,
        project_id: collection.kind === 'project' ? collection.projectId : null,
      }),
    },
  );
}

export function updateTask(
  context: ApiContext,
  workspaceId: string,
  taskId: string,
  patch: TaskPatch,
) {
  return apiRequest<Task>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/tasks/${taskId}`,
    {
      method: 'PATCH',
      token: context.token,
      body: JSON.stringify(patch),
    },
  );
}

export function archiveTask(
  context: ApiContext,
  workspaceId: string,
  taskId: string,
) {
  return apiRequest<void>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/tasks/${taskId}`,
    { method: 'DELETE', token: context.token },
  );
}
