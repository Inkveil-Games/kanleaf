import { apiRequest } from '../../lib/api/client';
import type { ApiContext } from '../workspace/api';
import type {
  TaskConfiguration,
  TaskLabel,
  TaskState,
  TaskStateGroup,
  TaskType,
} from '../workspace/types';

export function getTaskConfiguration(context: ApiContext, workspaceId: string) {
  return apiRequest<TaskConfiguration>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/task-configuration`,
    { token: context.token },
  );
}

export function updateTaskDefaults(
  context: ApiContext,
  workspaceId: string,
  patch: { state_id?: string; task_type_id?: string },
) {
  return apiRequest<TaskConfiguration>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/task-configuration`,
    {
      method: 'PATCH',
      token: context.token,
      body: JSON.stringify(patch),
    },
  );
}

export function createTaskState(
  context: ApiContext,
  workspaceId: string,
  input: { name: string; color: string; state_group: TaskStateGroup },
) {
  return apiRequest<TaskState>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/states`,
    { method: 'POST', token: context.token, body: JSON.stringify(input) },
  );
}

export function updateTaskState(
  context: ApiContext,
  workspaceId: string,
  stateId: string,
  patch: Partial<
    Pick<TaskState, 'name' | 'color' | 'state_group'> & { archived: boolean }
  >,
) {
  return apiRequest<TaskState>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/states/${stateId}`,
    { method: 'PATCH', token: context.token, body: JSON.stringify(patch) },
  );
}

export function reorderTaskStates(
  context: ApiContext,
  workspaceId: string,
  ids: string[],
) {
  return apiRequest<void>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/states/reorder`,
    {
      method: 'PUT',
      token: context.token,
      body: JSON.stringify({ ids }),
    },
  );
}

export function deleteTaskState(
  context: ApiContext,
  workspaceId: string,
  stateId: string,
  replacementId?: string,
) {
  const query = replacementId
    ? `?${new URLSearchParams({ replacement_id: replacementId })}`
    : '';
  return apiRequest<void>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/states/${stateId}${query}`,
    { method: 'DELETE', token: context.token },
  );
}

export function createTaskLabel(
  context: ApiContext,
  workspaceId: string,
  input: Pick<TaskLabel, 'name' | 'color' | 'description'>,
) {
  return apiRequest<TaskLabel>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/labels`,
    { method: 'POST', token: context.token, body: JSON.stringify(input) },
  );
}

export function updateTaskLabel(
  context: ApiContext,
  workspaceId: string,
  labelId: string,
  patch: Partial<
    Pick<TaskLabel, 'name' | 'color' | 'description'> & { archived: boolean }
  >,
) {
  return apiRequest<TaskLabel>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/labels/${labelId}`,
    { method: 'PATCH', token: context.token, body: JSON.stringify(patch) },
  );
}

export function deleteTaskLabel(
  context: ApiContext,
  workspaceId: string,
  labelId: string,
) {
  return apiRequest<void>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/labels/${labelId}`,
    { method: 'DELETE', token: context.token },
  );
}

export function createTaskType(
  context: ApiContext,
  workspaceId: string,
  input: Pick<TaskType, 'name' | 'icon' | 'color' | 'description'>,
) {
  return apiRequest<TaskType>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/task-types`,
    { method: 'POST', token: context.token, body: JSON.stringify(input) },
  );
}

export function updateTaskType(
  context: ApiContext,
  workspaceId: string,
  taskTypeId: string,
  patch: Partial<
    Pick<TaskType, 'name' | 'icon' | 'color' | 'description'> & {
      archived: boolean;
    }
  >,
) {
  return apiRequest<TaskType>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/task-types/${taskTypeId}`,
    { method: 'PATCH', token: context.token, body: JSON.stringify(patch) },
  );
}

export function reorderTaskTypes(
  context: ApiContext,
  workspaceId: string,
  ids: string[],
) {
  return apiRequest<void>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/task-types/reorder`,
    {
      method: 'PUT',
      token: context.token,
      body: JSON.stringify({ ids }),
    },
  );
}

export function deleteTaskType(
  context: ApiContext,
  workspaceId: string,
  taskTypeId: string,
  replacementId?: string,
) {
  const query = replacementId
    ? `?${new URLSearchParams({ replacement_id: replacementId })}`
    : '';
  return apiRequest<void>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/task-types/${taskTypeId}${query}`,
    { method: 'DELETE', token: context.token },
  );
}
