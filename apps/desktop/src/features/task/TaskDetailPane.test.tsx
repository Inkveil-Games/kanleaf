import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Project, Task, TaskState, TaskType } from '../workspace/types';
import { TaskDetailPane } from './TaskDetailPane';

vi.mock('../markdown/MarkdownDocument', () => ({
  MarkdownDocument: () => <div>Markdown editor</div>,
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
    state_group: 'todo',
  },
  task_type: {
    id: 'type-task',
    name: 'Task',
    icon: 'check-square',
    color: '#64748B',
  },
  priority: 'none',
  start_date: null,
  due_date: null,
  estimate: null,
  position: 1024,
  parent: null,
  assignees: [],
  labels: [],
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

const taskTypes: TaskType[] = [
  taskType('type-task', 'Task', true, 0),
  taskType('type-bug', 'Bug', false, 1),
];

const projects: Project[] = [
  {
    id: 'project-1',
    workspace_id: 'workspace-1',
    name: 'Kanleaf',
    identifier: 'KAN',
    description: '',
    lead_user_id: null,
    visibility: 'private',
    default_assignee_id: null,
    default_state_id: 'state-todo',
    default_task_type_id: 'type-task',
    cycles_enabled: false,
    modules_enabled: false,
    pages_enabled: false,
    views_enabled: false,
    enabled_task_type_ids: ['type-task', 'type-bug'],
    effective_role: 'admin',
    can_join: false,
    archived_at: null,
    created_at: '2026-08-26T10:00:00Z',
    updated_at: '2026-08-26T10:00:00Z',
  },
];

describe('TaskDetailPane', () => {
  it('edits structured task fields directly in the detail pane', async () => {
    const patch = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <TaskDetailPane
        serverUrl="https://kanleaf.example.com"
        token="session-token"
        workspaceId="workspace-1"
        task={task}
        projects={projects}
        states={states}
        taskTypes={taskTypes}
        labels={[]}
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

    fireEvent.change(screen.getByLabelText('State'), {
      target: { value: 'state-progress' },
    });
    fireEvent.change(screen.getByLabelText('Task type'), {
      target: { value: 'type-bug' },
    });
    fireEvent.change(screen.getByLabelText('Priority'), {
      target: { value: 'high' },
    });
    fireEvent.change(screen.getByLabelText('Due date'), {
      target: { value: '2026-09-04' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit assignees' }));
    fireEvent.click(
      screen.getByRole('menuitemcheckbox', { name: 'Alex Morgan' }),
    );
    fireEvent.change(screen.getByLabelText('Project'), {
      target: { value: 'project-1' },
    });
    const title = screen.getByLabelText('Task title');
    fireEvent.change(title, { target: { value: 'Document the architecture' } });
    fireEvent.blur(title);

    await waitFor(() => {
      expect(patch).toHaveBeenCalledWith({ state_id: 'state-progress' });
      expect(patch).toHaveBeenCalledWith({ task_type_id: 'type-bug' });
      expect(patch).toHaveBeenCalledWith({ priority: 'high' });
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
  });

  it('renders Project Viewer task metadata without edit actions', () => {
    render(
      <TaskDetailPane
        serverUrl="https://kanleaf.example.com"
        token="session-token"
        workspaceId="workspace-1"
        task={{ ...task, project_id: 'project-1' }}
        projects={projects}
        states={states}
        taskTypes={taskTypes}
        labels={[]}
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
    expect(screen.getByLabelText('State')).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Task actions' }),
    ).not.toBeInTheDocument();
  });
});

function taskState(
  id: string,
  name: string,
  state_group: TaskState['state_group'],
  position: number,
): TaskState {
  return {
    id,
    workspace_id: 'workspace-1',
    name,
    color: state_group === 'todo' ? '#64748B' : '#3B82F6',
    state_group,
    position,
    archived_at: null,
    created_at: '2026-08-26T10:00:00Z',
    updated_at: '2026-08-26T10:00:00Z',
  };
}

function taskType(
  id: string,
  name: string,
  is_protected: boolean,
  position: number,
): TaskType {
  return {
    id,
    workspace_id: 'workspace-1',
    name,
    icon: name === 'Task' ? 'check-square' : 'bug',
    color: name === 'Task' ? '#64748B' : '#DC2626',
    description: '',
    position,
    is_protected,
    archived_at: null,
    created_at: '2026-08-26T10:00:00Z',
    updated_at: '2026-08-26T10:00:00Z',
  };
}
