import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { chooseSelectOption } from '../../test/select';
import type {
  Project,
  ProjectCycle,
  ProjectModule,
  Task,
  TaskState,
} from '../workspace/types';
import { TaskDetailPane } from './TaskDetailPane';

vi.mock('../markdown/MarkdownDocument', () => ({
  MarkdownDocument: () => (
    <section aria-label="Markdown document">
      <div>Editor shell header</div>
      <div>Markdown editor</div>
    </section>
  ),
}));

vi.mock('../collaboration/TaskActivity', () => ({
  TaskActivity: () => <div>Task activity feed</div>,
}));

const task: Task = {
  id: 'task-1',
  workspace_id: 'workspace-1',
  project_id: null,
  task_number: 1,
  reference: '#1',
  title: 'Draft the architecture',
  state: {
    id: 'state-todo',
    name: 'Todo',
    color: '#64748B',
    system_role: 'todo',
  },
  priority: 'none',
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
  created_at: '2026-08-26T10:00:00Z',
  updated_at: '2026-08-26T10:00:00Z',
};

const states: TaskState[] = [
  taskState('state-todo', 'Todo', 'todo', 0),
  taskState('state-progress', 'In Review', 'in_progress', 1),
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
    default_state_id: 'state-todo',
    cycles_enabled: false,
    modules_enabled: false,
    pages_enabled: false,
    views_enabled: false,
    effective_role: 'admin',
    can_join: false,
    archived_at: null,
    created_at: '2026-08-26T10:00:00Z',
    updated_at: '2026-08-26T10:00:00Z',
  },
];

const cycles: ProjectCycle[] = [
  {
    id: 'cycle-1',
    workspace_id: 'workspace-1',
    project_id: 'project-1',
    name: 'Cycle 1',
    description: '',
    start_date: '2026-09-01',
    due_date: '2026-09-14',
    status: 'active',
    total_tasks: 0,
    completed_tasks: 0,
    total_estimate: 0,
    completed_estimate: 0,
    completed_at: null,
    archived_at: null,
    created_at: '2026-08-26T10:00:00Z',
    updated_at: '2026-08-26T10:00:00Z',
  },
];

const modules: ProjectModule[] = [
  {
    id: 'module-1',
    workspace_id: 'workspace-1',
    project_id: 'project-1',
    name: 'Backend',
    description: '',
    lead_user_id: null,
    status: 'in_progress',
    start_date: null,
    due_date: null,
    total_tasks: 0,
    completed_tasks: 0,
    total_estimate: 0,
    completed_estimate: 0,
    archived_at: null,
    created_at: '2026-08-26T10:00:00Z',
    updated_at: '2026-08-26T10:00:00Z',
  },
];

describe('TaskDetailPane', () => {
  it('uses a compact inspector close control', () => {
    const props = {
      serverUrl: 'https://kanleaf.example.com',
      token: 'session-token',
      workspaceId: 'workspace-1',
      projects,
      states,
      labels: [],
      cycles: [],
      modules: [],
      assigneeCandidates: [],
      taskCandidates: [task],
      loading: false,
      error: null,
      canEdit: true,
      onPatch: vi.fn(),
      onArchive: vi.fn(),
      onDelete: vi.fn(),
      onAddRelation: vi.fn(),
      onRemoveRelation: vi.fn(),
      onOpenTask: vi.fn(),
      onClose: vi.fn(),
      onRetry: vi.fn(),
    };
    const { rerender } = render(<TaskDetailPane {...props} task={task} />);
    const drawer = screen.getByRole('region', { name: 'Task detail' });

    expect(screen.getByRole('button', { name: 'Close task' })).toBeVisible();
    expect(screen.queryByText('Back')).not.toBeInTheDocument();

    rerender(
      <TaskDetailPane
        {...props}
        task={{ ...task, id: 'task-2', title: 'Second task' }}
      />,
    );
    expect(screen.getByRole('region', { name: 'Task detail' })).toBe(drawer);
  });

  it('shows a local loading state when the selected Task is unresolved', () => {
    const onClose = vi.fn();
    render(
      <TaskDetailPane
        serverUrl="https://kanleaf.example.com"
        token="session-token"
        workspaceId="workspace-1"
        task={null}
        projects={projects}
        states={states}
        labels={[]}
        cycles={[]}
        modules={[]}
        assigneeCandidates={[]}
        taskCandidates={[]}
        loading
        error={null}
        canEdit={false}
        onPatch={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
        onAddRelation={vi.fn()}
        onRemoveRelation={vi.fn()}
        onOpenTask={vi.fn()}
        onClose={onClose}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole('region', { name: 'Task detail' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading task…');
    expect(screen.queryByLabelText('Task title')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close task' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps the drawer present for a selected Task error', () => {
    const onRetry = vi.fn();
    const onClose = vi.fn();
    render(
      <TaskDetailPane
        serverUrl="https://kanleaf.example.com"
        token="session-token"
        workspaceId="workspace-1"
        task={null}
        projects={projects}
        states={states}
        labels={[]}
        cycles={[]}
        modules={[]}
        assigneeCandidates={[]}
        taskCandidates={[]}
        loading={false}
        error="Task detail failed"
        canEdit={false}
        onPatch={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
        onAddRelation={vi.fn()}
        onRemoveRelation={vi.fn()}
        onOpenTask={vi.fn()}
        onClose={onClose}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole('region', { name: 'Task detail' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Task detail failed');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Close task' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('uses the shared typed confirmation dialog for permanent deletion', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const nativeConfirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <TaskDetailPane
        serverUrl="https://kanleaf.example.com"
        token="session-token"
        workspaceId="workspace-1"
        task={task}
        projects={projects}
        states={states}
        labels={[]}
        cycles={[]}
        modules={[]}
        assigneeCandidates={[]}
        taskCandidates={[task]}
        loading={false}
        error={null}
        canEdit
        onPatch={vi.fn()}
        onArchive={vi.fn()}
        onDelete={onDelete}
        onAddRelation={vi.fn()}
        onRemoveRelation={vi.fn()}
        onOpenTask={vi.fn()}
        onClose={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Task actions' }));
    await user.click(
      await screen.findByRole('menuitem', { name: 'Delete permanently' }),
    );

    const dialog = screen.getByRole('alertdialog', {
      name: 'Delete Draft the architecture permanently?',
    });
    expect(nativeConfirm).not.toHaveBeenCalled();
    const deleteButton = screen.getByRole('button', { name: 'Delete Task' });
    expect(deleteButton).toBeDisabled();

    await user.type(screen.getByLabelText(/Type #1 to confirm/), '#1');
    await user.click(deleteButton);

    await waitFor(() => expect(onDelete).toHaveBeenCalledOnce());
    expect(onDelete).toHaveBeenCalledWith('#1');
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    nativeConfirm.mockRestore();
  });

  it('preserves undefined Markdown fields as raw values and offers Define', async () => {
    const onDefineProperty = vi.fn();
    render(
      <TaskDetailPane
        serverUrl="https://kanleaf.example.com"
        token="session-token"
        workspaceId="workspace-1"
        task={task}
        customProperties={[]}
        undefinedProperties={[
          {
            name: 'External context',
            value: { source: 'Obsidian', score: 9 },
          },
        ]}
        projects={projects}
        states={states}
        labels={[]}
        cycles={[]}
        modules={[]}
        assigneeCandidates={[]}
        taskCandidates={[task]}
        loading={false}
        error={null}
        canEdit
        canManageProperties
        onPatch={vi.fn()}
        onDefineProperty={onDefineProperty}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
        onAddRelation={vi.fn()}
        onRemoveRelation={vi.fn()}
        onOpenTask={vi.fn()}
        onClose={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    const properties = screen.getByRole('region', { name: 'Task properties' });
    expect(
      await within(properties).findByText('Undefined'),
    ).toBeInTheDocument();
    expect(
      within(properties).getByText('{"source":"Obsidian","score":9}'),
    ).toBeInTheDocument();
    fireEvent.click(
      within(properties).getByRole('button', {
        name: 'Define External context',
      }),
    );
    expect(onDefineProperty).toHaveBeenCalledWith('External context');
  });

  it('does not offer property definition to a non-admin Task editor', async () => {
    render(
      <TaskDetailPane
        serverUrl="https://kanleaf.example.com"
        token="session-token"
        workspaceId="workspace-1"
        task={task}
        customProperties={[]}
        undefinedProperties={[{ name: 'External context', value: 'Raw' }]}
        projects={projects}
        states={states}
        labels={[]}
        cycles={[]}
        modules={[]}
        assigneeCandidates={[]}
        taskCandidates={[task]}
        loading={false}
        error={null}
        canEdit
        onPatch={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
        onAddRelation={vi.fn()}
        onRemoveRelation={vi.fn()}
        onOpenTask={vi.fn()}
        onClose={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(await screen.findByText('Undefined')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Define External context' }),
    ).not.toBeInTheDocument();
  });

  it('edits defined custom properties and keeps archived values visible', async () => {
    const onCustomPropertyChange = vi.fn().mockResolvedValue(undefined);
    const properties = [
      {
        id: 'type-property',
        workspace_id: 'workspace-1',
        name: 'Type',
        type: 'single_select' as const,
        description: 'Migrated Task type',
        position: 0,
        configuration: {},
        default_option_id: 'feature-option',
        options: [
          {
            id: 'feature-option',
            workspace_id: 'workspace-1',
            property_id: 'type-property',
            name: 'Feature',
            color: '#3B82F6',
            description: 'Product work',
            position: 0,
            archived_at: null,
            created_at: '2026-09-03T01:00:00Z',
            updated_at: '2026-09-03T01:00:00Z',
          },
        ],
        usage_count: 1,
        archived_at: null,
        created_at: '2026-09-03T01:00:00Z',
        updated_at: '2026-09-03T01:00:00Z',
      },
      {
        id: 'impact-property',
        workspace_id: 'workspace-1',
        name: 'Impact',
        type: 'single_select' as const,
        description: 'Expected customer impact',
        position: 0,
        configuration: {},
        default_option_id: null,
        options: [
          {
            id: 'high-option',
            workspace_id: 'workspace-1',
            property_id: 'impact-property',
            name: 'High',
            color: '#EF4444',
            description: '',
            position: 0,
            archived_at: null,
            created_at: '2026-09-03T01:00:00Z',
            updated_at: '2026-09-03T01:00:00Z',
          },
        ],
        usage_count: 0,
        archived_at: null,
        created_at: '2026-09-03T01:00:00Z',
        updated_at: '2026-09-03T01:00:00Z',
      },
      {
        id: 'legacy-property',
        workspace_id: 'workspace-1',
        name: 'Legacy note',
        type: 'text' as const,
        description: '',
        position: 1,
        configuration: {},
        default_option_id: null,
        options: [],
        usage_count: 1,
        archived_at: '2026-09-03T02:00:00Z',
        created_at: '2026-09-03T01:00:00Z',
        updated_at: '2026-09-03T02:00:00Z',
      },
      {
        id: 'approved-property',
        workspace_id: 'workspace-1',
        name: 'Approved',
        type: 'checkbox' as const,
        description: '',
        position: 2,
        configuration: {},
        default_option_id: null,
        options: [],
        usage_count: 0,
        archived_at: null,
        created_at: '2026-09-03T01:00:00Z',
        updated_at: '2026-09-03T01:00:00Z',
      },
    ];
    render(
      <TaskDetailPane
        serverUrl="https://kanleaf.example.com"
        token="session-token"
        workspaceId="workspace-1"
        task={{
          ...task,
          custom_properties: [
            { property_id: 'type-property', value: 'feature-option' },
            { property_id: 'legacy-property', value: 'Keep this' },
          ],
        }}
        customProperties={properties}
        projects={projects}
        states={states}
        labels={[]}
        cycles={[]}
        modules={[]}
        assigneeCandidates={[]}
        taskCandidates={[task]}
        loading={false}
        error={null}
        canEdit
        onPatch={vi.fn()}
        onCustomPropertyChange={onCustomPropertyChange}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
        onAddRelation={vi.fn()}
        onRemoveRelation={vi.fn()}
        onOpenTask={vi.fn()}
        onClose={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    const propertySection = screen.getByRole('region', {
      name: 'Task properties',
    });
    expect(within(propertySection).getByText('Keep this')).toBeInTheDocument();
    expect(within(propertySection).getByLabelText('Type')).toHaveTextContent(
      'Feature',
    );
    expect(within(propertySection).getByText('Archived')).toBeInTheDocument();
    expect(
      within(propertySection).queryByText('Workspace properties'),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add property' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Add Impact property' }),
    );
    await chooseSelectOption('Impact', 'High');

    await waitFor(() =>
      expect(onCustomPropertyChange).toHaveBeenCalledWith(
        'impact-property',
        'high-option',
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add property' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Add Approved property' }),
    );
    await waitFor(() =>
      expect(onCustomPropertyChange).toHaveBeenCalledWith(
        'approved-property',
        false,
      ),
    );
  });

  it('restores a scalar custom-property draft when saving fails', async () => {
    const onCustomPropertyChange = vi
      .fn()
      .mockRejectedValue(new Error('Property update failed'));
    const note = {
      id: 'note-property',
      workspace_id: 'workspace-1',
      name: 'Release note',
      type: 'text' as const,
      description: '',
      position: 0,
      configuration: {},
      default_option_id: null,
      options: [],
      usage_count: 1,
      archived_at: null,
      created_at: '2026-09-03T01:00:00Z',
      updated_at: '2026-09-03T01:00:00Z',
    };
    render(
      <TaskDetailPane
        serverUrl="https://kanleaf.example.com"
        token="session-token"
        workspaceId="workspace-1"
        task={{
          ...task,
          custom_properties: [
            { property_id: 'note-property', value: 'Original' },
          ],
        }}
        customProperties={[note]}
        projects={projects}
        states={states}
        labels={[]}
        cycles={[]}
        modules={[]}
        assigneeCandidates={[]}
        taskCandidates={[task]}
        loading={false}
        error={null}
        canEdit
        onPatch={vi.fn()}
        onCustomPropertyChange={onCustomPropertyChange}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
        onAddRelation={vi.fn()}
        onRemoveRelation={vi.fn()}
        onOpenTask={vi.fn()}
        onClose={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    const input = screen.getByRole('textbox', { name: 'Release note' });
    fireEvent.change(input, { target: { value: 'Unsaved' } });
    fireEvent.blur(input);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Property update failed',
    );
    expect(input).toHaveValue('Original');
  });

  it('edits structured task fields directly in the detail pane', async () => {
    const patch = vi.fn().mockResolvedValue(undefined);
    render(
      <TaskDetailPane
        serverUrl="https://kanleaf.example.com"
        token="session-token"
        workspaceId="workspace-1"
        task={task}
        projects={projects}
        states={states}
        labels={[]}
        cycles={[]}
        modules={[]}
        assigneeCandidates={[
          {
            user_id: 'user-1',
            email: 'alex@example.com',
            display_name: 'Alex Morgan',
          },
        ]}
        taskCandidates={[task]}
        loading={false}
        error={null}
        canEdit
        onPatch={patch}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
        onAddRelation={vi.fn()}
        onRemoveRelation={vi.fn()}
        onOpenTask={vi.fn()}
        onClose={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    const editor = screen.getByText('Markdown editor');
    await screen.findByRole('combobox', { name: 'State' });
    await chooseSelectOption('State', 'In Review');
    await chooseSelectOption('Priority', 'High');
    fireEvent.change(screen.getByLabelText('Start date'), {
      target: { value: '2026-09-01' },
    });
    fireEvent.change(screen.getByLabelText('Due date'), {
      target: { value: '2026-09-04' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit assignees' }));
    fireEvent.click(
      screen.getByRole('menuitemcheckbox', { name: 'Alex Morgan' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add property' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Add Project property' }),
    );
    await chooseSelectOption('Project', 'Kanleaf');
    fireEvent.click(screen.getByRole('button', { name: 'Move Task' }));
    const title = screen.getByLabelText('Task title');
    let titleHeight = 72;
    Object.defineProperty(title, 'scrollHeight', {
      configurable: true,
      get: () => titleHeight,
    });
    fireEvent.change(title, {
      target: { value: 'Document the architecture across a wrapped line' },
    });
    expect(title).toHaveStyle({ height: '72px' });
    titleHeight = 38;
    fireEvent.change(title, { target: { value: 'Document the architecture' } });
    expect(title).toHaveStyle({ height: '38px' });
    fireEvent.blur(title);

    await waitFor(() => {
      expect(patch).toHaveBeenCalledWith({ state_id: 'state-progress' });
      expect(patch).toHaveBeenCalledWith({ priority: 'high' });
      expect(patch).toHaveBeenCalledWith({ start_date: '2026-09-01' });
      expect(patch).toHaveBeenCalledWith({ due_date: '2026-09-04' });
      expect(patch).toHaveBeenCalledWith({ assignee_ids: ['user-1'] });
      expect(patch).toHaveBeenCalledWith({
        project_id: 'project-1',
        cleanup_invalid: true,
      });
      expect(patch).toHaveBeenCalledWith({
        title: 'Document the architecture',
      });
    });

    expect(screen.getByText('Markdown editor')).toBe(editor);
    const activity = screen.getByText('Task activity feed');
    expect(
      screen.queryByRole('tab', { name: 'Details' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('tab', { name: 'Activity' }),
    ).not.toBeInTheDocument();
    expect(editor).toAppearBefore(activity);
    const subtasks = screen.getByText('Subtasks').closest('details');
    expect(subtasks).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('Subtasks'));
    expect(subtasks).toHaveAttribute('open');
  });

  it('renders Project Viewer task metadata without edit actions', () => {
    render(
      <TaskDetailPane
        serverUrl="https://kanleaf.example.com"
        token="session-token"
        workspaceId="workspace-1"
        task={{ ...task, project_id: 'project-1' }}
        projects={[{ ...projects[0], effective_role: 'viewer' }]}
        states={states}
        labels={[]}
        cycles={[]}
        modules={[]}
        assigneeCandidates={[]}
        taskCandidates={[task]}
        loading={false}
        error={null}
        canEdit={false}
        onPatch={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
        onAddRelation={vi.fn()}
        onRemoveRelation={vi.fn()}
        onOpenTask={vi.fn()}
        onClose={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Task title')).toHaveAttribute('readonly');
    expect(screen.queryByLabelText('State')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Priority')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Start date')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Due date')).not.toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Pinned task properties' }),
    ).toHaveTextContent('TodoNo priorityUnassignedStart dateDue date');
    expect(
      screen.getByRole('region', { name: 'Task properties' }),
    ).toHaveTextContent('ProjectKanleaf');
    expect(
      screen.queryByRole('button', { name: 'Task actions' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add property' }),
    ).not.toBeInTheDocument();
  });

  it('orders pinned properties before Markdown and keeps remaining properties below it', async () => {
    render(
      <TaskDetailPane
        serverUrl="https://kanleaf.example.com"
        token="session-token"
        workspaceId="workspace-1"
        task={task}
        projects={projects}
        states={states}
        labels={[]}
        cycles={[]}
        modules={[]}
        assigneeCandidates={[]}
        taskCandidates={[task]}
        loading={false}
        error={null}
        canEdit
        onPatch={vi.fn().mockResolvedValue(undefined)}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
        onAddRelation={vi.fn()}
        onRemoveRelation={vi.fn()}
        onOpenTask={vi.fn()}
        onClose={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    const title = screen.getByLabelText('Task title');
    const pinned = screen.getByRole('region', {
      name: 'Pinned task properties',
    });
    const markdown = screen.getByRole('region', { name: 'Markdown document' });
    const properties = screen.getByRole('region', { name: 'Task properties' });
    const structure = screen.getByRole('region', { name: 'Task structure' });
    const activity = screen.getByText('Task activity feed');

    expect(
      [...pinned.querySelectorAll<HTMLElement>('[data-task-property]')].map(
        (property) => property.dataset.taskProperty,
      ),
    ).toEqual(['state', 'priority', 'assignees', 'start-date', 'due-date']);
    expect(
      within(properties).queryByLabelText('Project'),
    ).not.toBeInTheDocument();
    expect(
      within(properties).queryByLabelText('Start date'),
    ).not.toBeInTheDocument();
    expect(title).toAppearBefore(pinned);
    expect(pinned).toAppearBefore(markdown);
    expect(markdown).toAppearBefore(properties);
    expect(properties).toAppearBefore(structure);
    expect(structure).toAppearBefore(activity);

    fireEvent.click(
      within(properties).getByRole('button', { name: 'Add property' }),
    );
    expect(
      screen.queryByRole('button', { name: 'Add Start date property' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add State property' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add Priority property' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add Assignees property' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add Due date property' }),
    ).not.toBeInTheDocument();
    const search = screen.getByLabelText('Search properties');
    fireEvent.change(search, { target: { value: 'label' } });
    expect(
      screen.getByRole('button', { name: 'Add Labels property' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add Project property' }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Add Labels property' }),
    );
    expect(
      within(properties).getByRole('button', { name: 'Edit labels' }),
    ).toBeVisible();

    const labelsControl = within(properties).getByRole('button', {
      name: 'Edit labels',
    });
    await waitFor(() => expect(labelsControl).toHaveFocus());
    screen.getByLabelText('Task title').focus();
    await waitFor(() =>
      expect(
        within(properties).queryByRole('button', { name: 'Edit labels' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('assigns a Project Task to a Cycle and multiple Modules', async () => {
    const patch = vi.fn().mockResolvedValue(undefined);
    render(
      <TaskDetailPane
        serverUrl="https://kanleaf.example.com"
        token="session-token"
        workspaceId="workspace-1"
        task={{ ...task, project_id: 'project-1' }}
        projects={[
          { ...projects[0], cycles_enabled: true, modules_enabled: true },
        ]}
        states={states}
        labels={[]}
        cycles={cycles}
        modules={modules}
        assigneeCandidates={[]}
        taskCandidates={[task]}
        loading={false}
        error={null}
        canEdit
        onPatch={patch}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
        onAddRelation={vi.fn()}
        onRemoveRelation={vi.fn()}
        onOpenTask={vi.fn()}
        onClose={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add property' }));
    expect(
      screen.queryByRole('button', { name: 'Add Project property' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add Type property' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add Cycle property' }));
    await chooseSelectOption('Cycle', 'Cycle 1');
    fireEvent.click(screen.getByRole('button', { name: 'Add property' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Add Modules property' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit Modules' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Backend' }));

    await waitFor(() => {
      expect(patch).toHaveBeenCalledWith({ cycle_id: 'cycle-1' });
      expect(patch).toHaveBeenCalledWith({ module_ids: ['module-1'] });
    });
  });

  it('keeps an added property visible when its update fails', async () => {
    const patch = vi.fn().mockRejectedValue(new Error('Task update failed'));
    render(
      <TaskDetailPane
        serverUrl="https://kanleaf.example.com"
        token="session-token"
        workspaceId="workspace-1"
        task={task}
        projects={projects}
        states={states}
        labels={[]}
        cycles={[]}
        modules={[]}
        assigneeCandidates={[]}
        taskCandidates={[task]}
        loading={false}
        error={null}
        canEdit
        onPatch={patch}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
        onAddRelation={vi.fn()}
        onRemoveRelation={vi.fn()}
        onOpenTask={vi.fn()}
        onClose={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add property' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Add Estimate property' }),
    );
    fireEvent.change(screen.getByLabelText('Estimate'), {
      target: { value: '3' },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Task update failed',
    );
    expect(screen.getByLabelText('Estimate')).toBeVisible();
  });
});

function taskState(
  id: string,
  name: string,
  systemRole: TaskState['system_role'],
  position: number,
): TaskState {
  return {
    id,
    workspace_id: 'workspace-1',
    name,
    color: systemRole === 'todo' ? '#64748B' : '#3B82F6',
    description: '',
    system_role: systemRole,
    position,
    archived_at: null,
    created_at: '2026-08-26T10:00:00Z',
    updated_at: '2026-08-26T10:00:00Z',
  };
}
