import { apiRequest } from '../../lib/api/client';
import type {
  AssignableWorkspaceRole,
  Collection,
  IssuedWorkspaceInvitation,
  Project,
  ProjectCycle,
  ProjectCyclePatch,
  ProjectMember,
  ProjectModule,
  ProjectModulePatch,
  ProjectPatch,
  ProjectRole,
  Task,
  TaskBulkPatch,
  TaskPatch,
  TaskRelationType,
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

export function updateProject(
  context: ApiContext,
  workspaceId: string,
  projectId: string,
  patch: ProjectPatch,
) {
  return apiRequest<Project>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/projects/${projectId}`,
    {
      method: 'PATCH',
      token: context.token,
      body: JSON.stringify(patch),
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

export function deleteProject(
  context: ApiContext,
  workspaceId: string,
  projectId: string,
  identifier: string,
) {
  return apiRequest<void>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/projects/${projectId}/delete`,
    {
      method: 'POST',
      token: context.token,
      body: JSON.stringify({ identifier }),
    },
  );
}

export function joinProject(
  context: ApiContext,
  workspaceId: string,
  projectId: string,
) {
  return apiRequest<void>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/projects/${projectId}/join`,
    { method: 'POST', token: context.token },
  );
}

export function listProjectMembers(
  context: ApiContext,
  workspaceId: string,
  projectId: string,
) {
  return apiRequest<ProjectMember[]>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/projects/${projectId}/members`,
    { token: context.token },
  );
}

export function addProjectMember(
  context: ApiContext,
  workspaceId: string,
  projectId: string,
  userId: string,
  role: ProjectRole,
) {
  return apiRequest<ProjectMember>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/projects/${projectId}/members`,
    {
      method: 'POST',
      token: context.token,
      body: JSON.stringify({ user_id: userId, role }),
    },
  );
}

export function updateProjectMember(
  context: ApiContext,
  workspaceId: string,
  projectId: string,
  userId: string,
  role: ProjectRole,
) {
  return apiRequest<ProjectMember>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/projects/${projectId}/members/${userId}`,
    {
      method: 'PATCH',
      token: context.token,
      body: JSON.stringify({ role }),
    },
  );
}

export function removeProjectMember(
  context: ApiContext,
  workspaceId: string,
  projectId: string,
  userId: string,
) {
  return apiRequest<void>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/projects/${projectId}/members/${userId}`,
    { method: 'DELETE', token: context.token },
  );
}

export function listProjectCycles(
  context: ApiContext,
  workspaceId: string,
  projectId: string,
) {
  return apiRequest<ProjectCycle[]>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/projects/${projectId}/cycles`,
    { token: context.token },
  );
}

export function createProjectCycle(
  context: ApiContext,
  workspaceId: string,
  projectId: string,
  cycle: ProjectCyclePatch & {
    name: string;
    start_date: string;
    due_date: string;
  },
) {
  return apiRequest<ProjectCycle>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/projects/${projectId}/cycles`,
    { method: 'POST', token: context.token, body: JSON.stringify(cycle) },
  );
}

export function updateProjectCycle(
  context: ApiContext,
  workspaceId: string,
  projectId: string,
  cycleId: string,
  patch: ProjectCyclePatch,
) {
  return apiRequest<ProjectCycle>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/projects/${projectId}/cycles/${cycleId}`,
    { method: 'PATCH', token: context.token, body: JSON.stringify(patch) },
  );
}

export function completeProjectCycle(
  context: ApiContext,
  workspaceId: string,
  projectId: string,
  cycleId: string,
  transferCycleId: string | null,
) {
  return apiRequest<ProjectCycle>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/projects/${projectId}/cycles/${cycleId}/complete`,
    {
      method: 'POST',
      token: context.token,
      body: JSON.stringify({ transfer_cycle_id: transferCycleId }),
    },
  );
}

export function archiveProjectCycle(
  context: ApiContext,
  workspaceId: string,
  projectId: string,
  cycleId: string,
) {
  return apiRequest<void>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/projects/${projectId}/cycles/${cycleId}`,
    { method: 'DELETE', token: context.token },
  );
}

export function listProjectModules(
  context: ApiContext,
  workspaceId: string,
  projectId: string,
) {
  return apiRequest<ProjectModule[]>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/projects/${projectId}/modules`,
    { token: context.token },
  );
}

export function createProjectModule(
  context: ApiContext,
  workspaceId: string,
  projectId: string,
  module: ProjectModulePatch & { name: string },
) {
  return apiRequest<ProjectModule>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/projects/${projectId}/modules`,
    { method: 'POST', token: context.token, body: JSON.stringify(module) },
  );
}

export function updateProjectModule(
  context: ApiContext,
  workspaceId: string,
  projectId: string,
  moduleId: string,
  patch: ProjectModulePatch,
) {
  return apiRequest<ProjectModule>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/projects/${projectId}/modules/${moduleId}`,
    { method: 'PATCH', token: context.token, body: JSON.stringify(patch) },
  );
}

export function archiveProjectModule(
  context: ApiContext,
  workspaceId: string,
  projectId: string,
  moduleId: string,
) {
  return apiRequest<void>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/projects/${projectId}/modules/${moduleId}`,
    { method: 'DELETE', token: context.token },
  );
}

export function listPlanningTasks(
  context: ApiContext,
  workspaceId: string,
  filter: { cycleId: string } | { moduleId: string },
) {
  const parameters = new URLSearchParams(
    'cycleId' in filter
      ? { cycle_id: filter.cycleId }
      : { module_id: filter.moduleId },
  );
  return apiRequest<Task[]>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/tasks?${parameters.toString()}`,
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
  assigneeIds?: string[],
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
        assignee_ids: assigneeIds,
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

export function deleteTask(
  context: ApiContext,
  workspaceId: string,
  taskId: string,
  reference: string,
) {
  return apiRequest<void>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/tasks/${taskId}/delete`,
    {
      method: 'POST',
      token: context.token,
      body: JSON.stringify({ reference }),
    },
  );
}

export function bulkUpdateTasks(
  context: ApiContext,
  workspaceId: string,
  patch: TaskBulkPatch,
) {
  return apiRequest<Task[]>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/tasks/bulk`,
    {
      method: 'PATCH',
      token: context.token,
      body: JSON.stringify(patch),
    },
  );
}

export function reorderTasks(
  context: ApiContext,
  workspaceId: string,
  taskIds: string[],
) {
  return apiRequest<void>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/tasks/reorder`,
    {
      method: 'PUT',
      token: context.token,
      body: JSON.stringify({ task_ids: taskIds }),
    },
  );
}

export function addTaskRelation(
  context: ApiContext,
  workspaceId: string,
  taskId: string,
  relatedTaskId: string,
  relationType: TaskRelationType,
) {
  return apiRequest<Task>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/tasks/${taskId}/relations`,
    {
      method: 'POST',
      token: context.token,
      body: JSON.stringify({
        task_id: relatedTaskId,
        relation_type: relationType,
      }),
    },
  );
}

export function removeTaskRelation(
  context: ApiContext,
  workspaceId: string,
  taskId: string,
  relatedTaskId: string,
) {
  return apiRequest<void>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/tasks/${taskId}/relations/${relatedTaskId}`,
    { method: 'DELETE', token: context.token },
  );
}
