import { apiRequest } from '../../lib/api/client';
import type {
  AssignableWorkspaceRole,
  Collection,
  IssuedWorkspaceInvitation,
  Project,
  Task,
  TaskPatch,
  Workspace,
  WorkspaceAccent,
  WorkspaceInvitation,
  WorkspaceMember,
} from './types';

export interface ApiContext {
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
  return updateWorkspace(context, workspaceId, { name });
}

export function updateWorkspace(
  context: ApiContext,
  workspaceId: string,
  patch: { name?: string; accent?: WorkspaceAccent },
) {
  return apiRequest<Workspace>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}`,
    {
      method: 'PATCH',
      token: context.token,
      body: JSON.stringify(patch),
    },
  );
}

export function deleteWorkspace(
  context: ApiContext,
  workspaceId: string,
  confirmation: { name: string; password: string },
) {
  return apiRequest<void>(context.serverUrl, `/api/workspaces/${workspaceId}`, {
    method: 'DELETE',
    token: context.token,
    body: JSON.stringify(confirmation),
  });
}

export function listWorkspaceMembers(context: ApiContext, workspaceId: string) {
  return apiRequest<WorkspaceMember[]>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/members`,
    { token: context.token },
  );
}

export function updateWorkspaceMember(
  context: ApiContext,
  workspaceId: string,
  userId: string,
  role: AssignableWorkspaceRole,
) {
  return apiRequest<WorkspaceMember>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/members/${userId}`,
    {
      method: 'PATCH',
      token: context.token,
      body: JSON.stringify({ role }),
    },
  );
}

export function removeWorkspaceMember(
  context: ApiContext,
  workspaceId: string,
  userId: string,
) {
  return apiRequest<void>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/members/${userId}`,
    { method: 'DELETE', token: context.token },
  );
}

export function leaveWorkspace(context: ApiContext, workspaceId: string) {
  return apiRequest<void>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/leave`,
    { method: 'POST', token: context.token },
  );
}

export function transferWorkspaceOwnership(
  context: ApiContext,
  workspaceId: string,
  userId: string,
) {
  return apiRequest<void>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/transfer-ownership`,
    {
      method: 'POST',
      token: context.token,
      body: JSON.stringify({ user_id: userId }),
    },
  );
}

export function listWorkspaceInvitations(
  context: ApiContext,
  workspaceId: string,
) {
  return apiRequest<WorkspaceInvitation[]>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/invitations`,
    { token: context.token },
  );
}

export function createWorkspaceInvitation(
  context: ApiContext,
  workspaceId: string,
  email: string,
  role: AssignableWorkspaceRole,
) {
  return apiRequest<IssuedWorkspaceInvitation>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/invitations`,
    {
      method: 'POST',
      token: context.token,
      body: JSON.stringify({ email, role }),
    },
  );
}

export function renewWorkspaceInvitation(
  context: ApiContext,
  workspaceId: string,
  invitationId: string,
) {
  return apiRequest<IssuedWorkspaceInvitation>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/invitations/${invitationId}/renew`,
    { method: 'POST', token: context.token },
  );
}

export function revokeWorkspaceInvitation(
  context: ApiContext,
  workspaceId: string,
  invitationId: string,
) {
  return apiRequest<void>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/invitations/${invitationId}`,
    { method: 'DELETE', token: context.token },
  );
}

export function listPendingInvitations(context: ApiContext) {
  return apiRequest<WorkspaceInvitation[]>(
    context.serverUrl,
    '/api/invitations',
    { token: context.token },
  );
}

export function acceptInvitation(context: ApiContext, invitationId: string) {
  return apiRequest<void>(
    context.serverUrl,
    `/api/invitations/${invitationId}/accept`,
    { method: 'POST', token: context.token },
  );
}

export function acceptInvitationToken(context: ApiContext, token: string) {
  return apiRequest<void>(context.serverUrl, '/api/invitations/accept-token', {
    method: 'POST',
    token: context.token,
    body: JSON.stringify({ token }),
  });
}

export function declineInvitation(context: ApiContext, invitationId: string) {
  return apiRequest<void>(
    context.serverUrl,
    `/api/invitations/${invitationId}/decline`,
    { method: 'POST', token: context.token },
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
