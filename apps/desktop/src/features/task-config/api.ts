import { apiRequest } from '../../lib/api/client';
import type { ApiContext } from '../workspace/api';
import type {
  TaskConfiguration,
  TaskLabel,
  TaskState,
} from '../workspace/types';

export function getTaskConfiguration(context: ApiContext, workspaceId: string) {
  return apiRequest<TaskConfiguration>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/task-configuration`,
    { token: context.token },
  );
}

export function updateTaskConfiguration(
  context: ApiContext,
  workspaceId: string,
  patch: {
    state_id?: string;
    state_property_description?: string;
    label_property_description?: string;
  },
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
  input: {
    name: string;
    icon: string | null;
    color: string;
    description: string;
  },
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
    Pick<TaskState, 'name' | 'icon' | 'color' | 'description'> & {
      archived: boolean;
    }
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
  input: Pick<TaskLabel, 'name' | 'icon' | 'color' | 'description'>,
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
    Pick<TaskLabel, 'name' | 'icon' | 'color' | 'description'> & {
      archived: boolean;
    }
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

export function reorderTaskLabels(
  context: ApiContext,
  workspaceId: string,
  ids: string[],
) {
  return apiRequest<void>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/labels/reorder`,
    {
      method: 'PUT',
      token: context.token,
      body: JSON.stringify({ ids }),
    },
  );
}
