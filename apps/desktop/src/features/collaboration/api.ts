import { apiRequest } from '../../lib/api/client';
import type { ApiContext } from '../workspace/api';
import type {
  CollaborationUser,
  CommentRevision,
  Notification,
  NotificationPreferences,
  TaskComment,
  TaskFeed,
} from './types';

function taskPath(workspaceId: string, taskId: string) {
  return `/api/workspaces/${workspaceId}/tasks/${taskId}`;
}

export function getTaskFeed(
  context: ApiContext,
  workspaceId: string,
  taskId: string,
) {
  return apiRequest<TaskFeed>(
    context.serverUrl,
    `${taskPath(workspaceId, taskId)}/activity`,
    { token: context.token },
  );
}

export function createComment(
  context: ApiContext,
  workspaceId: string,
  taskId: string,
  body: string,
  parentId: string | null,
  mentionIds: string[],
) {
  return apiRequest<TaskComment>(
    context.serverUrl,
    `${taskPath(workspaceId, taskId)}/comments`,
    {
      method: 'POST',
      token: context.token,
      body: JSON.stringify({
        body,
        parent_id: parentId,
        mention_ids: mentionIds,
      }),
    },
  );
}

export function editComment(
  context: ApiContext,
  workspaceId: string,
  taskId: string,
  commentId: string,
  body: string,
  mentionIds: string[],
) {
  return apiRequest<TaskComment>(
    context.serverUrl,
    `${taskPath(workspaceId, taskId)}/comments/${commentId}`,
    {
      method: 'PATCH',
      token: context.token,
      body: JSON.stringify({ body, mention_ids: mentionIds }),
    },
  );
}

export function deleteComment(
  context: ApiContext,
  workspaceId: string,
  taskId: string,
  commentId: string,
) {
  return apiRequest<void>(
    context.serverUrl,
    `${taskPath(workspaceId, taskId)}/comments/${commentId}`,
    { method: 'DELETE', token: context.token },
  );
}

export function listCommentRevisions(
  context: ApiContext,
  workspaceId: string,
  taskId: string,
  commentId: string,
) {
  return apiRequest<CommentRevision[]>(
    context.serverUrl,
    `${taskPath(workspaceId, taskId)}/comments/${commentId}/revisions`,
    { token: context.token },
  );
}

export function listMentionCandidates(
  context: ApiContext,
  workspaceId: string,
  taskId: string,
) {
  return apiRequest<CollaborationUser[]>(
    context.serverUrl,
    `${taskPath(workspaceId, taskId)}/mention-candidates`,
    { token: context.token },
  );
}

export function watchTask(
  context: ApiContext,
  workspaceId: string,
  taskId: string,
) {
  return apiRequest<void>(
    context.serverUrl,
    `${taskPath(workspaceId, taskId)}/subscription`,
    { method: 'POST', token: context.token },
  );
}

export function unwatchTask(
  context: ApiContext,
  workspaceId: string,
  taskId: string,
) {
  return apiRequest<void>(
    context.serverUrl,
    `${taskPath(workspaceId, taskId)}/subscription`,
    { method: 'DELETE', token: context.token },
  );
}

export function listNotifications(context: ApiContext, unread = false) {
  return apiRequest<Notification[]>(
    context.serverUrl,
    `/api/notifications${unread ? '?unread=true' : ''}`,
    { token: context.token },
  );
}

export function markNotificationRead(
  context: ApiContext,
  notificationId: string,
) {
  return apiRequest<void>(
    context.serverUrl,
    `/api/notifications/${notificationId}/read`,
    { method: 'PATCH', token: context.token },
  );
}

export function markAllNotificationsRead(context: ApiContext) {
  return apiRequest<void>(context.serverUrl, '/api/notifications/read-all', {
    method: 'POST',
    token: context.token,
  });
}

export function getNotificationPreferences(context: ApiContext) {
  return apiRequest<NotificationPreferences>(
    context.serverUrl,
    '/api/account/notification-preferences',
    { token: context.token },
  );
}

export function updateNotificationPreferences(
  context: ApiContext,
  preferences: NotificationPreferences,
) {
  return apiRequest<NotificationPreferences>(
    context.serverUrl,
    '/api/account/notification-preferences',
    {
      method: 'PATCH',
      token: context.token,
      body: JSON.stringify(preferences),
    },
  );
}
