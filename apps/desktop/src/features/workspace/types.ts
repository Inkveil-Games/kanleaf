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
  identifier: string;
  description: string;
  lead_user_id: string | null;
  visibility: ProjectVisibility;
  default_assignee_id: string | null;
  default_state_id: string;
  default_task_type_id: string;
  cycles_enabled: boolean;
  modules_enabled: boolean;
  pages_enabled: boolean;
  views_enabled: boolean;
  enabled_task_type_ids: string[];
  effective_role: ProjectRole | null;
  can_join: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ProjectVisibility = 'private' | 'open';
export type ProjectRole = 'admin' | 'contributor' | 'commenter' | 'viewer';

export interface ProjectMember {
  user_id: string;
  email: string;
  display_name: string;
  role: ProjectRole;
  implicit: boolean;
  joined_at: string;
  updated_at: string;
}

export interface ProjectPatch {
  name?: string;
  identifier?: string;
  description?: string;
  lead_user_id?: string | null;
  visibility?: ProjectVisibility;
  default_assignee_id?: string | null;
  default_state_id?: string;
  default_task_type_id?: string;
  enabled_task_type_ids?: string[];
  cycles_enabled?: boolean;
  modules_enabled?: boolean;
  pages_enabled?: boolean;
  views_enabled?: boolean;
}

export interface ProjectCycle {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  description: string;
  start_date: string;
  due_date: string;
  status: 'upcoming' | 'active' | 'completed';
  total_tasks: number;
  completed_tasks: number;
  total_estimate: number;
  completed_estimate: number;
  completed_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectCyclePatch {
  name?: string;
  description?: string;
  start_date?: string;
  due_date?: string;
}

export type ProjectModuleStatus =
  'backlog' | 'planned' | 'in_progress' | 'paused' | 'completed' | 'canceled';

export interface ProjectModule {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  description: string;
  lead_user_id: string | null;
  status: ProjectModuleStatus;
  start_date: string | null;
  due_date: string | null;
  total_tasks: number;
  completed_tasks: number;
  total_estimate: number;
  completed_estimate: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectModulePatch {
  name?: string;
  description?: string;
  lead_user_id?: string | null;
  status?: ProjectModuleStatus;
  start_date?: string | null;
  due_date?: string | null;
}

export type TaskStateGroup =
  'backlog' | 'todo' | 'in_progress' | 'done' | 'canceled';
export type TaskPriority = 'none' | 'low' | 'medium' | 'high' | 'urgent';

export interface TaskState {
  id: string;
  workspace_id: string;
  name: string;
  color: string;
  state_group: TaskStateGroup;
  position: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskLabel {
  id: string;
  workspace_id: string;
  name: string;
  color: string;
  description: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskType {
  id: string;
  workspace_id: string;
  name: string;
  icon: string;
  color: string;
  description: string;
  position: number;
  is_protected: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskConfiguration {
  states: TaskState[];
  labels: TaskLabel[];
  task_types: TaskType[];
  default_state_id: string;
  default_task_type_id: string;
}

export interface Task {
  id: string;
  workspace_id: string;
  project_id: string | null;
  task_number: number;
  reference: string;
  title: string;
  state: Pick<TaskState, 'id' | 'name' | 'color' | 'state_group'>;
  task_type: Pick<TaskType, 'id' | 'name' | 'icon' | 'color'>;
  priority: TaskPriority;
  start_date: string | null;
  due_date: string | null;
  estimate: number | null;
  position: number;
  parent: TaskLink | null;
  assignees: TaskAssignee[];
  labels: Pick<TaskLabel, 'id' | 'name' | 'color'>[];
  cycle: TaskPlanningLink | null;
  modules: TaskPlanningLink[];
  subtasks: TaskLink[];
  relations: TaskRelation[];
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskPlanningLink {
  id: string;
  name: string;
}

export interface TaskAssignee {
  user_id: string;
  email: string;
  display_name: string;
}

export interface TaskLink {
  id: string;
  reference: string;
  title: string;
}

export type TaskRelationType =
  'blocking' | 'blocked_by' | 'relates_to' | 'duplicate';

export interface TaskRelation {
  task: TaskLink;
  relation_type: TaskRelationType;
}

export type Collection =
  | { kind: 'all' }
  | { kind: 'my-work' }
  | { kind: 'inbox' }
  | { kind: 'project'; projectId: string };

export interface TaskPatch {
  title?: string;
  state_id?: string;
  task_type_id?: string;
  priority?: TaskPriority;
  project_id?: string | null;
  start_date?: string | null;
  due_date?: string | null;
  estimate?: number | null;
  parent_id?: string | null;
  assignee_ids?: string[];
  label_ids?: string[];
  cycle_id?: string | null;
  module_ids?: string[];
  cleanup_invalid?: boolean;
}

export interface TaskBulkPatch {
  task_ids: string[];
  state_id?: string;
  priority?: TaskPriority;
  project_id?: string | null;
  cleanup_invalid?: boolean;
}
