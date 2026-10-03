import type { Task, TaskState } from '../workspace/types';

export function graphTask(
  id: string,
  patch: Partial<Task> = {},
  role: TaskState['system_role'] = 'todo',
): Task {
  return {
    id,
    workspace_id: 'workspace',
    project_id: null,
    task_number: 1,
    reference: `#${id}`,
    title: id,
    state: {
      id: role,
      name: 'Custom workflow name',
      color: '#74806c',
      system_role: role,
    },
    priority: 'high',
    start_date: null,
    due_date: null,
    estimate: null,
    position: 0,
    parent: null,
    assignees: [],
    labels: [],
    cycle: null,
    modules: [],
    subtasks: [],
    subtask_progress: { completed: 0, total: 0 },
    relations: [],
    comment_count: 0,
    archived_at: null,
    created_at: '2026-10-03T00:00:00Z',
    updated_at: '2026-10-03T00:00:00Z',
    ...patch,
  };
}
