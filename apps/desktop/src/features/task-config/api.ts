import { apiRequest } from '../../lib/api/client';
import type { ApiContext } from '../workspace/api';
import type { TaskConfiguration, TaskLabel } from '../workspace/types';

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
    Pick<TaskLabel, 'name' | 'color' | 'description'> & {
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
