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
import {
  createTaskQuery,
  taskGroupFields,
  type SavedView,
} from '../view/types';
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
  it('uses an accessible collection name without repeating a visible navigation header', () => {
    renderList();

    expect(screen.getByRole('region', { name: 'Inbox' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Inbox' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Collection')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'New task' }),
    ).toBeInTheDocument();
  });

  it('keeps a Saved View accessibly named without a visible Shared View header', () => {
    const query = createTaskQuery({ kind: 'inbox' });
    const activeView: SavedView = {
      id: 'view-1',
      workspace_id: 'workspace-1',
      project_id: null,
      owner_id: 'user-1',
      name: 'Delivery focus',
      visibility: 'shared',
      query_version: 1,
      query,
      layout: 'list',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
    };

    renderList({ query, activeView, canManageActiveView: true });

    expect(
      screen.getByRole('region', { name: 'Delivery focus' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Delivery focus' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Shared View')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Save changes' }),
    ).toHaveTextContent('Save changes');
  });

  it('creates fresh queries with State grouping and the clean Table defaults', () => {
    const query = createTaskQuery({ kind: 'inbox' });

    expect(query.grouping).toEqual({ primary: 'state', secondary: null });
    expect(query.display).toEqual([
      'state',
      'priority',
      'assignees',
      'due_date',
    ]);
  });

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

  it('navigates grouped rows in their rendered order', () => {
    const props = renderList({
      tasks: [tasks[1]!, tasks[0]!],
      selectedTaskId: 'task-1',
    });

    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' });

    expect(props.onSelectTask).toHaveBeenCalledWith('task-2');
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

  it('closes the selected task with Escape outside an editor or transient surface', () => {
    const onClearSelection = vi.fn();
    renderList({ selectedTaskId: 'task-1', onClearSelection });

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClearSelection).toHaveBeenCalledOnce();
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

  it('shows complete icon-and-text toolbar values at normal width', () => {
    renderList();

    expect(screen.getByRole('combobox', { name: 'Layout' })).toHaveTextContent(
      'List',
    );
    expect(
      screen.getByRole('button', { name: 'Filter tasks' }),
    ).toHaveTextContent('Filter');
    expect(
      screen.getByRole('button', { name: 'Date and estimate filters' }),
    ).toHaveTextContent('Date');
    expect(
      screen.getByRole('combobox', { name: 'Group by' }),
    ).toHaveTextContent('State');
    expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveTextContent(
      'Manual',
    );
    expect(
      screen.getByRole('button', { name: 'Visible task fields' }),
    ).toHaveTextContent('Properties');
    expect(screen.getByRole('button', { name: 'Save View' })).toHaveTextContent(
      'Save View',
    );
  });

  it('offers every implemented grouping field and updates the query', async () => {
    const props = renderList();
    const trigger = screen.getByRole('combobox', { name: 'Group by' });

    fireEvent.click(trigger);
    const options = within(selectListbox()).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'No grouping',
      ...taskGroupFields.map(groupFieldLabel),
    ]);
    fireEvent.keyDown(selectListbox(), { key: 'Escape' });

    for (const field of taskGroupFields.filter((field) => field !== 'state')) {
      await chooseSelectOption('Group by', groupFieldLabel(field));
      expect(props.onQueryChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          grouping: { primary: field, secondary: null },
        }),
      );
    }
  });

  it('excludes the primary field from secondary grouping', async () => {
    const props = renderList();

    fireEvent.click(screen.getByRole('combobox', { name: 'Then group by' }));
    expect(
      screen.queryByRole('option', { name: /^State$/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'Priority' }),
    ).toBeInTheDocument();
    fireEvent.keyDown(selectListbox(), { key: 'Escape' });

    await chooseSelectOption('Then group by', 'Priority');
    expect(props.onQueryChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        grouping: { primary: 'state', secondary: 'priority' },
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
    ['board', 'Board grouped by state'],
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

  it('edits Priority, empty Assignees, and Due inline without dirtying the View query', async () => {
    const props = renderList({
      layout: 'table',
      members: [{ user_id: 'user-1', display_name: 'Ada Lovelace' }],
    });

    await chooseSelectOption('Design the navigation priority', 'Urgent');
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Edit Design the navigation assignees',
      }),
    );
    fireEvent.click(
      await screen.findByRole('menuitemcheckbox', { name: 'Ada Lovelace' }),
    );
    fireEvent.change(screen.getByLabelText('Design the navigation due date'), {
      target: { value: '2026-10-03' },
    });

    await waitFor(() => {
      expect(props.onPatchTask).toHaveBeenCalledWith('task-1', {
        priority: 'urgent',
      });
      expect(props.onPatchTask).toHaveBeenCalledWith('task-1', {
        assignee_ids: ['user-1'],
      });
      expect(props.onPatchTask).toHaveBeenCalledWith('task-1', {
        due_date: '2026-10-03',
      });
    });
    expect(props.onQueryChange).not.toHaveBeenCalled();
    expect(props.onSaveViewConfiguration).not.toHaveBeenCalled();
  });

  it('clears an existing Due date inline', async () => {
    const dueTask = { ...tasks[0], due_date: '2026-10-03' };
    const props = renderList({ layout: 'table', tasks: [dueTask] });

    fireEvent.change(screen.getByLabelText('Design the navigation due date'), {
      target: { value: '' },
    });

    await waitFor(() =>
      expect(props.onPatchTask).toHaveBeenCalledWith('task-1', {
        due_date: null,
      }),
    );
  });

  it('uses the requested default Table columns', () => {
    renderList({ layout: 'table' });
    expect(
      screen.getByRole('columnheader', { name: 'Task' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'State' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Priority' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Assignees' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Due' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Labels' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Updated' })).toBeNull();
  });

  it('keeps Labels and Updated available as optional Table columns', () => {
    const query = createTaskQuery({ kind: 'inbox' });
    query.display.push('labels', 'updated_at');
    renderList({ layout: 'table', query });
    expect(
      screen.getByRole('columnheader', { name: 'Labels' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Updated' }),
    ).toBeInTheDocument();
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

  it('renders secondary grouping in the dense List layout', () => {
    const query = createTaskQuery({ kind: 'inbox' });
    query.grouping = { primary: 'state_group', secondary: 'priority' };

    renderList({ query });

    const todo = screen.getByRole('group', { name: 'Todo' });
    expect(
      within(todo).getByRole('heading', { name: 'High, 1 task' }),
    ).toBeInTheDocument();
    const inProgress = screen.getByRole('group', { name: 'In Progress' });
    expect(
      within(inProgress).getByRole('heading', { name: 'None, 1 task' }),
    ).toBeInTheDocument();
  });

  it('renders primary and secondary grouping in Table', () => {
    const query = createTaskQuery({ kind: 'inbox' });
    query.grouping = { primary: 'state_group', secondary: 'priority' };

    renderList({ layout: 'table', query });

    expect(
      screen.getByRole('rowheader', { name: 'Todo, 1 task' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('rowheader', { name: 'High, 1 task' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('rowheader', { name: 'In Progress, 1 task' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('rowheader', { name: 'None, 1 task' }),
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

function groupFieldLabel(field: string) {
  return field
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function selectListbox() {
  return screen
    .getAllByRole('listbox')
    .find((listbox) => listbox.getAttribute('aria-label') !== 'Inbox tasks')!;
}
