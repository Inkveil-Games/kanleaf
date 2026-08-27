import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Task, TaskState } from '../workspace/types';
import { TaskListPane } from './TaskListPane';

const tasks: Task[] = [
  task('task-1', 'Design the navigation', 'state-todo', 'Todo', 'todo', 'high'),
  task(
    'task-2',
    'Write contributor notes',
    'state-progress',
    'In Progress',
    'in_progress',
    'none',
  ),
];

const states: TaskState[] = [
  state('state-todo', 'Todo', 'todo', 0, '#64748B'),
  state('state-progress', 'In Progress', 'in_progress', 1, '#3B82F6'),
  state('state-done', 'Done', 'done', 2, '#22A06B'),
];

function renderList(
  overrides: Partial<ComponentProps<typeof TaskListPane>> = {},
) {
  const props: ComponentProps<typeof TaskListPane> = {
    collection: { kind: 'inbox' },
    projects: [],
    states,
    tasks,
    selectedTaskId: null,
    query: '',
    loading: false,
    error: null,
    onQueryChange: vi.fn(),
    onSelectTask: vi.fn(),
    onCreateTask: vi.fn().mockResolvedValue(undefined),
    onUpdateState: vi.fn().mockResolvedValue(undefined),
    onRetry: vi.fn(),
    onClearSelection: vi.fn(),
    ...overrides,
  };
  render(<TaskListPane {...props} />);
  return props;
}

describe('TaskListPane', () => {
  it('creates a task from the compact collection workflow', async () => {
    const props = renderList();

    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    fireEvent.change(screen.getByLabelText('Task title'), {
      target: { value: 'Ship the desktop shell' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(props.onCreateTask).toHaveBeenCalledWith('Ship the desktop shell'),
    );
    expect(screen.queryByLabelText('Task title')).not.toBeInTheDocument();
  });

  it('moves to the next semantic state and supports keyboard row navigation', async () => {
    const props = renderList();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Move Design the navigation to In Progress',
      }),
    );
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' });

    await waitFor(() =>
      expect(props.onUpdateState).toHaveBeenCalledWith(
        tasks[0],
        'state-progress',
      ),
    );
    expect(props.onSelectTask).toHaveBeenCalledWith('task-1');
  });
});

function state(
  id: string,
  name: string,
  state_group: TaskState['state_group'],
  position: number,
  color: string,
): TaskState {
  return {
    id,
    workspace_id: 'workspace-1',
    name,
    color,
    state_group,
    position,
    archived_at: null,
    created_at: '2026-08-26T08:00:00Z',
    updated_at: '2026-08-26T08:00:00Z',
  };
}

function task(
  id: string,
  title: string,
  stateId: string,
  stateName: string,
  stateGroup: Task['state']['state_group'],
  priority: Task['priority'],
): Task {
  return {
    id,
    workspace_id: 'workspace-1',
    project_id: null,
    title,
    state: {
      id: stateId,
      name: stateName,
      color: stateId === 'state-todo' ? '#64748B' : '#3B82F6',
      state_group: stateGroup,
    },
    task_type: {
      id: 'type-task',
      name: 'Task',
      icon: 'check-square',
      color: '#64748B',
    },
    priority,
    archived_at: null,
    created_at: '2026-08-26T10:00:00Z',
    updated_at: '2026-08-26T10:00:00Z',
  };
}
