import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { chooseSelectOption } from '../../test/select';
import type { Task, TaskState } from '../workspace/types';
import { createTaskQuery } from '../view/types';
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
    labels: [],
    taskTypes: [],
    cycles: [],
    modules: [],
    members: [],
    tasks,
    selectedTaskId: null,
    query: createTaskQuery({ kind: 'inbox' }),
    layout: 'list',
    activeView: null,
    loading: false,
    error: null,
    canCreate: true,
    canShareView: true,
    canManageActiveView: false,
    canChangeActiveViewVisibility: false,
    canEditTask: () => true,
    onQueryChange: vi.fn(),
    onLayoutChange: vi.fn(),
    onSelectTask: vi.fn(),
    onCreateTask: vi.fn().mockResolvedValue(undefined),
    onUpdateState: vi.fn().mockResolvedValue(undefined),
    onPatchTask: vi.fn().mockResolvedValue(undefined),
    onBulkUpdate: vi.fn().mockResolvedValue(undefined),
    onCreateView: vi.fn().mockResolvedValue(undefined),
    onUpdateView: vi.fn().mockResolvedValue(undefined),
    onSaveViewConfiguration: vi.fn().mockResolvedValue(undefined),
    onDuplicateView: vi.fn().mockResolvedValue(undefined),
    onDeleteView: vi.fn().mockResolvedValue(undefined),
    onViewActionError: vi.fn(),
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

  it('supports compact task shortcuts without taking Ctrl K from global search', () => {
    const props = renderList();

    fireEvent.keyDown(window, { key: '/' });
    expect(screen.getByLabelText('Search tasks')).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'j' });
    expect(props.onSelectTask).toHaveBeenCalledWith('task-1');
  });

  it('lets an open menu consume Escape before clearing the task detail', async () => {
    const onClearSelection = vi.fn();
    renderList({ selectedTaskId: 'task-1', onClearSelection });

    fireEvent.click(
      screen.getByRole('button', { name: 'Visible task fields' }),
    );
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument(),
    );
    expect(onClearSelection).not.toHaveBeenCalled();
  });

  it('keeps read-only collections navigable without mutation controls', () => {
    renderList({ canCreate: false, canEditTask: () => false });

    expect(
      screen.queryByRole('button', { name: 'New task' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'Move Design the navigation to In Progress',
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Design the navigation/ }),
    ).toBeInTheDocument();
  });

  it('applies one bulk mutation to the checked task rows', async () => {
    const props = renderList();

    fireEvent.click(screen.getByLabelText('Select Design the navigation'));
    fireEvent.click(screen.getByLabelText('Select Write contributor notes'));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    await chooseSelectOption('Set priority', 'Urgent');

    await waitFor(() =>
      expect(props.onBulkUpdate).toHaveBeenCalledWith({
        task_ids: ['task-1', 'task-2'],
        priority: 'urgent',
      }),
    );
  });

  it('recovers after a bulk mutation fails', async () => {
    renderList({
      onBulkUpdate: vi.fn().mockRejectedValue(new Error('Server unavailable')),
    });

    fireEvent.click(screen.getByLabelText('Select Design the navigation'));
    await chooseSelectOption('Set priority', 'Urgent');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Server unavailable',
    );
    expect(screen.getByLabelText('Set priority')).toBeEnabled();
  });

  it('builds a typed filter query from the toolbar', () => {
    const props = renderList();

    fireEvent.click(screen.getByRole('button', { name: 'Filter tasks' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Urgent' }));

    expect(props.onQueryChange).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({ priorities: ['urgent'] }),
      }),
    );
  });

  it('adds date and unassigned estimate filters without a second query model', () => {
    const props = renderList();

    fireEvent.click(
      screen.getByRole('button', { name: 'Date and estimate filters' }),
    );
    const dialog = screen.getByRole('dialog', {
      name: 'Date and estimate filters',
    });
    const dueDate = within(dialog).getByRole('group', { name: 'Due date' });
    fireEvent.change(within(dueDate).getByLabelText('From'), {
      target: { value: '2026-09-01' },
    });

    expect(props.onQueryChange).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({
          due_date: {
            from: '2026-09-01',
            to: null,
            include_none: false,
          },
        }),
      }),
    );
  });

  it('saves the current query and layout as a shared View', async () => {
    const props = renderList({ layout: 'board' });

    fireEvent.click(screen.getByRole('button', { name: 'Save View' }));
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Delivery board' },
    });
    fireEvent.click(screen.getByRole('radio', { name: /Shared/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create View' }));

    await waitFor(() =>
      expect(props.onCreateView).toHaveBeenCalledWith(
        'Delivery board',
        'shared',
      ),
    );
  });

  it.each([
    ['board', 'Board grouped by state_group'],
    ['calendar', 'Task due dates'],
    ['table', 'Task'],
    ['timeline', 'Unscheduled'],
  ] as const)('renders the %s layout', (layout, expectedName) => {
    renderList({ layout });

    if (layout === 'board') {
      expect(screen.getByLabelText(expectedName)).toBeInTheDocument();
    } else if (layout === 'calendar') {
      expect(
        screen.getByRole('grid', { name: expectedName }),
      ).toBeInTheDocument();
    } else if (layout === 'table') {
      expect(
        screen.getByRole('columnheader', { name: expectedName }),
      ).toBeInTheDocument();
    } else {
      expect(screen.getByText(expectedName)).toBeInTheDocument();
    }
  });

  it('supports inline edits in the table layout', async () => {
    const props = renderList({ layout: 'table' });

    await chooseSelectOption('Design the navigation state', 'In Progress');

    await waitFor(() =>
      expect(props.onPatchTask).toHaveBeenCalledWith('task-1', {
        state_id: 'state-progress',
      }),
    );
  });

  it('moves a Board task to the default state in another semantic group', async () => {
    const props = renderList({ layout: 'board' });
    const transfer = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: 'none',
      setData: (type: string, value: string) => transfer.set(type, value),
      getData: (type: string) => transfer.get(type) ?? '',
    };

    fireEvent.dragStart(
      screen.getByRole('button', { name: /Design the navigation/ }),
      {
        dataTransfer,
      },
    );
    fireEvent.drop(
      screen.getByRole('heading', { name: 'Done' }).closest('section')!,
      {
        dataTransfer,
      },
    );

    await waitFor(() =>
      expect(props.onPatchTask).toHaveBeenCalledWith('task-1', {
        state_id: 'state-done',
      }),
    );
  });

  it('renders primary grouping in the dense List layout', () => {
    const query = createTaskQuery({ kind: 'inbox' });
    query.grouping.primary = 'state_group';

    renderList({ query });

    expect(screen.getByRole('group', { name: 'Todo' })).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'In Progress' }),
    ).toBeInTheDocument();
  });

  it('resizes a scheduled task from the Timeline keyboard control', async () => {
    const scheduled = {
      ...tasks[0],
      start_date: '2026-09-01',
      due_date: '2026-09-03',
    };
    const props = renderList({ layout: 'timeline', tasks: [scheduled] });

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Resize Design the navigation end',
      }),
    );

    await waitFor(() =>
      expect(props.onPatchTask).toHaveBeenCalledWith('task-1', {
        due_date: '2026-09-04',
      }),
    );
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
    task_number: Number(id.slice(-1)),
    reference: `#${id.slice(-1)}`,
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
    start_date: null,
    due_date: null,
    estimate: null,
    position: Number(id.slice(-1)) * 1024,
    parent: null,
    assignees: [],
    labels: [],
    cycle: null,
    modules: [],
    subtasks: [],
    relations: [],
    archived_at: null,
    created_at: '2026-08-26T10:00:00Z',
    updated_at: '2026-08-26T10:00:00Z',
  };
}
