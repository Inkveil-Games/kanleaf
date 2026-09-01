import { apiRequest } from '../../lib/api/client';
import type { ApiContext } from '../workspace/api';

export interface HostWorkspaceOwner {
  id: string;
  display_name: string;
  email: string;
}

export interface HostWorkspace {
  id: string;
  identifier: string;
  name: string;
  created_at: string;
  owner: HostWorkspaceOwner;
}

export interface DeleteHostWorkspaceRequest {
  identifier: string;
  password: string;
}

export interface HostAccessPolicy {
  restricted: boolean;
  allowed_emails: string[];
}

export function listHostWorkspaces(context: ApiContext) {
  return apiRequest<HostWorkspace[]>(
    context.serverUrl,
    '/api/host/workspaces',
    { token: context.token },
  );
}

export function deleteHostWorkspace(
  context: ApiContext,
  workspaceId: string,
  request: DeleteHostWorkspaceRequest,
) {
  return apiRequest<void>(
    context.serverUrl,
    `/api/host/workspaces/${workspaceId}`,
    {
      method: 'DELETE',
      token: context.token,
      body: JSON.stringify(request),
    },
  );
}

export function getHostAccess(context: ApiContext) {
  return apiRequest<HostAccessPolicy>(context.serverUrl, '/api/host/access', {
    token: context.token,
  });
}

export function updateHostAccess(
  context: ApiContext,
  policy: HostAccessPolicy,
) {
  return apiRequest<HostAccessPolicy>(context.serverUrl, '/api/host/access', {
    method: 'PUT',
    token: context.token,
    body: JSON.stringify(policy),
  });
}
