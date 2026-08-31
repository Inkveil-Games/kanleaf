import { apiRequest } from '../../lib/api/client';
import type { ApiContext } from '../workspace/api';

export interface HostWorkspaceOwner {
  id: string;
  display_name: string;
  email: string;
}

export interface HostWorkspace {
  id: string;
  name: string;
  created_at: string;
  owner: HostWorkspaceOwner;
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
