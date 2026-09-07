import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  type InitialEntry,
} from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api/client';
import type { User } from '../../lib/api/types';
import type { WorkspaceDocument } from '../document/types';
import type { WorkspaceImportOperation } from './portabilityApi';
import { createTaskQuery, type SavedView } from '../view/types';
import type { Project, Task, TaskConfiguration, Workspace } from './types';
import { WorkspaceRouteScreen } from './WorkspaceRouteScreen';

const mocks = vi.hoisted(() => ({
  activateWorkspace: vi.fn(),
  applyWorkspaceImport: vi.fn(),
  archiveTask: vi.fn(),
  createSavedView: vi.fn(),
  createTask: vi.fn(),
  createWorkspace: vi.fn(),
  deleteSavedView: vi.fn(),
  deleteTask: vi.fn(),
  getSavedView: vi.fn(),
  getTask: vi.fn(),
  getTaskByNumber: vi.fn(),
  getDocument: vi.fn(),
  getDocumentByNumber: vi.fn(),
  getTaskConfiguration: vi.fn(),
  listProjectCycles: vi.fn(),
  listProjectMembers: vi.fn(),
  listProjectModules: vi.fn(),
  listProjects: vi.fn(),
  listSavedViews: vi.fn(),
  listWorkspaceMembers: vi.fn(),
  listWorkspaces: vi.fn(),
  queryTasks: vi.fn(),
  removeWorkspace: vi.fn(),
  workspaceSettingsMounted: vi.fn(),
}));

vi.mock('./api', () => ({
  activateWorkspace: mocks.activateWorkspace,
  addTaskRelation: vi.fn(),
  archiveTask: mocks.archiveTask,
  bulkUpdateTasks: vi.fn(),
  createProject: vi.fn(),
  createTask: mocks.createTask,
  createWorkspace: mocks.createWorkspace,
  deleteTask: mocks.deleteTask,
  getTask: mocks.getTask,
  getTaskByNumber: mocks.getTaskByNumber,
  joinProject: vi.fn(),
  listProjectCycles: mocks.listProjectCycles,
  listProjectMembers: mocks.listProjectMembers,
  listProjectModules: mocks.listProjectModules,
  listProjects: mocks.listProjects,
  listWorkspaceMembers: mocks.listWorkspaceMembers,
  listWorkspaces: mocks.listWorkspaces,
  removeTaskRelation: vi.fn(),
  updateTask: vi.fn(),
}));

vi.mock('../view/api', () => ({
  createSavedView: mocks.createSavedView,
  deleteSavedView: mocks.deleteSavedView,
  getSavedView: mocks.getSavedView,
  listSavedViews: mocks.listSavedViews,
  queryTasks: mocks.queryTasks,
  updateSavedView: vi.fn(),
}));

vi.mock('../document/api', () => ({
  getDocument: mocks.getDocument,
  getDocumentByNumber: mocks.getDocumentByNumber,
}));

vi.mock('../task-config/api', () => ({
  getTaskConfiguration: mocks.getTaskConfiguration,
}));

vi.mock('./workspacePaneLayout', () => ({
  PANE_LIMITS: {
    navigation: { min: 180, max: 320, defaultValue: 226 },
    collection: { min: 300, max: 560, defaultValue: 360 },
    detail: { min: 340, max: 720, defaultValue: 440 },
  },
  useWorkspacePaneLayout: () => ({
    navigationWidth: 226,
    collectionWidth: 360,
    detailWidth: 440,
    narrow: true,
    navigationVisible: true,
    setNavigationWidth: vi.fn(),
    setCollectionWidth: vi.fn(),
    setDetailWidth: vi.fn(),
    toggleNavigation: vi.fn(),
    closeNavigationDrawer: vi.fn(),
  }),
}));

vi.mock('./WorkspaceControl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./WorkspaceControl')>();
  return {
    WorkspaceControl: (
      props: Parameters<typeof actual.WorkspaceControl>[0],
    ) => (
      <div>
        <actual.WorkspaceControl {...props} />
        <button
          type="button"
          onClick={() => void props.onSwitchWorkspace('workspace-2')}
        >
          Switch workspace
        </button>
        <button
          type="button"
          onClick={() => void props.onSwitchWorkspace('workspace-4')}
        >
          Switch workspace C
        </button>
        <button
          type="button"
          onClick={() => {
            void props
              .onCreateWorkspace({ name: 'New', identifier: 'new' })
              .then(props.onFinishWorkspace);
          }}
        >
          Create workspace
        </button>
        <button type="button" onClick={props.onImportWorkspace}>
          Open import
        </button>
        <button
          type="button"
          onClick={() => props.onOpenWorkspaceSettings('general')}
        >
          Open Workspace Settings
        </button>
      </div>
    ),
  };
});

vi.mock('./WorkspaceNavigation', () => ({
  WorkspaceNavigation: ({
    onSelectCollection,
  }: {
    onSelectCollection: (collection: { kind: 'all' }) => void;
  }) => (
    <button type="button" onClick={() => onSelectCollection({ kind: 'all' })}>
      Open all tasks
    </button>
  ),
}));

vi.mock('../task/TaskListPane', () => ({
  TaskListPane: ({
    activeView,
    onCreateTask,
    onCreateView,
    onDeleteView,
    onSelectTask,
  }: {
    activeView: { id: string } | null;
    onCreateTask: (title: string) => Promise<void>;
    onCreateView: (
      name: string,
      visibility: 'personal' | 'shared',
    ) => Promise<void>;
    onDeleteView: () => Promise<void>;
    onSelectTask: (taskId: string) => void;
  }) => (
    <div>
      <button type="button" onClick={() => void onCreateTask('New Task')}>
        Create Task
      </button>
      <button
        type="button"
        onClick={() => void onCreateView('New View', 'personal')}
      >
        Create Saved View
      </button>
      <button type="button" onClick={() => onSelectTask('task-1')}>
        Open Task
      </button>
      {activeView && (
        <button
          type="button"
          onClick={() => void onDeleteView().catch(() => undefined)}
        >
          Delete Saved View
        </button>
      )}
    </div>
  ),
}));

vi.mock('../task/TaskDetailPane', () => ({
  TaskDetailPane: ({
    task,
    onClose,
    onArchive,
    onDelete,
  }: {
    task: { id: string } | null;
    onClose: () => void;
    onArchive: () => Promise<void>;
    onDelete: (reference: string) => Promise<void>;
  }) =>
    task ? (
      <div>
        <button type="button" onClick={onClose}>
          Close Task
        </button>
        <button type="button" onClick={() => void onArchive()}>
          Archive Task
        </button>
        <button
          type="button"
          onClick={() => void onDelete('#1').catch(() => undefined)}
        >
          Delete Task
        </button>
      </div>
    ) : null,
}));

vi.mock('../document/DocumentWorkspace', () => ({
  DocumentWorkspace: ({
    accessSettled,
    onInvalidSelection,
    onSelectDocument,
  }: {
    accessSettled: boolean;
    onInvalidSelection: () => void;
    onSelectDocument: (
      document: {
        id: string;
        document_number: number;
        project_id: string | null;
      },
      navigation?: { replace?: boolean },
    ) => Promise<boolean>;
  }) => (
    <div>
      <output>Document workspace</output>
      <output aria-label="Document access">
        {accessSettled ? 'settled' : 'pending'}
      </output>
      <button
        type="button"
        onClick={() =>
          void onSelectDocument({
            id: 'document-1',
            document_number: 1,
            project_id: 'project-1',
          })
        }
      >
        Open Project note
      </button>
      <button
        type="button"
        onClick={() =>
          void onSelectDocument(
            {
              id: 'document-1',
              document_number: 1,
              project_id: 'project-1',
            },
            { replace: true },
          )
        }
      >
        Canonicalize Project note
      </button>
      <button type="button" onClick={onInvalidSelection}>
        Invalidate document background
      </button>
      <button
        type="button"
        onClick={() =>
          void onSelectDocument(
            { id: 'document-1', document_number: 1, project_id: null },
            { replace: true },
          )
        }
      >
        Move note to Workspace
      </button>
    </div>
  ),
}));

vi.mock('../account/AccountSwitcher', () => ({
  AccountSwitcher: () => null,
}));
vi.mock('../command/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('../project/ProjectOverview', () => ({ ProjectOverview: () => null }));
vi.mock('../project/ProjectPlanningPane', () => ({
  ProjectPlanningPane: ({
    kind,
    onSelectId,
  }: {
    kind: 'cycles' | 'modules';
    onSelectId: (
      selectedId: string | null,
      options?: { replace?: boolean },
    ) => void;
  }) => (
    <button type="button" onClick={() => onSelectId(null, { replace: true })}>
      Invalidate {kind === 'cycles' ? 'cycle' : 'module'} background
    </button>
  ),
}));
vi.mock('../project/ProjectSettings', () => ({ ProjectSettings: () => null }));
vi.mock('../view/ProjectViewsPane', () => ({
  ProjectViewsPane: () => null,
}));
vi.mock('./WorkspaceTopBar', () => ({
  WorkspaceTopBar: ({
    onOpenNotificationTask,
  }: {
    onOpenNotificationTask: (workspaceId: string, taskId: string) => void;
  }) => (
    <button
      type="button"
      onClick={() => onOpenNotificationTask('workspace-4', 'task-1')}
    >
      Open notification
    </button>
  ),
}));
vi.mock('./PaneResizeHandle', () => ({ PaneResizeHandle: () => null }));
vi.mock('./WorkspaceImportDialog', () => ({
  WorkspaceImportDialog: ({
    onApplyImport,
  }: {
    onApplyImport: (
      apply: () => Promise<WorkspaceImportOperation>,
    ) => Promise<WorkspaceImportOperation | null>;
  }) => (
    <button
      type="button"
      onClick={() => void onApplyImport(() => mocks.applyWorkspaceImport())}
    >
      Complete import
    </button>
  ),
}));
vi.mock('../settings/SettingsDialog', () => ({
  SettingsDialog: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../settings/SettingsShell', () => ({
  AccountSettingsShell: ({
    onWorkspaceJoined,
  }: {
    onWorkspaceJoined: (workspace: Workspace) => void | Promise<void>;
  }) => {
    const queryClient = useQueryClient();
    const joinedWorkspace: Workspace = {
      id: 'joined-workspace-uuid',
      identifier: 'shared-notes',
      name: 'Shared Notes',
      accent: 'sage',
      role: 'member',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
    };

    function acceptInvitation() {
      queryClient.setQueryData<Workspace[]>(
        ['workspaces', 'http://server.test', 'token'],
        (current) => [...(current ?? []), joinedWorkspace],
      );
      void onWorkspaceJoined(joinedWorkspace);
    }

    return (
      <section aria-label="Account Settings">
        <button type="button" onClick={acceptInvitation}>
          Accept listed invitation
        </button>
        <button type="button" onClick={acceptInvitation}>
          Accept invitation token
        </button>
      </section>
    );
  },
  WorkspaceSettingsShell: ({
    section,
    onSectionChange,
    onClose,
    onWorkspaceUpdated,
    onRemoveWorkspace,
  }: {
    section: string;
    onSectionChange: (section: 'members') => void;
    onClose: () => void;
    onWorkspaceUpdated: () => Promise<void>;
    onRemoveWorkspace: (remove: () => Promise<void>) => Promise<void>;
  }) => {
    mocks.workspaceSettingsMounted(section);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>(
      'idle',
    );

    async function saveWorkspace() {
      setSaveStatus('saving');
      await onWorkspaceUpdated();
      setSaveStatus('saved');
    }

    return (
      <section aria-label="Workspace Settings">
        <output>Settings section: {section}</output>
        <output aria-label="Workspace save status">{saveStatus}</output>
        <button type="button" onClick={() => void saveWorkspace()}>
          Save workspace
        </button>
        <button type="button" onClick={() => onSectionChange('members')}>
          Open Members Settings
        </button>
        <button type="button" onClick={onClose}>
          Close Settings
        </button>
        <button
          type="button"
          onClick={() => void onRemoveWorkspace(() => mocks.removeWorkspace())}
        >
          Remove workspace
        </button>
      </section>
    );
  },
}));

const workspaces = [
  workspace('workspace-1', 'Workspace One'),
  workspace('workspace-2', 'Workspace Two'),
  workspace('workspace-4', 'Workspace Four'),
];
const createdWorkspace = workspace('workspace-3', 'New', 'new');

const user: User = {
  id: 'user-1',
  email: 'owner@example.com',
  display_name: 'Owner',
  is_host: false,
  theme: 'system',
  timezone: 'UTC',
  week_start: 'monday',
  date_format: 'locale',
  active_workspace_id: 'workspace-1',
  setup_stage: 'complete',
};

const taskConfiguration: TaskConfiguration = {
  states: [],
  labels: [],
  task_types: [],
  default_state_id: 'state-1',
  default_task_type_id: 'type-1',
};

const task: Task = {
  id: 'task-1',
  workspace_id: 'workspace-1',
  project_id: null,
  task_number: 1,
  reference: '#1',
  title: 'Routing task',
  state: { id: 'state-1', name: 'Todo', color: '#888', state_group: 'todo' },
  task_type: { id: 'type-1', name: 'Task', icon: 'check', color: '#888' },
  priority: 'none',
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
  relations: [],
  archived_at: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

const document = {
  id: 'document-1',
  document_number: 1,
  workspace_id: 'workspace-1',
  project_id: 'project-1',
} as WorkspaceDocument;

const savedView: SavedView = {
  id: 'view-1',
  workspace_id: 'workspace-1',
  project_id: null,
  owner_id: 'user-1',
  name: 'Focus',
  visibility: 'personal',
  query_version: 1,
  query: createTaskQuery({ kind: 'all' }),
  layout: 'list',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

const disabledViewsProject: Project = {
  id: 'project-1',
  workspace_id: 'workspace-1',
  name: 'Disabled Views',
  identifier: 'project-1',
  icon: 'folder',
  description: '',
  lead_user_id: null,
  visibility: 'private',
  default_assignee_id: null,
  default_state_id: 'state-1',
  default_task_type_id: 'type-1',
  cycles_enabled: true,
  modules_enabled: true,
  pages_enabled: true,
  views_enabled: false,
  enabled_task_type_ids: ['type-1'],
  effective_role: 'admin',
  can_join: false,
  archived_at: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

const enabledViewsProject: Project = {
  ...disabledViewsProject,
  id: 'project-2',
  name: 'Enabled Views',
  identifier: 'project-2',
  views_enabled: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.activateWorkspace.mockResolvedValue(undefined);
  mocks.applyWorkspaceImport.mockResolvedValue({
    id: 'import-1',
    state: 'completed',
    workspace_id: 'workspace-4',
  });
  mocks.archiveTask.mockResolvedValue(undefined);
  mocks.getTaskByNumber.mockResolvedValue(task);
  mocks.getDocument.mockResolvedValue(document);
  mocks.getDocumentByNumber.mockResolvedValue(document);
  mocks.createSavedView.mockResolvedValue({
    ...savedView,
    id: 'view-created',
    name: 'New View',
  });
  mocks.createTask.mockResolvedValue({
    ...task,
    id: 'task-created',
    title: 'New Task',
  });
  mocks.createWorkspace.mockResolvedValue(createdWorkspace);
  mocks.deleteSavedView.mockResolvedValue(undefined);
  mocks.deleteTask.mockResolvedValue(undefined);
  mocks.getSavedView.mockResolvedValue(savedView);
  mocks.getTask.mockResolvedValue(task);
  mocks.getTaskConfiguration.mockResolvedValue(taskConfiguration);
  mocks.listProjectCycles.mockResolvedValue([]);
  mocks.listProjectMembers.mockResolvedValue([]);
  mocks.listProjectModules.mockResolvedValue([]);
  mocks.listProjects.mockResolvedValue([]);
  mocks.listSavedViews.mockResolvedValue([]);
  mocks.listWorkspaceMembers.mockResolvedValue([]);
  mocks.listWorkspaces.mockResolvedValue(workspaces);
  mocks.queryTasks.mockResolvedValue([]);
  mocks.removeWorkspace.mockResolvedValue(undefined);
});

describe('WorkspaceShell routing integration', () => {
  it('recovers a zero-Workspace account through the shared identity flow', async () => {
    mocks.listWorkspaces
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValue([createdWorkspace]);
    renderWorkspaceRoutes({ initialEntries: ['/'] });

    expect(
      await screen.findByRole('heading', {
        name: 'Create a home for your work, or join one',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Join a Workspace' }),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: 'New' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Workspace' }));

    await waitFor(() =>
      expect(mocks.createWorkspace).toHaveBeenCalledWith(
        { serverUrl: 'http://server.test', token: 'token' },
        'New',
        'new',
      ),
    );
    expect(
      await screen.findByRole('heading', { name: 'Invite people to New' }),
    ).toBeVisible();
    expect(screen.getByLabelText('Current location')).toHaveTextContent(/^\/$/);
    fireEvent.click(screen.getByRole('button', { name: 'Skip invitations' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Current location')).toHaveTextContent(
        '/new/my-work',
      ),
    );
  });

  it('replaces the root entry with the active Workspace My Work route', async () => {
    renderWorkspaceRoutes({ initialEntries: ['/sentinel', '/'] });

    await waitFor(() =>
      expect(screen.getByLabelText('Current location')).toHaveTextContent(
        '/w/workspace-1/my-work',
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));

    await waitFor(() =>
      expect(screen.getByLabelText('Current location')).toHaveTextContent(
        '/sentinel',
      ),
    );
  });

  it('activates a directly loaded Workspace without changing its route', async () => {
    const flushDocumentSaves = vi.fn().mockResolvedValue(undefined);
    const { queryClient } = renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-2/my-work'],
      flushDocumentSaves,
    });

    await waitFor(() =>
      expect(mocks.activateWorkspace).toHaveBeenCalledWith(
        { serverUrl: 'http://server.test', token: 'token' },
        'workspace-2',
      ),
    );
    expect(screen.getByLabelText('Current location')).toHaveTextContent(
      '/w/workspace-2/my-work',
    );
    expect(
      queryClient.getQueryData<{ user: User }>([
        'session',
        'http://server.test',
        'token',
      ])?.user.active_workspace_id,
    ).toBe('workspace-2');
    expect(flushDocumentSaves).not.toHaveBeenCalled();
  });

  it.each([
    ['listed invitation', 'Accept listed invitation'],
    ['invitation token', 'Accept invitation token'],
  ])(
    'moves an established account to the identifier route after accepting a %s',
    async (_acceptanceKind, buttonName) => {
      const flushDocumentSaves = vi.fn().mockResolvedValue(undefined);
      renderWorkspaceRoutes({
        initialEntries: ['/w/workspace-1/settings/account/invitations'],
        flushDocumentSaves,
      });

      fireEvent.click(await screen.findByRole('button', { name: buttonName }));

      await waitFor(() =>
        expect(screen.getByLabelText('Current location')).toHaveTextContent(
          '/shared-notes/my-work',
        ),
      );
      expect(screen.getByLabelText('Current location')).not.toHaveTextContent(
        '/joined-workspace-uuid/',
      );
      expect(flushDocumentSaves).toHaveBeenCalledOnce();
      expect(mocks.activateWorkspace).toHaveBeenCalledWith(
        { serverUrl: 'http://server.test', token: 'token' },
        'joined-workspace-uuid',
      );
    },
  );

  it('does not activate a direct Workspace from stale membership data', async () => {
    let rejectRefresh!: (error: Error) => void;
    mocks.listWorkspaces.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectRefresh = reject;
      }),
    );
    renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-2/my-work'],
      seededWorkspaces: workspaces,
    });

    expect(mocks.activateWorkspace).not.toHaveBeenCalled();
    await act(async () => rejectRefresh(new Error('Workspace refresh failed')));
    expect(mocks.activateWorkspace).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Current location')).toHaveTextContent(
      '/w/workspace-2/my-work',
    );
  });

  it('falls back from a stale active Workspace to the first available one', async () => {
    const { queryClient } = renderWorkspaceRoutes({
      initialEntries: ['/'],
      routeUser: { ...user, active_workspace_id: 'removed-workspace' },
    });

    await waitFor(() =>
      expect(screen.getByLabelText('Current location')).toHaveTextContent(
        '/w/workspace-1/my-work',
      ),
    );
    await waitFor(() =>
      expect(mocks.activateWorkspace).toHaveBeenCalledWith(
        { serverUrl: 'http://server.test', token: 'token' },
        'workspace-1',
      ),
    );
    expect(
      queryClient.getQueryData<{ user: User }>([
        'session',
        'http://server.test',
        'token',
      ])?.user.active_workspace_id,
    ).toBe('workspace-1');
  });

  it('keeps root and its Retry state when a stale Workspace refresh fails', async () => {
    let rejectRefresh!: (error: Error) => void;
    mocks.listWorkspaces.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectRefresh = reject;
      }),
    );
    renderWorkspaceRoutes({
      initialEntries: ['/'],
      seededWorkspaces: [workspaces[0]],
    });

    expect(screen.getByLabelText('Current location')).toHaveTextContent(/^\/$/);
    await act(async () => rejectRefresh(new Error('Workspace refresh failed')));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Workspace refresh failed',
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Current location')).toHaveTextContent(
        /^\/$/,
      ),
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  it('retains the current route when explicit Workspace activation fails', async () => {
    const flushDocumentSaves = vi.fn().mockResolvedValue(undefined);
    mocks.activateWorkspace.mockRejectedValueOnce(
      new Error('Activation failed'),
    );
    renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-1/my-work'],
      flushDocumentSaves,
    });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Switch workspace' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Activation failed',
    );
    expect(screen.getByLabelText('Current location')).toHaveTextContent(
      '/w/workspace-1/my-work',
    );
    expect(flushDocumentSaves).toHaveBeenCalledOnce();
  });

  it('commits a successful Workspace switch to one route, activation, and session identity', async () => {
    const { queryClient } = renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-1/my-work'],
    });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Switch workspace' }),
    );

    await waitFor(() =>
      expect(screen.getByLabelText('Current location')).toHaveTextContent(
        '/w/workspace-2/my-work',
      ),
    );
    expect(mocks.activateWorkspace).toHaveBeenCalledOnce();
    expect(mocks.activateWorkspace).toHaveBeenCalledWith(
      { serverUrl: 'http://server.test', token: 'token' },
      'workspace-2',
    );
    expect(
      queryClient.getQueryData<{ user: User }>([
        'session',
        'http://server.test',
        'token',
      ])?.user.active_workspace_id,
    ).toBe('workspace-2');
  });

  it.each([
    ['older first', false],
    ['newer first', true],
  ])(
    'keeps the latest explicit Workspace intent when activations resolve %s',
    async (_label, resolveNewerFirst) => {
      const workspaceTwo = deferred<void>();
      const workspaceFour = deferred<void>();
      mocks.activateWorkspace.mockImplementation((_context, workspaceId) =>
        workspaceId === 'workspace-2'
          ? workspaceTwo.promise
          : workspaceFour.promise,
      );
      const { queryClient } = renderWorkspaceRoutes({
        initialEntries: ['/w/workspace-1/my-work'],
      });

      fireEvent.click(
        await screen.findByRole('button', { name: 'Switch workspace' }),
      );
      await waitFor(() =>
        expect(mocks.activateWorkspace).toHaveBeenCalledWith(
          expect.anything(),
          'workspace-2',
        ),
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'Switch workspace C' }),
      );

      if (resolveNewerFirst) {
        await act(async () => {
          workspaceFour.resolve();
          await workspaceFour.promise;
        });
      }
      await act(async () => {
        workspaceTwo.resolve();
        await workspaceTwo.promise;
      });
      await waitFor(() =>
        expect(mocks.activateWorkspace).toHaveBeenCalledWith(
          expect.anything(),
          'workspace-4',
        ),
      );
      if (!resolveNewerFirst) {
        await act(async () => {
          workspaceFour.resolve();
          await workspaceFour.promise;
        });
      }

      await waitFor(() =>
        expect(screen.getByLabelText('Current location')).toHaveTextContent(
          '/w/workspace-4/my-work',
        ),
      );
      expect(
        queryClient.getQueryData<{ user: User }>([
          'session',
          'http://server.test',
          'token',
        ])?.user.active_workspace_id,
      ).toBe('workspace-4');
    },
  );

  it('repairs an in-flight activation when the latest intent returns to the already-active Workspace', async () => {
    const workspaceTwo = deferred<void>();
    const workspaceOne = deferred<void>();
    mocks.activateWorkspace.mockImplementation((_context, workspaceId) =>
      workspaceId === 'workspace-2'
        ? workspaceTwo.promise
        : workspaceOne.promise,
    );
    const { queryClient } = renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-1/my-work'],
    });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Switch workspace' }),
    );
    await waitFor(() =>
      expect(mocks.activateWorkspace).toHaveBeenCalledWith(
        expect.anything(),
        'workspace-2',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Active workspace' }));
    fireEvent.click(screen.getByRole('button', { name: /^Workspace One/ }));

    await act(async () => workspaceTwo.resolve());
    await waitFor(() =>
      expect(mocks.activateWorkspace).toHaveBeenCalledWith(
        expect.anything(),
        'workspace-1',
      ),
    );
    await act(async () => workspaceOne.resolve());

    await waitFor(() =>
      expect(
        queryClient.getQueryData<{ user: User }>([
          'session',
          'http://server.test',
          'token',
        ])?.user.active_workspace_id,
      ).toBe('workspace-1'),
    );
    expect(screen.getByLabelText('Current location')).toHaveTextContent(
      '/w/workspace-1/my-work',
    );
  });

  it('serializes Workspace creation behind an in-flight activation', async () => {
    const workspaceTwo = deferred<void>();
    mocks.activateWorkspace.mockReturnValue(workspaceTwo.promise);
    mocks.listWorkspaces
      .mockReset()
      .mockResolvedValueOnce(workspaces)
      .mockResolvedValue([...workspaces, createdWorkspace]);
    const { queryClient } = renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-1/my-work'],
    });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Switch workspace' }),
    );
    await waitFor(() => expect(mocks.activateWorkspace).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.createWorkspace).not.toHaveBeenCalled();
    await act(async () => workspaceTwo.resolve());

    await waitFor(() => expect(mocks.createWorkspace).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(
        queryClient
          .getQueryData<Workspace[]>([
            'workspaces',
            'http://server.test',
            'token',
          ])
          ?.map(({ id }) => id),
      ).toContain('workspace-3'),
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Current location')).toHaveTextContent(
        '/new/my-work',
      ),
    );
    expect(
      queryClient.getQueryData<{ user: User }>([
        'session',
        'http://server.test',
        'token',
      ])?.user.active_workspace_id,
    ).toBe('workspace-3');
  });

  it('repairs an imported Workspace behind an in-flight activation', async () => {
    const workspaceTwo = deferred<void>();
    const importedWorkspace = deferred<void>();
    mocks.activateWorkspace.mockImplementation((_context, workspaceId) =>
      workspaceId === 'workspace-2'
        ? workspaceTwo.promise
        : importedWorkspace.promise,
    );
    const { queryClient } = renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-1/my-work'],
    });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Switch workspace' }),
    );
    await waitFor(() =>
      expect(mocks.activateWorkspace).toHaveBeenCalledWith(
        expect.anything(),
        'workspace-2',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open import' }));
    fireEvent.click(screen.getByRole('button', { name: 'Complete import' }));
    expect(mocks.applyWorkspaceImport).not.toHaveBeenCalled();
    expect(mocks.activateWorkspace).not.toHaveBeenCalledWith(
      expect.anything(),
      'workspace-4',
    );

    await act(async () => workspaceTwo.resolve());
    await waitFor(() =>
      expect(mocks.applyWorkspaceImport).toHaveBeenCalledOnce(),
    );
    await waitFor(() =>
      expect(mocks.activateWorkspace).toHaveBeenCalledWith(
        expect.anything(),
        'workspace-4',
      ),
    );
    await act(async () => importedWorkspace.resolve());

    await waitFor(() =>
      expect(
        queryClient.getQueryData<{ user: User }>([
          'session',
          'http://server.test',
          'token',
        ])?.user.active_workspace_id,
      ).toBe('workspace-4'),
    );
    expect(screen.getByLabelText('Current location')).toHaveTextContent(
      '/w/workspace-4/my-work',
    );
  });

  it('keeps a later Workspace switch after the removed route falls back', async () => {
    const removal = deferred<void>();
    const workspaceFour = deferred<void>();
    mocks.removeWorkspace.mockReturnValue(removal.promise);
    mocks.activateWorkspace.mockImplementation((_context, workspaceId) =>
      workspaceId === 'workspace-4' ? workspaceFour.promise : Promise.resolve(),
    );
    mocks.listWorkspaces
      .mockReset()
      .mockResolvedValueOnce(workspaces)
      .mockResolvedValue([workspaces[1], workspaces[2]]);
    const { queryClient } = renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-1/settings/workspace/danger'],
    });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Remove workspace' }),
    );
    await waitFor(() => expect(mocks.removeWorkspace).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Switch workspace C' }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.activateWorkspace).not.toHaveBeenCalledWith(
      expect.anything(),
      'workspace-4',
    );

    await act(async () => removal.resolve());
    await waitFor(() =>
      expect(mocks.activateWorkspace).toHaveBeenCalledWith(
        expect.anything(),
        'workspace-4',
      ),
    );
    await act(
      () =>
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, 0);
        }),
    );
    expect(screen.getByLabelText('Current location')).toHaveTextContent(
      '/w/workspace-2/my-work',
    );
    await act(async () => workspaceFour.resolve());
    await waitFor(() =>
      expect(screen.getByLabelText('Current location')).toHaveTextContent(
        '/w/workspace-4/my-work',
      ),
    );
    expect(
      queryClient.getQueryData<{ user: User }>([
        'session',
        'http://server.test',
        'token',
      ])?.user.active_workspace_id,
    ).toBe('workspace-4');
  });

  it('serializes notification activation behind the previous Workspace intent', async () => {
    const workspaceTwo = deferred<void>();
    const notificationWorkspace = deferred<void>();
    mocks.getTask.mockResolvedValue({ ...task, workspace_id: 'workspace-4' });
    mocks.activateWorkspace.mockImplementation((_context, workspaceId) =>
      workspaceId === 'workspace-2'
        ? workspaceTwo.promise
        : notificationWorkspace.promise,
    );
    const { queryClient } = renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-1/my-work'],
    });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Switch workspace' }),
    );
    await waitFor(() =>
      expect(mocks.activateWorkspace).toHaveBeenCalledWith(
        expect.anything(),
        'workspace-2',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open notification' }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.activateWorkspace).not.toHaveBeenCalledWith(
      expect.anything(),
      'workspace-4',
    );

    await act(async () => workspaceTwo.resolve());
    await waitFor(() =>
      expect(mocks.activateWorkspace).toHaveBeenCalledWith(
        expect.anything(),
        'workspace-4',
      ),
    );
    await act(async () => notificationWorkspace.resolve());

    await waitFor(() =>
      expect(
        queryClient.getQueryData<{ user: User }>([
          'session',
          'http://server.test',
          'token',
        ])?.user.active_workspace_id,
      ).toBe('workspace-4'),
    );
    expect(screen.getByLabelText('Current location')).toHaveTextContent(
      '/w/workspace-4/tasks?task=1',
    );
  });

  it.each([
    ['older first', false],
    ['newer first', true],
  ])(
    'keeps the latest direct-link Workspace intent when activations resolve %s',
    async (_label, resolveNewerFirst) => {
      const workspaceTwo = deferred<void>();
      const workspaceFour = deferred<void>();
      mocks.activateWorkspace.mockImplementation((_context, workspaceId) =>
        workspaceId === 'workspace-2'
          ? workspaceTwo.promise
          : workspaceFour.promise,
      );
      const { queryClient } = renderWorkspaceRoutes({
        initialEntries: ['/w/workspace-2/my-work'],
      });

      await waitFor(() =>
        expect(mocks.activateWorkspace).toHaveBeenCalledWith(
          expect.anything(),
          'workspace-2',
        ),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Open workspace C' }));

      if (resolveNewerFirst) {
        await act(async () => {
          workspaceFour.resolve();
          await workspaceFour.promise;
        });
      }
      await act(async () => {
        workspaceTwo.resolve();
        await workspaceTwo.promise;
      });
      await waitFor(() =>
        expect(mocks.activateWorkspace).toHaveBeenCalledWith(
          expect.anything(),
          'workspace-4',
        ),
      );
      if (!resolveNewerFirst) {
        await act(async () => {
          workspaceFour.resolve();
          await workspaceFour.promise;
        });
      }

      await waitFor(() =>
        expect(
          queryClient.getQueryData<{ user: User }>([
            'session',
            'http://server.test',
            'token',
          ])?.user.active_workspace_id,
        ).toBe('workspace-4'),
      );
      expect(screen.getByLabelText('Current location')).toHaveTextContent(
        '/w/workspace-4/my-work',
      );
    },
  );

  it('retries a failed direct-link Workspace activation', async () => {
    mocks.activateWorkspace
      .mockRejectedValueOnce(new Error('Activation failed'))
      .mockResolvedValueOnce(undefined);
    const { queryClient } = renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-2/my-work'],
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Activation failed',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() =>
      expect(mocks.activateWorkspace).toHaveBeenCalledTimes(2),
    );
    await waitFor(() =>
      expect(
        queryClient.getQueryData<{ user: User }>([
          'session',
          'http://server.test',
          'token',
        ])?.user.active_workspace_id,
      ).toBe('workspace-2'),
    );
    expect(screen.getByLabelText('Current location')).toHaveTextContent(
      '/w/workspace-2/my-work',
    );
  });

  it('does not reactivate the old route while committing a created Workspace', async () => {
    mocks.listWorkspaces
      .mockReset()
      .mockResolvedValueOnce(workspaces)
      .mockResolvedValue([...workspaces, createdWorkspace]);
    const { queryClient } = renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-1/my-work'],
    });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Create workspace' }),
    );

    await waitFor(() =>
      expect(screen.getByLabelText('Current location')).toHaveTextContent(
        '/new/my-work',
      ),
    );
    expect(mocks.activateWorkspace).not.toHaveBeenCalledWith(
      expect.anything(),
      'workspace-1',
    );
    expect(
      queryClient.getQueryData<{ user: User }>([
        'session',
        'http://server.test',
        'token',
      ])?.user.active_workspace_id,
    ).toBe('workspace-3');
  });

  it('uses one Settings history entry across section changes and close', async () => {
    renderWorkspaceRoutes({
      initialEntries: ['/sentinel', '/w/workspace-1/my-work'],
    });
    await screen.findByRole('button', { name: 'Open Workspace Settings' });
    const returnLocationKey = screen.getByLabelText('Location key').textContent;

    fireEvent.click(
      screen.getByRole('button', { name: 'Open Workspace Settings' }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Current location')).toHaveTextContent(
        '/w/workspace-1/settings/workspace/general',
      ),
    );
    expect(screen.getByLabelText('Router state')).toHaveTextContent(
      '"returnTo":"/w/workspace-1/my-work"',
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Open Members Settings' }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Current location')).toHaveTextContent(
        '/w/workspace-1/settings/workspace/members',
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close Settings' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Current location')).toHaveTextContent(
        '/w/workspace-1/my-work',
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Location key')).toHaveTextContent(
        returnLocationKey ?? '',
      ),
    );
    expect(
      screen.queryByRole('region', { name: 'Workspace Settings' }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Current location')).toHaveTextContent(
        '/sentinel',
      ),
    );
  });

  it('routes a Project note selected from the aggregate Library to its Project scope', async () => {
    mocks.listProjects.mockResolvedValue([disabledViewsProject]);
    renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-1/library'],
    });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open Project note' }),
    );

    await waitFor(() =>
      expect(screen.getByLabelText('Current location')).toHaveTextContent(
        '/w/workspace-1/p/project-1/library?page=1',
      ),
    );
  });

  it('replaces a direct aggregate Library URL with its Project-scoped URL', async () => {
    mocks.listProjects.mockResolvedValue([disabledViewsProject]);
    renderWorkspaceRoutes({
      initialEntries: ['/sentinel', '/w/workspace-1/library?page=1'],
    });

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Canonicalize Project note',
      }),
    );

    await waitFor(() =>
      expect(screen.getByLabelText('Current location')).toHaveTextContent(
        '/w/workspace-1/p/project-1/library?page=1',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Current location')).toHaveTextContent(
        '/sentinel',
      ),
    );
  });

  it('replaces a Project Library URL after its note moves to the Workspace scope', async () => {
    mocks.listProjects.mockResolvedValue([disabledViewsProject]);
    renderWorkspaceRoutes({
      initialEntries: [
        '/sentinel',
        '/w/workspace-1/p/project-1/library?page=1',
      ],
    });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Move note to Workspace' }),
    );

    await waitFor(() =>
      expect(screen.getByLabelText('Current location')).toHaveTextContent(
        '/w/workspace-1/library?page=1',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Current location')).toHaveTextContent(
        '/sentinel',
      ),
    );
  });

  it.each([
    {
      name: 'document',
      settingsPath: '/w/workspace-1/settings/workspace/general',
      returnTo: '/w/workspace-1/library?page=1',
      invalidation: 'Invalidate document background',
      expectedReturnTo: '/w/workspace-1/library',
    },
    {
      name: 'cycle',
      settingsPath: '/w/workspace-1/p/project-1/settings/general',
      returnTo: '/w/workspace-1/p/project-1/cycles/cycle-1',
      invalidation: 'Invalidate cycle background',
      expectedReturnTo: '/w/workspace-1/p/project-1/cycles',
    },
    {
      name: 'module',
      settingsPath: '/w/workspace-1/p/project-1/settings/general',
      returnTo: '/w/workspace-1/p/project-1/modules/module-1',
      invalidation: 'Invalidate module background',
      expectedReturnTo: '/w/workspace-1/p/project-1/modules',
    },
  ])(
    'keeps Settings open when its $name background disappears',
    async ({ settingsPath, returnTo, invalidation, expectedReturnTo }) => {
      mocks.listProjects.mockResolvedValue([disabledViewsProject]);
      renderWorkspaceRoutes({
        initialEntries: [
          {
            pathname: settingsPath,
            state: { returnTo },
          },
        ],
      });

      fireEvent.click(
        await screen.findByRole('button', { name: invalidation }),
      );

      await waitFor(() =>
        expect(screen.getByLabelText('Router state')).toHaveTextContent(
          `"returnTo":"${expectedReturnTo}"`,
        ),
      );
      expect(screen.getByLabelText('Current location')).toHaveTextContent(
        settingsPath,
      );
    },
  );

  it('keeps a routed Workspace and shows Retry when its stale list refresh fails', async () => {
    const refresh = deferred<Workspace[]>();
    mocks.listWorkspaces.mockReturnValueOnce(refresh.promise);
    renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-2/my-work'],
      seededWorkspaces: [workspaces[0]],
    });

    await waitFor(() => expect(mocks.listWorkspaces).toHaveBeenCalledOnce());
    expect(screen.getByLabelText('Current location')).toHaveTextContent(
      /^\/w\/workspace-2\/my-work$/,
    );

    await act(async () => {
      refresh.reject(new Error('Workspace refresh failed'));
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Workspace refresh failed',
    );
    expect(screen.getByLabelText('Current location')).toHaveTextContent(
      /^\/w\/workspace-2\/my-work$/,
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  it('shows Retry when a matching cached Workspace refresh fails', async () => {
    const refresh = deferred<Workspace[]>();
    mocks.listWorkspaces.mockReturnValueOnce(refresh.promise);
    renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-2/tasks'],
      seededWorkspaces: workspaces,
    });

    await waitFor(() => expect(mocks.listWorkspaces).toHaveBeenCalledOnce());
    await act(async () =>
      refresh.reject(new Error('Workspace refresh failed')),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Workspace refresh failed',
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(screen.getByLabelText('Current location')).toHaveTextContent(
      '/w/workspace-2/tasks',
    );
  });

  it('keeps a routed Project and shows Retry when its stale list refresh fails', async () => {
    const refresh = deferred<Project[]>();
    mocks.listProjects.mockReturnValueOnce(refresh.promise);
    renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-1/p/project-1'],
      seededWorkspaces: [workspaces[0]],
      seededProjects: [],
    });

    await waitFor(() => expect(mocks.listProjects).toHaveBeenCalledOnce());
    expect(screen.getByLabelText('Current location')).toHaveTextContent(
      /^\/w\/workspace-1\/p\/project-1$/,
    );

    await act(async () => {
      refresh.reject(new Error('Project refresh failed'));
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Project refresh failed',
    );
    expect(screen.getByLabelText('Current location')).toHaveTextContent(
      /^\/w\/workspace-1\/p\/project-1$/,
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  it('waits for a stale Workspace refresh before replacing a settled absence', async () => {
    const refresh = deferred<Workspace[]>();
    mocks.listWorkspaces.mockReturnValueOnce(refresh.promise);
    renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-2/my-work'],
      seededWorkspaces: [workspaces[0]],
    });

    await waitFor(() => expect(mocks.listWorkspaces).toHaveBeenCalledOnce());
    expect(screen.getByLabelText('Current location')).toHaveTextContent(
      /^\/w\/workspace-2\/my-work$/,
    );

    await act(async () => {
      refresh.resolve([workspaces[0]]);
    });
    await waitFor(() =>
      expect(screen.getByLabelText('Current location')).toHaveTextContent(
        /^\/w\/workspace-1\/my-work$/,
      ),
    );
  });

  it('keeps matching cached Project content visible during its refresh', async () => {
    const refresh = deferred<Project[]>();
    mocks.listProjects.mockReturnValueOnce(refresh.promise);
    renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-1/p/project-2'],
      seededWorkspaces: [workspaces[0]],
      seededProjects: [enabledViewsProject],
    });

    await waitFor(() => expect(mocks.listProjects).toHaveBeenCalledOnce());
    expect(screen.getByLabelText('Current location')).toHaveTextContent(
      /^\/w\/workspace-1\/p\/project-2$/,
    );
    expect(
      await screen.findByRole('button', { name: 'Open all tasks' }),
    ).toBeVisible();

    await act(async () => {
      refresh.resolve([enabledViewsProject]);
    });
  });

  it('keeps confirmed child access while the owning Workspace refreshes', async () => {
    const workspaceRefresh = deferred<Workspace[]>();
    mocks.listWorkspaces
      .mockResolvedValueOnce(workspaces)
      .mockReturnValueOnce(workspaceRefresh.promise);
    mocks.listProjects.mockResolvedValue([enabledViewsProject]);
    const { queryClient } = renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-1/p/project-2/library'],
    });

    await waitFor(() =>
      expect(screen.getByLabelText('Document access')).toHaveTextContent(
        'settled',
      ),
    );

    act(() => {
      void queryClient.invalidateQueries({
        queryKey: ['workspaces', 'http://server.test', 'token'],
      });
    });
    await waitFor(() => expect(mocks.listWorkspaces).toHaveBeenCalledTimes(2));

    expect(screen.getByLabelText('Document access')).toHaveTextContent(
      'settled',
    );
    await act(async () => workspaceRefresh.resolve(workspaces));
  });

  it('does not mount cached Workspace Settings before access settles', async () => {
    const refresh = deferred<Workspace[]>();
    mocks.listWorkspaces.mockReturnValueOnce(refresh.promise);
    renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-1/settings/workspace/members'],
      seededWorkspaces: [workspaces[0]],
    });

    await waitFor(() => expect(mocks.listWorkspaces).toHaveBeenCalledOnce());
    expect(mocks.workspaceSettingsMounted).not.toHaveBeenCalled();
    expect(mocks.listWorkspaceMembers).not.toHaveBeenCalled();
    expect(mocks.getTaskConfiguration).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('region', { name: 'Workspace Settings' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Remove workspace' }),
    ).not.toBeInTheDocument();

    await act(async () => refresh.resolve([workspaces[0]]));
    await waitFor(() =>
      expect(mocks.workspaceSettingsMounted).toHaveBeenCalledWith('members'),
    );
    expect(
      screen.getByRole('region', { name: 'Workspace Settings' }),
    ).toBeVisible();
  });

  it('keeps confirmed Workspace Settings mounted through a background refresh', async () => {
    const refresh = deferred<Workspace[]>();
    mocks.listWorkspaces
      .mockResolvedValueOnce(workspaces)
      .mockReturnValueOnce(refresh.promise);
    renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-1/settings/workspace/general'],
    });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Save workspace' }),
    );
    await waitFor(() => expect(mocks.listWorkspaces).toHaveBeenCalledTimes(2));

    expect(
      screen.getByRole('region', { name: 'Workspace Settings' }),
    ).toBeVisible();
    expect(screen.getByLabelText('Workspace save status')).toHaveTextContent(
      'saving',
    );

    await act(async () => refresh.resolve(workspaces));
    await waitFor(() =>
      expect(screen.getByLabelText('Workspace save status')).toHaveTextContent(
        'saved',
      ),
    );
  });

  it('hides confirmed Workspace Settings when a background refresh fails', async () => {
    const refresh = deferred<Workspace[]>();
    mocks.listWorkspaces
      .mockResolvedValueOnce(workspaces)
      .mockReturnValueOnce(refresh.promise);
    const { queryClient } = renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-1/settings/workspace/general'],
    });

    await screen.findByRole('region', { name: 'Workspace Settings' });
    act(() => {
      void queryClient.invalidateQueries({
        queryKey: ['workspaces', 'http://server.test', 'token'],
      });
    });
    await waitFor(() => expect(mocks.listWorkspaces).toHaveBeenCalledTimes(2));
    expect(
      screen.getByRole('region', { name: 'Workspace Settings' }),
    ).toBeVisible();

    await act(async () => refresh.reject(new Error('Access refresh failed')));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Access refresh failed',
    );
    expect(
      screen.queryByRole('region', { name: 'Workspace Settings' }),
    ).not.toBeInTheDocument();
  });

  it('keeps confirmed Project child access through a background refresh', async () => {
    const refresh = deferred<Project[]>();
    mocks.listProjects
      .mockResolvedValueOnce([enabledViewsProject])
      .mockReturnValueOnce(refresh.promise);
    const { queryClient } = renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-1/p/project-2/library'],
    });

    await waitFor(() =>
      expect(screen.getByLabelText('Document access')).toHaveTextContent(
        'settled',
      ),
    );
    act(() => {
      void queryClient.invalidateQueries({
        queryKey: ['projects', 'workspace-1'],
      });
    });
    await waitFor(() => expect(mocks.listProjects).toHaveBeenCalledTimes(2));

    expect(screen.getByLabelText('Document access')).toHaveTextContent(
      'settled',
    );
    await act(async () => refresh.resolve([enabledViewsProject]));
  });

  it('does not request Project child data from cached access before authorization settles', async () => {
    const refresh = deferred<Project[]>();
    mocks.listProjects.mockReturnValueOnce(refresh.promise);
    mocks.getTaskByNumber.mockResolvedValueOnce({
      ...task,
      project_id: enabledViewsProject.id,
    });
    renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-1/p/project-2/work-items?task=1'],
      seededWorkspaces: [workspaces[0]],
      seededProjects: [enabledViewsProject],
    });

    await waitFor(() => expect(mocks.listProjects).toHaveBeenCalledOnce());
    expect(mocks.listProjectMembers).not.toHaveBeenCalled();
    expect(mocks.listProjectCycles).not.toHaveBeenCalled();
    expect(mocks.listProjectModules).not.toHaveBeenCalled();

    await act(async () => refresh.resolve([enabledViewsProject]));
    await waitFor(() => expect(mocks.listProjectMembers).toHaveBeenCalled());
    await waitFor(() => expect(mocks.listProjectCycles).toHaveBeenCalled());
    await waitFor(() => expect(mocks.listProjectModules).toHaveBeenCalled());
  });

  it('does not request Task-list planning data from Project Overview', async () => {
    mocks.listProjects.mockResolvedValueOnce([enabledViewsProject]);
    renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-1/p/project-2'],
    });

    await waitFor(() => expect(mocks.listProjects).toHaveBeenCalledOnce());
    await waitFor(() => expect(mocks.listSavedViews).toHaveBeenCalled());
    expect(mocks.listProjectCycles).not.toHaveBeenCalled();
    expect(mocks.listProjectModules).not.toHaveBeenCalled();
    expect(mocks.listProjectMembers).not.toHaveBeenCalled();
    expect(mocks.listWorkspaceMembers).not.toHaveBeenCalled();
  });

  it('shows Retry when a cached Project refresh fails before an uncached View loads', async () => {
    mocks.listProjects.mockRejectedValueOnce(
      new Error('Project refresh failed'),
    );
    renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-1/p/project-2/views/view-1'],
      seededWorkspaces: [workspaces[0]],
      seededProjects: [enabledViewsProject],
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Project refresh failed',
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(mocks.getSavedView).not.toHaveBeenCalled();
  });

  it('pushes a Task selection and strips it with replace when closing', async () => {
    renderWorkspaceRoutes({ initialEntries: ['/w/workspace-1/tasks'] });

    fireEvent.click(await screen.findByRole('button', { name: 'Open Task' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Current location')).toHaveTextContent(
        '/w/workspace-1/tasks?task=1',
      ),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Close Task' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Current location')).toHaveTextContent(
        '/w/workspace-1/tasks',
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Current location')).toHaveTextContent(
        '/w/workspace-1/tasks',
      ),
    );
  });

  it('strips a malformed public Task number without issuing a lookup', async () => {
    renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-1/tasks?task=not-a-uuid'],
    });

    await waitFor(() =>
      expect(screen.getByLabelText('Current location')).toHaveTextContent(
        /^\/w\/workspace-1\/tasks$/,
      ),
    );
    expect(mocks.getTaskByNumber).not.toHaveBeenCalled();
    expect(mocks.getTask).not.toHaveBeenCalled();
  });

  it('retains a document route when the deliberate navigation save fails', async () => {
    const flushDocumentSaves = vi
      .fn()
      .mockRejectedValue(new Error('Document save failed'));
    renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-1/library?page=1'],
      flushDocumentSaves,
    });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open all tasks' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Document save failed',
    );
    expect(screen.getByLabelText('Current location')).toHaveTextContent(
      '/w/workspace-1/library?page=1',
    );
    expect(flushDocumentSaves).toHaveBeenCalledOnce();
  });

  it('does not archive an open Task when its Markdown save fails', async () => {
    const flushDocumentSaves = vi
      .fn()
      .mockRejectedValue(new Error('Task document save failed'));
    renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-1/tasks?task=1'],
      flushDocumentSaves,
    });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Archive Task' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Task document save failed',
    );
    expect(mocks.archiveTask).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Current location')).toHaveTextContent(
      '/w/workspace-1/tasks?task=1',
    );
    expect(screen.getByRole('button', { name: 'Archive Task' })).toBeVisible();
  });

  it('does not create a Task before its Markdown save succeeds', async () => {
    const flushDocumentSaves = vi
      .fn()
      .mockRejectedValue(new Error('Task document save failed'));
    renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-1/tasks'],
      flushDocumentSaves,
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Create Task' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Task document save failed',
    );
    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Current location')).toHaveTextContent(
      '/w/workspace-1/tasks',
    );
  });

  it('does not create a Saved View before its Markdown save succeeds', async () => {
    const flushDocumentSaves = vi
      .fn()
      .mockRejectedValue(new Error('Task document save failed'));
    renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-1/tasks'],
      flushDocumentSaves,
    });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Create Saved View' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Task document save failed',
    );
    expect(mocks.createSavedView).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Current location')).toHaveTextContent(
      '/w/workspace-1/tasks',
    );
  });

  it('does not permanently delete an open Task when its Markdown save fails', async () => {
    const flushDocumentSaves = vi
      .fn()
      .mockRejectedValue(new Error('Task document save failed'));
    renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-1/tasks?task=1'],
      flushDocumentSaves,
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Task' }));

    await waitFor(() => expect(flushDocumentSaves).toHaveBeenCalledOnce());
    expect(mocks.deleteTask).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Current location')).toHaveTextContent(
      '/w/workspace-1/tasks?task=1',
    );
    expect(screen.getByRole('button', { name: 'Delete Task' })).toBeVisible();
  });

  it('removes a permanently deleted Task from every cached Workspace list', async () => {
    const refresh = deferred<Task[]>();
    mocks.queryTasks
      .mockResolvedValueOnce([task])
      .mockReturnValueOnce(refresh.promise);
    const { queryClient } = renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-1/tasks?task=1'],
    });

    await waitFor(() => expect(mocks.queryTasks).toHaveBeenCalledOnce());
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Task' }));

    await waitFor(() =>
      expect(mocks.deleteTask).toHaveBeenCalledWith(
        { serverUrl: 'http://server.test', token: 'token' },
        'workspace-1',
        'task-1',
        '#1',
      ),
    );
    expect(screen.getByLabelText('Current location')).toHaveTextContent(
      '/w/workspace-1/tasks',
    );
    expect(
      queryClient
        .getQueriesData<Task[]>({ queryKey: ['tasks', 'workspace-1'] })
        .flatMap(([, tasks]) => tasks ?? [])
        .some(({ id }) => id === task.id),
    ).toBe(false);

    await act(async () => refresh.resolve([]));
  });

  it('does not delete the active Saved View when its Markdown save fails', async () => {
    const flushDocumentSaves = vi
      .fn()
      .mockRejectedValue(new Error('Task document save failed'));
    renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-1/views/view-1?task=1'],
      flushDocumentSaves,
    });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete Saved View' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete View' }));

    await waitFor(() => expect(flushDocumentSaves).toHaveBeenCalledOnce());
    expect(mocks.deleteSavedView).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Current location')).toHaveTextContent(
      '/w/workspace-1/views/view-1?task=1',
    );
  });

  it('returns a direct View route to Project Overview when Views are disabled', async () => {
    mocks.listProjects.mockResolvedValueOnce([disabledViewsProject]);
    mocks.getSavedView.mockRejectedValueOnce(
      new ApiError(
        422,
        'validation_error',
        'Saved Views are disabled for this Project',
      ),
    );

    renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-1/p/project-1/views/view-1'],
    });

    await waitFor(() =>
      expect(screen.getByLabelText('Current location')).toHaveTextContent(
        /^\/w\/workspace-1\/p\/project-1$/,
      ),
    );
  });

  it('returns a malformed View identity to its Project Views parent', async () => {
    mocks.listProjects.mockResolvedValueOnce([enabledViewsProject]);
    mocks.getSavedView.mockRejectedValueOnce(
      new ApiError(422, 'validation_error', 'Resource ID is invalid'),
    );

    renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-1/p/project-2/views/not-a-uuid'],
    });

    await waitFor(() =>
      expect(screen.getByLabelText('Current location')).toHaveTextContent(
        /^\/w\/workspace-1\/p\/project-2\/views$/,
      ),
    );
  });

  it('does not request View detail through a missing routed Project', async () => {
    mocks.listProjects.mockResolvedValueOnce([]);

    renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-1/p/project-1/views/view-1'],
    });

    await waitFor(() =>
      expect(screen.getByLabelText('Current location')).toHaveTextContent(
        /^\/w\/workspace-1\/my-work$/,
      ),
    );
    expect(mocks.getSavedView).not.toHaveBeenCalled();
  });

  it('does not request View detail through an unjoined Open Project', async () => {
    mocks.listProjects.mockResolvedValueOnce([
      {
        ...enabledViewsProject,
        visibility: 'public',
        effective_role: null,
        can_join: true,
      },
    ]);

    renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-1/p/project-2/views/view-1'],
    });

    await waitFor(() =>
      expect(screen.getByLabelText('Current location')).toHaveTextContent(
        /^\/w\/workspace-1\/p\/project-2$/,
      ),
    );
    expect(mocks.getSavedView).not.toHaveBeenCalled();
  });

  it('still corrects a View from a disabled routed Project to its enabled scope', async () => {
    mocks.listProjects.mockResolvedValueOnce([
      disabledViewsProject,
      enabledViewsProject,
    ]);
    mocks.getSavedView.mockResolvedValueOnce({
      ...savedView,
      project_id: enabledViewsProject.id,
      query: createTaskQuery({
        kind: 'project',
        projectId: enabledViewsProject.id,
      }),
    });

    renderWorkspaceRoutes({
      initialEntries: ['/w/workspace-1/p/project-1/views/view-1'],
    });

    await waitFor(() =>
      expect(screen.getByLabelText('Current location')).toHaveTextContent(
        /^\/w\/workspace-1\/p\/project-2\/views\/view-1$/,
      ),
    );
  });
});

function renderWorkspaceRoutes({
  initialEntries,
  flushDocumentSaves = vi.fn().mockResolvedValue(undefined),
  routeUser = user,
  seededWorkspaces,
  seededProjects,
}: {
  initialEntries: InitialEntry[];
  flushDocumentSaves?: () => Promise<void>;
  routeUser?: User;
  seededWorkspaces?: Workspace[];
  seededProjects?: Project[];
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  queryClient.setQueryDefaults(['workspaces'], { staleTime: 15_000 });
  queryClient.setQueryData(['session', 'http://server.test', 'token'], {
    expires_at: '2026-10-01T00:00:00Z',
    user: routeUser,
  });
  if (seededWorkspaces) {
    queryClient.setQueryData(
      ['workspaces', 'http://server.test', 'token'],
      seededWorkspaces,
      { updatedAt: 0 },
    );
  }
  if (seededProjects) {
    queryClient.setQueryData(['projects', 'workspace-1'], seededProjects, {
      updatedAt: 0,
    });
  }
  const shellProps = {
    serverUrl: 'http://server.test',
    token: 'token',
    user: routeUser,
    accountSessions: [],
    accountTransitioning: false,
    accountError: null,
    onSwitchAccount: vi.fn(),
    onAddAccount: vi.fn(),
    onDismissAccountError: vi.fn(),
    onSignOut: vi.fn(),
    flushDocumentSaves,
  };

  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/sentinel" element={<output>Sentinel</output>} />
          <Route
            path="/"
            element={<WorkspaceRouteScreen routeKind="root" {...shellProps} />}
          />
          <Route
            path="/w/:workspaceIdentifier/my-work"
            element={
              <WorkspaceRouteScreen routeKind="my-work" {...shellProps} />
            }
          />
          <Route
            path="/w/:workspaceIdentifier/tasks"
            element={
              <WorkspaceRouteScreen routeKind="all-tasks" {...shellProps} />
            }
          />
          <Route
            path="/w/:workspaceIdentifier/views/:viewId"
            element={
              <WorkspaceRouteScreen
                routeKind="workspace-view"
                {...shellProps}
              />
            }
          />
          <Route
            path="/w/:workspaceIdentifier/settings/workspace/:section"
            element={
              <WorkspaceRouteScreen
                routeKind="workspace-settings"
                {...shellProps}
              />
            }
          />
          <Route
            path="/w/:workspaceIdentifier/settings/account/:section"
            element={
              <WorkspaceRouteScreen
                routeKind="account-settings"
                {...shellProps}
              />
            }
          />
          <Route
            path="/w/:workspaceIdentifier/p/:projectIdentifier"
            element={
              <WorkspaceRouteScreen
                routeKind="project-overview"
                {...shellProps}
              />
            }
          />
          <Route
            path="/w/:workspaceIdentifier/p/:projectIdentifier/work-items"
            element={
              <WorkspaceRouteScreen
                routeKind="project-work-items"
                {...shellProps}
              />
            }
          />
          <Route
            path="/w/:workspaceIdentifier/p/:projectIdentifier/settings/:section"
            element={
              <WorkspaceRouteScreen
                routeKind="project-settings"
                {...shellProps}
              />
            }
          />
          <Route
            path="/w/:workspaceIdentifier/p/:projectIdentifier/cycles"
            element={
              <WorkspaceRouteScreen
                routeKind="project-cycles"
                {...shellProps}
              />
            }
          />
          <Route
            path="/w/:workspaceIdentifier/p/:projectIdentifier/cycles/:cycleId"
            element={
              <WorkspaceRouteScreen
                routeKind="project-cycles"
                {...shellProps}
              />
            }
          />
          <Route
            path="/w/:workspaceIdentifier/p/:projectIdentifier/modules"
            element={
              <WorkspaceRouteScreen
                routeKind="project-modules"
                {...shellProps}
              />
            }
          />
          <Route
            path="/w/:workspaceIdentifier/p/:projectIdentifier/modules/:moduleId"
            element={
              <WorkspaceRouteScreen
                routeKind="project-modules"
                {...shellProps}
              />
            }
          />
          <Route
            path="/w/:workspaceIdentifier/p/:projectIdentifier/library"
            element={
              <WorkspaceRouteScreen
                routeKind="project-library"
                {...shellProps}
              />
            }
          />
          <Route
            path="/w/:workspaceIdentifier/p/:projectIdentifier/library/:documentId"
            element={
              <WorkspaceRouteScreen
                routeKind="project-library"
                {...shellProps}
              />
            }
          />
          <Route
            path="/w/:workspaceIdentifier/p/:projectIdentifier/views"
            element={
              <WorkspaceRouteScreen routeKind="project-views" {...shellProps} />
            }
          />
          <Route
            path="/w/:workspaceIdentifier/p/:projectIdentifier/views/:viewId"
            element={
              <WorkspaceRouteScreen routeKind="project-view" {...shellProps} />
            }
          />
          <Route
            path="/w/:workspaceIdentifier/library"
            element={
              <WorkspaceRouteScreen
                routeKind="workspace-library"
                {...shellProps}
              />
            }
          />
          <Route
            path="/w/:workspaceIdentifier/library/:documentId"
            element={
              <WorkspaceRouteScreen
                routeKind="workspace-library"
                {...shellProps}
              />
            }
          />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <aside>
      <output aria-label="Current location">
        {location.pathname}
        {location.search}
      </output>
      <output aria-label="Router state">
        {JSON.stringify(location.state)}
      </output>
      <output aria-label="Location key">{location.key}</output>
      <button type="button" onClick={() => navigate(-1)}>
        Go back
      </button>
      <button type="button" onClick={() => navigate('/w/workspace-4/my-work')}>
        Open workspace C
      </button>
    </aside>
  );
}

function workspace(id: string, name: string, identifier = id): Workspace {
  return {
    id,
    identifier,
    name,
    accent: 'sage',
    role: 'owner',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
