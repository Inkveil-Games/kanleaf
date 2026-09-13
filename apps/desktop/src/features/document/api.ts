import { apiRequest } from '../../lib/api/client';
import type { ApiContext } from '../workspace/api';
import type {
  DeleteDocumentsResponse,
  DocumentPatch,
  MoveDocumentResponse,
  WorkspaceDocument,
} from './types';

export function listDocuments(
  context: ApiContext,
  workspaceId: string,
  projectId?: string,
) {
  const scope = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
  return apiRequest<WorkspaceDocument[]>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/documents${scope}`,
    { token: context.token },
  );
}

export function createDocument(
  context: ApiContext,
  workspaceId: string,
  input: {
    title: string;
    project_id: string | null;
    parent_id: string | null;
  },
) {
  return apiRequest<WorkspaceDocument>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/documents`,
    {
      method: 'POST',
      token: context.token,
      body: JSON.stringify(input),
    },
  );
}

export function getDocument(
  context: ApiContext,
  workspaceId: string,
  documentId: string,
) {
  return apiRequest<WorkspaceDocument>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/documents/${documentId}`,
    { token: context.token },
  );
}

export function getDocumentByNumber(
  context: ApiContext,
  workspaceId: string,
  documentNumber: number,
) {
  return apiRequest<WorkspaceDocument>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/documents/by-number/${documentNumber}`,
    { token: context.token },
  );
}

export function updateDocument(
  context: ApiContext,
  workspaceId: string,
  documentId: string,
  patch: DocumentPatch,
) {
  return apiRequest<WorkspaceDocument>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/documents/${documentId}`,
    {
      method: 'PATCH',
      token: context.token,
      body: JSON.stringify(patch),
    },
  );
}

export function moveDocument(
  context: ApiContext,
  workspaceId: string,
  documentId: string,
  input: {
    parent_id: string | null;
    index: number;
  },
) {
  return apiRequest<MoveDocumentResponse>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/documents/${documentId}/move`,
    {
      method: 'PUT',
      token: context.token,
      body: JSON.stringify(input),
    },
  );
}

export function archiveDocument(
  context: ApiContext,
  workspaceId: string,
  documentId: string,
) {
  return apiRequest<void>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/documents/${documentId}`,
    { method: 'DELETE', token: context.token },
  );
}

export function deleteDocument(
  context: ApiContext,
  workspaceId: string,
  documentId: string,
) {
  return apiRequest<DeleteDocumentsResponse>(
    context.serverUrl,
    `/api/workspaces/${workspaceId}/documents/${documentId}/delete`,
    { method: 'POST', token: context.token },
  );
}
