import { describe, expect, it } from 'vitest';
import type { Project, Task, TaskState } from '../workspace/types';
import { buildTaskGroups, buildTaskGroupTree } from './grouping';
import { taskGroupFields } from './types';

const states: TaskState[] = [
  state('state-a', 'Ready', 0),
  state('state-b', 'Queued', 1),
];

const projects: Project[] = [
  {
    id: 'project-1',
    workspace_id: 'workspace-1',
    name: 'Kanleaf',
    identifier: 'KAN',
    icon: 'folder',
    description: '',
    lead_user_id: null,
    visibility: 'private',
    default_assignee_id: null,
    default_state_id: 'state-a',
    default_task_type_id: 'type-task',
    cycles_enabled: true,
    modules_enabled: true,
    pages_enabled: true,
    views_enabled: true,
    enabled_task_type_ids: ['type-task'],
    effective_role: 'contributor',
    can_join: false,
    archived_at: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  },
];

const tasks: Task[] = [
  task('task-1', states[0]!, {
    project_id: 'project-1',
    priority: 'high',
    due_date: '2026-10-03',
    assignees: [
      { user_id: 'user-1', display_name: 'Ada', email: 'ada@example.com' },
      {
        user_id: 'user-2',
        display_name: 'Grace',
        email: 'grace@example.com',
      },
    ],
    labels: [
      { id: 'label-1', name: 'UI', color: '#123456' },
      { id: 'label-2', name: 'Desktop', color: '#654321' },
    ],
    cycle: { id: 'cycle-1', name: 'Cycle 1' },
    modules: [
      { id: 'module-1', name: 'Tasks' },
      { id: 'module-2', name: 'Views' },
    ],
  }),
  task('task-2', states[1]!, { priority: 'none' }),
];

describe('task grouping', () => {
  it('keeps State and State group as distinct semantics', () => {
    const stateGroups = nonEmpty('state');
    const semanticGroups = nonEmpty('state_group');

    expect(stateGroups.map(({ label }) => label)).toEqual(['Ready', 'Queued']);
    expect(semanticGroups).toHaveLength(1);
    expect(semanticGroups[0]?.label).toBe('Todo');
    expect([...semanticGroups[0]!.taskIds]).toEqual(['task-1', 'task-2']);
  });

  it('keeps tasks visible when their current State has been archived', () => {
    const archivedState = {
      ...state('state-archived', 'Deferred', 2),
      archived_at: '2026-09-20T00:00:00Z',
    };
    const archivedTask = task('task-3', archivedState);

    const groups = buildTaskGroups(
      'state',
      [...tasks, archivedTask],
      projects,
      [...states, archivedState],
    ).filter(({ taskIds }) => taskIds.size > 0);

    expect(groups.find(({ label }) => label === 'Deferred')?.taskIds).toContain(
      'task-3',
    );
  });

  it.each(taskGroupFields)('produces a visible group for %s', (field) => {
    const groups = nonEmpty(field);

    expect(groups.length).toBeGreaterThan(0);
    expect(groups.some(({ taskIds }) => taskIds.size > 0)).toBe(true);
  });

  it('keeps no-value and multi-value membership consistent', () => {
    const assignees = nonEmpty('assignee');
    expect(assignees.find(({ label }) => label === 'Ada')?.taskIds).toContain(
      'task-1',
    );
    expect(assignees.find(({ label }) => label === 'Grace')?.taskIds).toContain(
      'task-1',
    );
    expect(
      assignees.find(({ label }) => label === 'No value')?.taskIds,
    ).toContain('task-2');

    const modules = nonEmpty('module');
    expect(modules.find(({ label }) => label === 'Tasks')?.taskIds).toContain(
      'task-1',
    );
    expect(modules.find(({ label }) => label === 'Views')?.taskIds).toContain(
      'task-1',
    );
    expect(
      modules.find(({ label }) => label === 'No value')?.taskIds,
    ).toContain('task-2');
  });

  it('builds nested secondary groups with accurate counts', () => {
    const tree = buildTaskGroupTree(
      'state_group',
      'priority',
      tasks,
      projects,
      states,
    );

    expect(tree).toHaveLength(1);
    expect(tree[0]?.tasks).toHaveLength(2);
    expect(
      tree[0]?.secondary.map(({ group, tasks: groupedTasks }) => [
        group.label,
        groupedTasks.length,
      ]),
    ).toEqual([
      ['None', 1],
      ['High', 1],
    ]);
  });
});

function nonEmpty(field: (typeof taskGroupFields)[number]) {
  return buildTaskGroups(field, tasks, projects, states).filter(
    ({ taskIds }) => taskIds.size > 0,
  );
}

function state(id: string, name: string, position: number): TaskState {
  return {
    id,
    workspace_id: 'workspace-1',
    name,
    color: '#64748B',
    state_group: 'todo',
    position,
    archived_at: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  };
}

function task(
  id: string,
  taskState: TaskState,
  overrides: Partial<Task> = {},
): Task {
  return {
    id,
    workspace_id: 'workspace-1',
    project_id: null,
    task_number: Number(id.at(-1)),
    reference: `KAN-${id.at(-1)}`,
    title: id,
    state: {
      id: taskState.id,
      name: taskState.name,
      color: taskState.color,
      state_group: taskState.state_group,
    },
    task_type: {
      id: 'type-task',
      name: 'Task',
      icon: 'check-square',
      color: '#64748B',
    },
    priority: 'medium',
    start_date: null,
    due_date: null,
    estimate: null,
    position: 1024,
    parent: null,
    assignees: [],
    labels: [],
    cycle: null,
    modules: [],
    subtasks: [],
    relations: [],
    archived_at: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}
