import { apiRequest } from '../../lib/api/client';

interface DocumentContext {
  serverUrl: string;
  token: string;
  workspaceId: string;
  target: MarkdownTarget;
}

export interface MarkdownTarget {
  kind: 'task' | 'page';
  id: string;
}

export interface MarkdownContent {
  content: string;
  revision: string;
  projection?: {
    status: 'saved' | 'pending' | 'error';
    metadata_version: number;
    projected_metadata_version: number;
    message: string | null;
  };
}

export function readMarkdownDocument(context: DocumentContext) {
  return apiRequest<MarkdownContent>(context.serverUrl, documentPath(context), {
    token: context.token,
  });
}

export function writeMarkdownDocument(
  context: DocumentContext,
  content: string,
  baseRevision: string,
) {
  return apiRequest<MarkdownContent>(context.serverUrl, documentPath(context), {
    method: 'PUT',
    token: context.token,
    body: JSON.stringify({ content, base_revision: baseRevision }),
  });
}

function documentPath(context: DocumentContext) {
  return context.target.kind === 'task'
    ? `/api/workspaces/${context.workspaceId}/tasks/${context.target.id}/document`
    : `/api/workspaces/${context.workspaceId}/documents/${context.target.id}/content`;
}
