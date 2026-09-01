import { apiRequest } from '../../lib/api/client';
import type { ApiContext } from '../workspace/api';
import type { Task } from '../workspace/types';
import type {
  SavedView,
  SavedViewVisibility,
  TaskLayout,
  TaskQuery,
} from './types';

export function queryTasks(
  context: ApiContext,
  workspaceId: string,
  query: TaskQuery,
) {
  return apiRequest<Task[]>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/tasks/query`,
    {
      method: 'POST',
      token: context.token,
      body: JSON.stringify(query),
    },
  );
}

export function listSavedViews(
  context: ApiContext,
  workspaceId: string,
  projectId: string | null,
) {
  const search = projectId
    ? `?${new URLSearchParams({ project_id: projectId }).toString()}`
    : '';
  return apiRequest<SavedView[]>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/views${search}`,
    { token: context.token },
  );
}

export function getSavedView(
  context: ApiContext,
  workspaceId: string,
  viewId: string,
) {
  return apiRequest<SavedView>(
    context.serverUrl,
    `/api/workspaces/${encodeURIComponent(workspaceId)}/views/${encodeURIComponent(viewId)}`,
    { token: context.token },
  );
}

export function createSavedView(
  context: ApiContext,
  workspaceId: string,
  input: {
    name: string;
    visibility: SavedViewVisibility;
    project_id: string | null;
    query: TaskQuery;
    layout: TaskLayout;
  },
) {
  return apiRequest<SavedView>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/views`,
    {
      method: 'POST',
      token: context.token,
      body: JSON.stringify(input),
    },
  );
}

export function updateSavedView(
  context: ApiContext,
  workspaceId: string,
  viewId: string,
  patch: Partial<Pick<SavedView, 'name' | 'visibility' | 'query' | 'layout'>>,
) {
  return apiRequest<SavedView>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/views/${viewId}`,
    {
      method: 'PATCH',
      token: context.token,
      body: JSON.stringify(patch),
    },
  );
}

export function deleteSavedView(
  context: ApiContext,
  workspaceId: string,
  viewId: string,
) {
  return apiRequest<void>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/views/${viewId}`,
    { method: 'DELETE', token: context.token },
  );
}
