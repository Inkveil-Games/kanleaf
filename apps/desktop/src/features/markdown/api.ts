import { apiRequest } from '../../lib/api/client';

interface DocumentContext {
  serverUrl: string;
  token: string;
  workspaceId: string;
  taskId: string;
}

export function readTaskDocument(context: DocumentContext) {
  return apiRequest<{ content: string }>(
    context.serverUrl,
    `/api/workspaces/${context.workspaceId}/tasks/${context.taskId}/document`,
    { token: context.token },
  );
}

export function writeTaskDocument(context: DocumentContext, content: string) {
  return apiRequest<void>(
    context.serverUrl,
    `/api/workspaces/${context.workspaceId}/tasks/${context.taskId}/document`,
    {
      method: 'PUT',
      token: context.token,
      body: JSON.stringify({ content }),
    },
  );
}
