import { apiRequest } from '../../lib/api/client';
import type { ApiContext } from '../workspace/api';

export interface QuickLink {
  id: string;
  kind: 'page' | 'project' | 'external';
  title: string;
  url: string | null;
  project_id: string | null;
  project_identifier: string | null;
  document_id: string | null;
  document_number: number | null;
  position: number;
  available: boolean;
}
export type QuickLinkInput =
  | { kind: 'page'; document_id: string }
  | { kind: 'project'; project_id: string }
  | { kind: 'external'; title: string; url: string };

export function listQuickLinks(context: ApiContext, workspaceId: string) {
  return apiRequest<QuickLink[]>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/quick-links`,
    { token: context.token },
  );
}
export function createQuickLink(
  context: ApiContext,
  workspaceId: string,
  input: QuickLinkInput,
) {
  return apiRequest<QuickLink>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/quick-links`,
    { token: context.token, method: 'POST', body: JSON.stringify(input) },
  );
}
export function updateQuickLink(
  context: ApiContext,
  workspaceId: string,
  id: string,
  input: QuickLinkInput,
) {
  return apiRequest<QuickLink>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/quick-links/${id}`,
    { token: context.token, method: 'PUT', body: JSON.stringify(input) },
  );
}
export function deleteQuickLink(
  context: ApiContext,
  workspaceId: string,
  id: string,
) {
  return apiRequest<void>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/quick-links/${id}`,
    { token: context.token, method: 'DELETE' },
  );
}
export function reorderQuickLinks(
  context: ApiContext,
  workspaceId: string,
  ids: string[],
) {
  return apiRequest<QuickLink[]>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/quick-links/order`,
    { token: context.token, method: 'PUT', body: JSON.stringify({ ids }) },
  );
}
