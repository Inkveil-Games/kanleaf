import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Task } from '../workspace/types';
import { TaskListPane } from './TaskListPane';

const tasks: Task[] = [
  {
    id: 'task-1',
    workspace_id: 'workspace-1',
    project_id: null,
    title: 'Design the navigation',
    status: 'todo',
    priority: 'high',
    archived_at: null,
    created_at: '2026-08-26T10:00:00Z',
    updated_at: '2026-08-26T10:00:00Z',
  },
  {
    id: 'task-2',
    workspace_id: 'workspace-1',
    project_id: null,
    title: 'Write contributor notes',
    status: 'in_progress',
    priority: 'none',
    archived_at: null,
    created_at: '2026-08-26T09:00:00Z',
    updated_at: '2026-08-26T09:00:00Z',
  },
];

function renderList(
  overrides: Partial<ComponentProps<typeof TaskListPane>> = {},
) {
  const props: ComponentProps<typeof TaskListPane> = {
    collection: { kind: 'inbox' },
    projects: [],
    tasks,
    selectedTaskId: null,
    query: '',
    loading: false,
    error: null,
    onQueryChange: vi.fn(),
    onSelectTask: vi.fn(),
    onCreateTask: vi.fn().mockResolvedValue(undefined),
    onUpdateStatus: vi.fn().mockResolvedValue(undefined),
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

  it('cycles status and supports keyboard row navigation', async () => {
    const props = renderList();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Mark Design the navigation in progress',
      }),
    );
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' });

    await waitFor(() =>
      expect(props.onUpdateStatus).toHaveBeenCalledWith(
        tasks[0],
        'in_progress',
      ),
    );
    expect(props.onSelectTask).toHaveBeenCalledWith('task-1');
  });
});
