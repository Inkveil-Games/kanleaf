import type {
  Collection,
  TaskPriority,
  TaskStateGroup,
} from '../workspace/types';

export const taskLayouts = [
  'list',
  'board',
  'calendar',
  'table',
  'timeline',
] as const;

export type TaskLayout = (typeof taskLayouts)[number];
export type SavedViewVisibility = 'personal' | 'shared';

export type TaskQueryScope =
  | { kind: 'workspace' }
  | { kind: 'inbox' }
  | { kind: 'my_work' }
  | { kind: 'project'; project_id: string }
  | { kind: 'cycle'; cycle_id: string }
  | { kind: 'module'; module_id: string };

export interface IdFilter {
  values: string[];
  include_none: boolean;
}

export interface DateFilter {
  from: string | null;
  to: string | null;
  include_none: boolean;
}

export interface EstimateFilter {
  minimum: number | null;
  maximum: number | null;
  include_none: boolean;
}

export type TaskGroupField =
  | 'state'
  | 'state_group'
  | 'priority'
  | 'task_type'
  | 'assignee'
  | 'label'
  | 'project'
  | 'cycle'
  | 'module'
  | 'due_date';

export type TaskSortField =
  | 'manual'
  | 'title'
  | 'priority'
  | 'start_date'
  | 'due_date'
  | 'estimate'
  | 'created_at'
  | 'updated_at';

export type TaskDisplayProperty =
  | 'state'
  | 'priority'
  | 'task_type'
  | 'assignees'
  | 'labels'
  | 'project'
  | 'cycle'
  | 'modules'
  | 'start_date'
  | 'due_date'
  | 'estimate'
  | 'updated_at';

export interface TaskQuery {
  version: 1;
  scope: TaskQueryScope;
  search: string | null;
  filters: {
    states: IdFilter;
    state_groups: TaskStateGroup[];
    task_types: IdFilter;
    priorities: TaskPriority[];
    assignees: IdFilter;
    labels: IdFilter;
    projects: IdFilter;
    cycles: IdFilter;
    modules: IdFilter;
    start_date: DateFilter;
    due_date: DateFilter;
    estimate: EstimateFilter;
  };
  grouping: {
    primary: TaskGroupField | null;
    secondary: TaskGroupField | null;
  };
  sort: { field: TaskSortField; direction: 'ascending' | 'descending' }[];
  display: TaskDisplayProperty[];
  include_completed: boolean;
}

export interface SavedView {
  id: string;
  workspace_id: string;
  project_id: string | null;
  owner_id: string;
  name: string;
  visibility: SavedViewVisibility;
  query_version: number;
  query: TaskQuery;
  layout: TaskLayout;
  created_at: string;
  updated_at: string;
}

export function createTaskQuery(collection: Collection): TaskQuery {
  return {
    version: 1,
    scope: scopeFromCollection(collection),
    search: null,
    filters: {
      states: emptyIdFilter(),
      state_groups: [],
      task_types: emptyIdFilter(),
      priorities: [],
      assignees: emptyIdFilter(),
      labels: emptyIdFilter(),
      projects: emptyIdFilter(),
      cycles: emptyIdFilter(),
      modules: emptyIdFilter(),
      start_date: emptyDateFilter(),
      due_date: emptyDateFilter(),
      estimate: {
        minimum: null,
        maximum: null,
        include_none: false,
      },
    },
    grouping: { primary: null, secondary: null },
    sort: [],
    display: [
      'state',
      'priority',
      'assignees',
      'labels',
      'due_date',
      'updated_at',
    ],
    include_completed: true,
  };
}

export function collectionFromScope(scope: TaskQueryScope): Collection {
  switch (scope.kind) {
    case 'inbox':
      return { kind: 'inbox' };
    case 'my_work':
      return { kind: 'my-work' };
    case 'project':
      return { kind: 'project', projectId: scope.project_id };
    default:
      return { kind: 'all' };
  }
}

export function scopeProjectId(scope: TaskQueryScope) {
  return scope.kind === 'project' ? scope.project_id : null;
}

function scopeFromCollection(collection: Collection): TaskQueryScope {
  switch (collection.kind) {
    case 'inbox':
      return { kind: 'inbox' };
    case 'my-work':
      return { kind: 'my_work' };
    case 'project':
      return { kind: 'project', project_id: collection.projectId };
    case 'all':
      return { kind: 'workspace' };
  }
}

function emptyIdFilter(): IdFilter {
  return { values: [], include_none: false };
}

function emptyDateFilter(): DateFilter {
  return { from: null, to: null, include_none: false };
}
