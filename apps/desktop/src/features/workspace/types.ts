export interface Workspace {
  id: string;
  name: string;
  role: 'owner' | 'member';
  created_at: string;
  updated_at: string;
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
