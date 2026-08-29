import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseSelectOption } from '../../test/select';
import type {
  Project,
  ProjectCycle,
  ProjectMember,
  ProjectModule,
  Task,
} from '../workspace/types';
import {
  archiveProjectModule,
  completeProjectCycle,
  createProjectCycle,
  listPlanningTasks,
  listProjectCycles,
  listProjectModules,
  updateProjectCycle,
  updateProjectModule,
} from '../workspace/api';
import { ProjectPlanningPane, type PlanningKind } from './ProjectPlanningPane';

vi.mock('../workspace/api', async () => {
  const actual = await vi.importActual('../workspace/api');
  return {
    ...actual,
    archiveProjectCycle: vi.fn(),
    archiveProjectModule: vi.fn(),
    completeProjectCycle: vi.fn(),
    createProjectCycle: vi.fn(),
    createProjectModule: vi.fn(),
    listPlanningTasks: vi.fn(),
    listProjectCycles: vi.fn(),
    listProjectModules: vi.fn(),
    updateProjectCycle: vi.fn(),
    updateProjectModule: vi.fn(),
  };
});

const project: Project = {
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
  cycles_enabled: true,
  modules_enabled: true,
  pages_enabled: false,
  views_enabled: false,
  enabled_task_type_ids: ['type-task'],
  effective_role: 'admin',
  can_join: false,
  archived_at: null,
  created_at: '2026-08-28T00:00:00Z',
  updated_at: '2026-08-28T00:00:00Z',
};

const cycle: ProjectCycle = {
  id: 'cycle-1',
  workspace_id: 'workspace-1',
  project_id: 'project-1',
  name: 'Cycle 1',
  description: 'Ship planning',
  start_date: '2026-09-01',
  due_date: '2026-09-14',
  status: 'active',
  total_tasks: 2,
  completed_tasks: 1,
  total_estimate: 8,
  completed_estimate: 3,
  completed_at: null,
  archived_at: null,
  created_at: '2026-08-28T00:00:00Z',
  updated_at: '2026-08-28T00:00:00Z',
};

const projectModule: ProjectModule = {
  id: 'module-1',
  workspace_id: 'workspace-1',
  project_id: 'project-1',
  name: 'Backend',
  description: 'Server work',
  lead_user_id: null,
  status: 'in_progress',
  start_date: null,
  due_date: '2026-09-30',
  total_tasks: 1,
  completed_tasks: 0,
  total_estimate: 5,
  completed_estimate: 0,
  archived_at: null,
  created_at: '2026-08-28T00:00:00Z',
  updated_at: '2026-08-28T00:00:00Z',
};

const task: Task = {
  id: 'task-1',
  workspace_id: 'workspace-1',
  project_id: 'project-1',
  task_number: 1,
  reference: 'KAN-1',
  title: 'Complete planning API',
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
  priority: 'high',
  start_date: null,
  due_date: null,
  estimate: 5,
  position: 1024,
  parent: null,
  assignees: [],
  labels: [],
  cycle: { id: cycle.id, name: cycle.name },
  modules: [{ id: projectModule.id, name: projectModule.name }],
  subtasks: [],
  relations: [],
  archived_at: null,
  created_at: '2026-08-28T00:00:00Z',
  updated_at: '2026-08-28T00:00:00Z',
};

const members: ProjectMember[] = [
  {
    user_id: 'user-1',
    email: 'alex@example.com',
    display_name: 'Alex Morgan',
    role: 'contributor',
    implicit: false,
    joined_at: '2026-08-28T00:00:00Z',
    updated_at: '2026-08-28T00:00:00Z',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listProjectCycles).mockResolvedValue([cycle]);
  vi.mocked(listProjectModules).mockResolvedValue([projectModule]);
  vi.mocked(listPlanningTasks).mockResolvedValue([task]);
  vi.mocked(createProjectCycle).mockResolvedValue({
    ...cycle,
    id: 'cycle-2',
    name: 'Cycle 2',
  });
  vi.mocked(updateProjectCycle).mockResolvedValue(cycle);
  vi.mocked(updateProjectModule).mockResolvedValue(projectModule);
  vi.mocked(completeProjectCycle).mockResolvedValue({
    ...cycle,
    status: 'completed',
  });
  vi.mocked(archiveProjectModule).mockResolvedValue(undefined);
});

describe('ProjectPlanningPane', () => {
  it('shows Cycle progress, linked work, editing, completion, and creation', async () => {
    const openTask = vi.fn();
    renderPlanning('cycles', openTask);

    expect(
      await screen.findByRole('heading', { name: 'Cycle 1', level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    fireEvent.click(
      await screen.findByRole('button', { name: /Complete planning API/ }),
    );
    expect(openTask).toHaveBeenCalledWith('task-1');

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Cycle One' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(updateProjectCycle).toHaveBeenCalledWith(
        expect.anything(),
        'workspace-1',
        'project-1',
        'cycle-1',
        expect.objectContaining({ name: 'Cycle One' }),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Complete Cycle' }));
    await waitFor(() =>
      expect(completeProjectCycle).toHaveBeenCalledWith(
        expect.anything(),
        'workspace-1',
        'project-1',
        'cycle-1',
        null,
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'New cycle' }));
    fireEvent.change(screen.getByLabelText('Cycle name'), {
      target: { value: 'Cycle 2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(createProjectCycle).toHaveBeenCalledWith(
        expect.anything(),
        'workspace-1',
        'project-1',
        expect.objectContaining({ name: 'Cycle 2' }),
      ),
    );
  });

  it('updates Module status and lead and restricts archive to Project Admin', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPlanning('modules', vi.fn());

    expect(
      await screen.findByRole('heading', { name: 'Backend', level: 2 }),
    ).toBeInTheDocument();
    chooseSelectOption('Module status', 'Paused');
    chooseSelectOption('Module lead', 'Alex Morgan');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(updateProjectModule).toHaveBeenCalledWith(
        expect.anything(),
        'workspace-1',
        'project-1',
        'module-1',
        expect.objectContaining({ status: 'paused', lead_user_id: 'user-1' }),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Archive Backend' }));
    await waitFor(() =>
      expect(archiveProjectModule).toHaveBeenCalledWith(
        expect.anything(),
        'workspace-1',
        'project-1',
        'module-1',
      ),
    );
  });
});

function renderPlanning(
  kind: PlanningKind,
  onOpenTask: (taskId: string) => void,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ProjectPlanningPane
        context={{ serverUrl: 'https://kanleaf.example.com', token: 'token' }}
        workspaceId="workspace-1"
        project={project}
        members={members}
        kind={kind}
        onOpenTask={onOpenTask}
      />
    </QueryClientProvider>,
  );
}
