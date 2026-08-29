export interface CollaborationUser {
  id: string;
  email: string;
  display_name: string;
}

export interface TaskComment {
  id: string;
  workspace_id: string;
  task_id: string;
  parent_id: string | null;
  body: string | null;
  author: CollaborationUser | null;
  mentions: CollaborationUser[];
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskActivityEvent {
  id: string;
  event_type:
    | 'task_created'
    | 'task_updated'
    | 'task_archived'
    | 'relation_added'
    | 'relation_removed'
    | 'document_updated';
  actor: CollaborationUser | null;
  data: { fields?: string[]; related_task_id?: string };
  created_at: string;
}

export interface TaskFeed {
  comments: TaskComment[];
  activity: TaskActivityEvent[];
  watched: boolean;
}

export interface CommentRevision {
  id: string;
  body: string;
  editor_id: string | null;
  editor_email: string | null;
  editor_display_name: string | null;
  created_at: string;
}

export type NotificationType =
  | 'invitation'
  | 'assignment'
  | 'mention'
  | 'comment'
  | 'reply'
  | 'state_change'
  | 'metadata_change';

export interface Notification {
  id: string;
  notification_type: NotificationType;
  workspace_id: string;
  workspace_name: string;
  task_id: string | null;
  task_reference: string | null;
  task_title: string | null;
  comment_id: string | null;
  invitation_id: string | null;
  actor_id: string | null;
  actor_email: string | null;
  actor_display_name: string | null;
  read_at: string | null;
  created_at: string;
}

export interface NotificationPreferences {
  notify_comments: boolean;
  notify_metadata: boolean;
}
