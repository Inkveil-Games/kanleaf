import { apiRequest } from '../../lib/api/client';

interface DocumentContext {
  serverUrl: string;
  token: string;
  workspaceId: string;
  taskId: string;
}

export interface MarkdownContent {
  content: string;
  revision: string;
}

export function readTaskDocument(context: DocumentContext) {
  return apiRequest<MarkdownContent>(
    context.serverUrl,
    `/api/workspaces/${context.workspaceId}/tasks/${context.taskId}/document`,
    { token: context.token },
  );
}

export function writeTaskDocument(
  context: DocumentContext,
  content: string,
  baseRevision: string,
) {
  return apiRequest<MarkdownContent>(
    context.serverUrl,
    `/api/workspaces/${context.workspaceId}/tasks/${context.taskId}/document`,
    {
      method: 'PUT',
      token: context.token,
      body: JSON.stringify({ content, base_revision: baseRevision }),
    },
  );
}
