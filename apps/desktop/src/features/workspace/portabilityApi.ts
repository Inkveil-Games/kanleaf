import { apiDownload, apiRequest } from '../../lib/api/client';
import type { ApiContext } from './api';

export type WorkspaceOperationState =
  'preparing' | 'ready' | 'applying' | 'completed' | 'failed' | 'canceled';

export interface VaultSyncItem {
  task_id: string;
  reference: string;
  title: string;
  path: string | null;
  status:
    | 'valid'
    | 'unchanged'
    | 'invalid'
    | 'conflict'
    | 'missing'
    | 'moved'
    | 'duplicate';
  changes: string[];
  message: string | null;
  source_revision: string | null;
  metadata_version: number;
}

export interface VaultSyncIssue {
  kind: string;
  path: string;
  message: string;
}

export interface VaultSyncOperation {
  id: string;
  workspace_id: string;
  state: WorkspaceOperationState;
  revision: string;
  expires_at: string;
  items: VaultSyncItem[];
  issues: VaultSyncIssue[];
  applied_task_ids: string[];
  error: string | null;
}

export interface WorkspaceExportOperation {
  id: string;
  workspace_id: string;
  state: WorkspaceOperationState;
  revision: string;
  expires_at: string;
  file_name: string;
  file_count: number;
  content_bytes: number;
  archive_bytes: number | null;
  exclusions: { path: string; reason: string }[];
  error: { code: string; message: string } | null;
  download_url: string | null;
}

export interface WorkspaceImportSummary {
  workspace_name: string;
  projects: number;
  tasks: number;
  documents: number;
  states: number;
  types: number;
  labels: number;
  shared_views: number;
  cycles: number;
  modules: number;
  excluded_member_references: number;
  excluded_assignee_references: number;
  history_included: boolean;
}

export interface WorkspaceImportOperation {
  id: string;
  state: WorkspaceOperationState;
  revision: string;
  expires_at: string;
  summary: WorkspaceImportSummary | null;
  workspace_id: string | null;
  error: { code: string; message: string } | null;
}

export function previewVaultSync(context: ApiContext, workspaceId: string) {
  return apiRequest<VaultSyncOperation>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/vault-syncs/preview`,
    { method: 'POST', token: context.token },
  );
}

export function applyVaultSync(
  context: ApiContext,
  workspaceId: string,
  operation: Pick<VaultSyncOperation, 'id' | 'revision'>,
  taskIds: string[],
) {
  return apiRequest<VaultSyncOperation>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/vault-syncs/${operation.id}/apply`,
    {
      method: 'POST',
      token: context.token,
      body: JSON.stringify({ revision: operation.revision, task_ids: taskIds }),
    },
  );
}

export function startWorkspaceExport(context: ApiContext, workspaceId: string) {
  return apiRequest<WorkspaceExportOperation>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/exports`,
    { method: 'POST', token: context.token },
  );
}

export function getWorkspaceExport(context: ApiContext, operationId: string) {
  return apiRequest<WorkspaceExportOperation>(
    context.serverUrl,
    `/api/workspace-exports/${operationId}`,
    { token: context.token },
  );
}

export function downloadWorkspaceExport(
  context: ApiContext,
  operation: Pick<WorkspaceExportOperation, 'download_url'>,
) {
  if (!operation.download_url) {
    throw new Error('Workspace export is not ready');
  }
  return apiDownload(context.serverUrl, operation.download_url, context.token);
}

export function previewWorkspaceImport(context: ApiContext, archive: File) {
  const body = new FormData();
  body.append('archive', archive);
  return apiRequest<WorkspaceImportOperation>(
    context.serverUrl,
    '/api/workspace-imports/preview',
    { method: 'POST', token: context.token, body },
  );
}

export function applyWorkspaceImport(
  context: ApiContext,
  operation: Pick<WorkspaceImportOperation, 'id' | 'revision'>,
) {
  return apiRequest<WorkspaceImportOperation>(
    context.serverUrl,
    `/api/workspace-imports/${operation.id}/apply`,
    {
      method: 'POST',
      token: context.token,
      body: JSON.stringify({ revision: operation.revision }),
    },
  );
}

export function cancelWorkspaceImport(
  context: ApiContext,
  operationId: string,
) {
  return apiRequest<void>(
    context.serverUrl,
    `/api/workspace-imports/${operationId}`,
    { method: 'DELETE', token: context.token },
  );
}
