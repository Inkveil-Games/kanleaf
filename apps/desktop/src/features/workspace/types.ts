export interface Workspace {
  id: string;
  name: string;
  accent: WorkspaceAccent;
  role: WorkspaceRole;
  created_at: string;
  updated_at: string;
}

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'guest';
export type AssignableWorkspaceRole = Exclude<WorkspaceRole, 'owner'>;
export type WorkspaceAccent =
  'sage' | 'blue' | 'amber' | 'rose' | 'violet' | 'slate';

export interface WorkspaceMember {
  user_id: string;
  email: string;
  display_name: string;
  role: WorkspaceRole;
  joined_at: string;
  updated_at: string;
}

export type InvitationStatus =
  'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';

export interface WorkspaceInvitation {
  id: string;
  workspace_id: string;
  workspace_name: string;
  email: string;
  role: AssignableWorkspaceRole;
  invited_by_display_name: string | null;
  status: InvitationStatus;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface IssuedWorkspaceInvitation extends WorkspaceInvitation {
  token: string;
}

export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type TaskPriority = 'none' | 'low' | 'medium' | 'high';

export interface Task {
  id: string;
  workspace_id: string;
  project_id: string | null;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export type Collection =
  { kind: 'all' } | { kind: 'inbox' } | { kind: 'project'; projectId: string };

export interface TaskPatch {
  title?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  project_id?: string | null;
}
