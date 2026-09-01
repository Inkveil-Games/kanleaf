import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  type InitialEntry,
} from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project, Task, Workspace } from './types';
import type { WorkspaceReplacementLocation } from './workspaceLocation';
import { WorkspaceRouteScreen } from './WorkspaceRouteScreen';
import {
  workspaceLocationFromRoute,
  workspaceLocationPath,
} from './workspaceRouteAdapter';

const mocks = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  listProjects: vi.fn(),
  getTask: vi.fn(),
  getTaskByNumber: vi.fn(),
}));

vi.mock('./api', () => ({
  listWorkspaces: mocks.listWorkspaces,
  listProjects: mocks.listProjects,
  getTask: mocks.getTask,
  getTaskByNumber: mocks.getTaskByNumber,
}));

vi.mock('./WorkspaceShell', () => ({
  WorkspaceShell: ({
    location,
    onNavigate,
    workspaceAccessVerified,
  }: {
    location: WorkspaceReplacementLocation | null;
    onNavigate: (
      location: WorkspaceReplacementLocation,
      options?: { replace?: boolean },
    ) => void;
    workspaceAccessVerified: boolean;
  }) => (
    <div>
      <output aria-label="Workspace location">
        {JSON.stringify(location)}
      </output>
      <output aria-label="Workspace access verified">
        {String(workspaceAccessVerified)}
      </output>
      <button
        type="button"
        onClick={() => {
          if (!location || location.kind !== 'my-work') return;
          onNavigate({
            kind: 'account-settings',
            workspaceId: location.workspaceId,
            section: 'profile',
            returnTo: location,
          });
        }}
      >
        Open Settings
      </button>
      <button
        type="button"
        onClick={() => {
          if (!location || location.kind !== 'workspace-view') return;
          onNavigate(location);
        }}
      >
        Repeat location
      </button>
      <button
        type="button"
        onClick={() =>
          onNavigate({
            kind: 'my-work',
            workspaceId: 'workspace-2',
            taskId: null,
          })
        }
      >
        Open second Workspace
      </button>
      <button
        type="button"
        onClick={() =>
          onNavigate({
            kind: 'my-work',
            workspaceId: 'missing-workspace',
            taskId: null,
          })
        }
      >
        Open missing Workspace
      </button>
    </div>
  ),
}));

const workspaces = [
  {
    id: 'workspace-1',
    identifier: 'kanleaf-core',
    name: 'Kanleaf Core',
    accent: 'sage',
    role: 'owner',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  },
  {
    id: 'workspace-2',
    identifier: 'another-team',
    name: 'Another Team',
    accent: 'blue',
    role: 'member',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  },
] as const;

const projects: Project[] = [
  {
    id: 'project-1',
    workspace_id: 'workspace-1',
    name: 'Project One',
    identifier: 'project-one',
    description: '',
    icon: 'folder',
    lead_user_id: null,
    visibility: 'private',
    default_assignee_id: null,
    default_state_id: 'state-1',
    default_task_type_id: 'type-1',
    cycles_enabled: true,
    modules_enabled: true,
    pages_enabled: true,
    views_enabled: true,
    enabled_task_type_ids: ['type-1'],
    effective_role: 'admin',
    can_join: false,
    archived_at: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  },
  {
    id: 'project-2',
    workspace_id: 'workspace-1',
    name: 'Project Two',
    identifier: 'project-two',
    description: '',
    icon: 'target',
    lead_user_id: null,
    visibility: 'private',
    default_assignee_id: null,
    default_state_id: 'state-1',
    default_task_type_id: 'type-1',
    cycles_enabled: true,
    modules_enabled: true,
    pages_enabled: true,
    views_enabled: true,
    enabled_task_type_ids: ['type-1'],
    effective_role: 'admin',
    can_join: false,
    archived_at: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  },
];

const task = {
  id: 'task-1',
  workspace_id: 'workspace-1',
  project_id: 'project-1',
  task_number: 42,
} as Task;

beforeEach(() => {
  mocks.listWorkspaces.mockReset();
  mocks.listProjects.mockReset();
  mocks.getTask.mockReset();
  mocks.getTaskByNumber.mockReset();
  mocks.listWorkspaces.mockResolvedValue(workspaces);
  mocks.listProjects.mockResolvedValue(projects);
  mocks.getTask.mockResolvedValue(task);
  mocks.getTaskByNumber.mockResolvedValue(task);
});

describe('workspaceLocationPath', () => {
  it.each([
    [{ kind: 'root' }, '/'],
    [
      {
        kind: 'workspace-view',
        workspaceId: 'workspace/1',
        viewId: 'view-1',
        taskId: 'task-1',
      },
      '/w/kanleaf-core/views/view-1?task=task-1',
    ],
    [
      {
        kind: 'account-settings',
        workspaceId: 'workspace-1',
        section: 'security',
        returnTo: null,
      },
      '/w/kanleaf-core/settings/account/security',
    ],
    [
      {
        kind: 'workspace-settings',
        workspaceId: 'workspace-1',
        section: 'task-types',
        returnTo: null,
      },
      '/w/kanleaf-core/settings/workspace/task-types',
    ],
    [
      {
        kind: 'project-settings',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        section: 'features',
        returnTo: null,
      },
      '/w/kanleaf-core/p/project-1/settings/features',
    ],
  ] as const)('serializes a typed location', (location, expected) => {
    expect(workspaceLocationPath(location, 'kanleaf-core')).toBe(expected);
  });
});

describe('workspaceLocationFromRoute', () => {
  it.each([
    ['root', {}, '', null, null],
    [
      'my-work',
      { workspaceId: 'workspace-1' },
      '?task=task-1',
      null,
      {
        kind: 'my-work',
        workspaceId: 'workspace-1',
        taskId: 'task-1',
      },
    ],
    [
      'inbox',
      { workspaceId: 'workspace-1' },
      '',
      null,
      { kind: 'inbox', workspaceId: 'workspace-1', taskId: null },
    ],
    [
      'all-tasks',
      { workspaceId: 'workspace-1' },
      '',
      null,
      { kind: 'all-tasks', workspaceId: 'workspace-1', taskId: null },
    ],
    [
      'workspace-view',
      { workspaceId: 'workspace-1', viewId: 'view-1' },
      '?task=task-1',
      null,
      {
        kind: 'workspace-view',
        workspaceId: 'workspace-1',
        viewId: 'view-1',
        taskId: 'task-1',
      },
    ],
    [
      'workspace-library',
      { workspaceId: 'workspace-1', documentId: 'document-1' },
      '',
      null,
      {
        kind: 'workspace-library',
        workspaceId: 'workspace-1',
        documentId: 'document-1',
      },
    ],
    [
      'project-overview',
      { workspaceId: 'workspace-1', projectId: 'project-1' },
      '',
      null,
      {
        kind: 'project-overview',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
      },
    ],
    [
      'project-work-items',
      { workspaceId: 'workspace-1', projectId: 'project-1' },
      '?task=task-1',
      null,
      {
        kind: 'project-work-items',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        taskId: 'task-1',
      },
    ],
    [
      'project-cycles',
      {
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        cycleId: 'cycle-1',
      },
      '',
      null,
      {
        kind: 'project-cycles',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        cycleId: 'cycle-1',
      },
    ],
    [
      'project-modules',
      {
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        moduleId: 'module-1',
      },
      '',
      null,
      {
        kind: 'project-modules',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        moduleId: 'module-1',
      },
    ],
    [
      'project-library',
      {
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        documentId: 'document-1',
      },
      '',
      null,
      {
        kind: 'project-library',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        documentId: 'document-1',
      },
    ],
    [
      'project-views',
      { workspaceId: 'workspace-1', projectId: 'project-1' },
      '',
      null,
      {
        kind: 'project-views',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
      },
    ],
    [
      'project-view',
      {
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        viewId: 'view-1',
      },
      '',
      null,
      {
        kind: 'project-view',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        viewId: 'view-1',
        taskId: null,
      },
    ],
    [
      'account-settings',
      { workspaceId: 'workspace-1', section: 'security' },
      '',
      {
        kind: 'workspace-library',
        workspaceId: 'workspace-1',
        documentId: 'document-1',
      },
      {
        kind: 'account-settings',
        workspaceId: 'workspace-1',
        section: 'security',
        returnTo: {
          kind: 'workspace-library',
          workspaceId: 'workspace-1',
          documentId: 'document-1',
        },
      },
    ],
    [
      'workspace-settings',
      { workspaceId: 'workspace-1', section: 'members' },
      '',
      null,
      {
        kind: 'workspace-settings',
        workspaceId: 'workspace-1',
        section: 'members',
        returnTo: null,
      },
    ],
    [
      'project-settings',
      {
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        section: 'features',
      },
      '',
      null,
      {
        kind: 'project-settings',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        section: 'features',
        returnTo: null,
      },
    ],
  ] as const)(
    'maps the %s route without component navigation state',
    (kind, params, search, returnTo, expected) => {
      expect(
        workspaceLocationFromRoute(
          kind,
          kind === 'root' ? null : 'workspace-1',
          params,
          search,
          returnTo,
        ),
      ).toEqual(expected);
    },
  );

  it.each(['?task=', '?task=first&task=second'])(
    'does not expose a malformed Task selection from %s',
    (search) => {
      expect(
        workspaceLocationFromRoute(
          'my-work',
          'workspace-1',
          { workspaceId: 'workspace-1' },
          search,
          null,
        ),
      ).toEqual({
        kind: 'my-work',
        workspaceId: 'workspace-1',
        taskId: null,
      });
    },
  );

  it('uses the resolved UUID instead of the public route identifier internally', () => {
    expect(
      workspaceLocationFromRoute(
        'my-work',
        '58de9f28-cd96-411d-a1aa-61061fb15f55',
        { workspaceIdentifier: 'kanleaf-core' },
        '',
        null,
      ),
    ).toEqual({
      kind: 'my-work',
      workspaceId: '58de9f28-cd96-411d-a1aa-61061fb15f55',
      taskId: null,
    });
  });
});

describe('WorkspaceRouteScreen', () => {
  it('resolves the public identifier before exposing the UUID location', async () => {
    renderRouteScreen(
      '/w/kanleaf-core/my-work?task=42',
      'my-work',
      '/w/:workspaceIdentifier/my-work',
    );

    expect(await workspaceLocationOutput()).toHaveTextContent(
      JSON.stringify({
        kind: 'my-work',
        workspaceId: 'workspace-1',
        taskId: 'task-1',
      }),
    );
    expect(
      screen.getByLabelText('Workspace access verified'),
    ).toHaveTextContent('true');
  });

  it('upgrades a legacy Task UUID query to its public number', async () => {
    const legacyTaskId = 'c1bb77a2-56ca-4acd-95f7-3f030389fe17';
    mocks.getTask.mockResolvedValueOnce({ ...task, id: legacyTaskId });
    mocks.getTaskByNumber.mockResolvedValueOnce({
      ...task,
      id: legacyTaskId,
    });

    renderRouteScreen(
      `/w/kanleaf-core/p/project-one/work-items?task=${legacyTaskId}`,
      'project-work-items',
      '/w/:workspaceIdentifier/p/:projectIdentifier/work-items',
    );

    await waitFor(() =>
      expect(browserLocationOutput()).toHaveTextContent(
        '/w/kanleaf-core/p/project-one/work-items?task=42',
      ),
    );
    expect(mocks.getTask).toHaveBeenCalledWith(
      { serverUrl: 'https://kanleaf.example.com', token: 'token' },
      'workspace-1',
      legacyTaskId,
    );
    expect(await workspaceLocationOutput()).toHaveTextContent(
      `"taskId":"${legacyTaskId}"`,
    );
  });

  it('moves a Task opened under the wrong Project to its owning Project route', async () => {
    mocks.getTaskByNumber.mockResolvedValueOnce({
      ...task,
      project_id: 'project-2',
    });

    renderRouteScreen(
      '/w/kanleaf-core/p/project-one/work-items?task=42',
      'project-work-items',
      '/w/:workspaceIdentifier/p/:projectIdentifier/work-items',
    );

    await waitFor(() =>
      expect(browserLocationOutput()).toHaveTextContent(
        '/w/kanleaf-core/p/project-two/work-items?task=42',
      ),
    );
  });

  it('does not mount the scoped shell before Workspace access settles', () => {
    mocks.listWorkspaces.mockReturnValue(new Promise(() => undefined));

    renderRouteScreen(
      '/w/kanleaf-core/my-work',
      'my-work',
      '/w/:workspaceIdentifier/my-work',
    );

    expect(
      screen.queryByRole('status', { name: 'Workspace location' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Opening your workspace…')).toBeVisible();
  });

  it('does not trust cached membership until the route access refresh settles', async () => {
    let resolveRefresh!: (value: Workspace[]) => void;
    mocks.listWorkspaces.mockReturnValue(
      new Promise<Workspace[]>((resolve) => {
        resolveRefresh = resolve;
      }),
    );

    renderRouteScreen(
      '/w/kanleaf-core/my-work',
      'my-work',
      '/w/:workspaceIdentifier/my-work',
      [],
      workspaces,
    );

    expect(
      screen.queryByRole('status', { name: 'Workspace location' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Opening your workspace…')).toBeVisible();

    await act(async () => resolveRefresh([...workspaces]));
    expect(await workspaceLocationOutput()).toHaveTextContent(
      '"workspaceId":"workspace-1"',
    );
  });

  it('reads the route and validated Settings return target as UUID locations', async () => {
    renderRouteScreen(
      {
        pathname: '/w/kanleaf-core/settings/account/security',
        state: { returnTo: '/w/kanleaf-core/my-work?task=42' },
      },
      'account-settings',
      '/w/:workspaceIdentifier/settings/account/:section',
    );

    expect(await workspaceLocationOutput()).toHaveTextContent(
      JSON.stringify({
        kind: 'account-settings',
        workspaceId: 'workspace-1',
        section: 'security',
        returnTo: {
          kind: 'my-work',
          workspaceId: 'workspace-1',
          taskId: 'task-1',
        },
      }),
    );
  });

  it('rejects an external Settings return target', async () => {
    renderRouteScreen(
      {
        pathname: '/w/kanleaf-core/settings/account/security',
        state: {
          returnTo: 'https://malicious.example/w/kanleaf-core/my-work',
        },
      },
      'account-settings',
      '/w/:workspaceIdentifier/settings/account/:section',
    );

    expect(await workspaceLocationOutput()).toHaveTextContent(
      '"returnTo":null',
    );
  });

  it('serializes UUID navigation and Settings state with public identifiers', async () => {
    renderRouteScreen(
      '/w/kanleaf-core/my-work?task=42',
      'my-work',
      '/w/:workspaceIdentifier/my-work',
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open Settings' }),
    );

    expect(browserLocationOutput()).toHaveTextContent(
      '/w/kanleaf-core/settings/account/profile',
    );
    expect(routerStateOutput()).toHaveTextContent(
      JSON.stringify({
        returnTo: '/w/kanleaf-core/my-work?task=42',
      }),
    );
  });

  it('maps navigation for another Workspace UUID to that Workspace identifier', async () => {
    renderRouteScreen(
      '/w/kanleaf-core/my-work',
      'my-work',
      '/w/:workspaceIdentifier/my-work',
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open second Workspace' }),
    );

    expect(browserLocationOutput()).toHaveTextContent(
      '/w/another-team/my-work',
    );
    expect(browserLocationOutput()).not.toHaveTextContent('workspace-2');
  });

  it('never falls back to a UUID URL when the navigation target is absent', async () => {
    renderRouteScreen(
      '/w/kanleaf-core/my-work',
      'my-work',
      '/w/:workspaceIdentifier/my-work',
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open missing Workspace' }),
    );

    expect(browserLocationOutput()).toHaveTextContent(/^\/$/);
    expect(browserLocationOutput()).not.toHaveTextContent('missing-workspace');
  });

  it('does not add a duplicate entry when asked to navigate to the current location', async () => {
    renderRouteScreen(
      {
        pathname: '/w/kanleaf-core/views/view-1',
        search: '?task=42',
      },
      'workspace-view',
      '/w/:workspaceIdentifier/views/:viewId',
      ['/w/kanleaf-core/my-work'],
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Repeat location' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));

    expect(browserLocationOutput()).toHaveTextContent(
      '/w/kanleaf-core/my-work',
    );
  });

  it.each(['?task=', '?task=first&task=second', '?filter=unsupported'])(
    'replaces the noncanonical search %s',
    async (search) => {
      renderRouteScreen(
        `/w/kanleaf-core/my-work${search}`,
        'my-work',
        '/w/:workspaceIdentifier/my-work',
      );

      await waitFor(() =>
        expect(browserLocationOutput()).toHaveTextContent(
          /^\/w\/kanleaf-core\/my-work$/,
        ),
      );
    },
  );

  it('replaces an unknown identifier only after access settles', async () => {
    renderRouteScreen(
      '/w/unknown-team/my-work?task=42',
      'my-work',
      '/w/:workspaceIdentifier/my-work',
    );

    await waitFor(() =>
      expect(browserLocationOutput()).toHaveTextContent(/^\/$/),
    );
  });

  it('keeps the requested URL and offers retry after an access error', async () => {
    mocks.listWorkspaces
      .mockRejectedValueOnce(new Error('Workspace access failed'))
      .mockResolvedValueOnce(workspaces);
    renderRouteScreen(
      '/w/kanleaf-core/my-work',
      'my-work',
      '/w/:workspaceIdentifier/my-work',
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Workspace access failed',
    );
    expect(browserLocationOutput()).toHaveTextContent(
      '/w/kanleaf-core/my-work',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await workspaceLocationOutput()).toHaveTextContent(
      '"workspaceId":"workspace-1"',
    );
  });
});

function renderRouteScreen(
  entry: InitialEntry,
  routeKind: Parameters<typeof WorkspaceRouteScreen>[0]['routeKind'],
  pattern: string,
  earlierEntries: InitialEntry[] = [],
  seededWorkspaces?: readonly Workspace[],
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: 15_000 },
    },
  });
  if (seededWorkspaces) {
    queryClient.setQueryData(
      ['workspaces', 'https://kanleaf.example.com', 'token'],
      [...seededWorkspaces],
    );
  }
  const shellProps = {
    serverUrl: 'https://kanleaf.example.com',
    token: 'token',
    user: {
      id: 'user-1',
      email: 'user@example.com',
      display_name: 'User',
      is_host: false,
      theme: 'system' as const,
      timezone: 'UTC',
      week_start: 'monday' as const,
      date_format: 'locale' as const,
      active_workspace_id: 'workspace-1',
      setup_stage: 'complete' as const,
    },
    accountSessions: [],
    accountTransitioning: false,
    accountError: null,
    onSwitchAccount: () => undefined,
    onAddAccount: () => undefined,
    onDismissAccountError: () => undefined,
    onSignOut: () => undefined,
    flushDocumentSaves: () => Promise.resolve(),
  };

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[...earlierEntries, entry]}>
        <Routes>
          <Route path="/" element={<output>Root fallback</output>} />
          <Route
            path={pattern}
            element={
              <WorkspaceRouteScreen routeKind={routeKind} {...shellProps} />
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
            path="/w/:workspaceIdentifier/my-work"
            element={<output>My Work fallback</output>}
          />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div>
      <output aria-label="Browser location">
        {location.pathname}
        {location.search}
      </output>
      <output aria-label="Router state">
        {JSON.stringify(location.state)}
      </output>
      <button type="button" onClick={() => navigate(-1)}>
        Go back
      </button>
    </div>
  );
}

function workspaceLocationOutput() {
  return screen.findByRole('status', { name: 'Workspace location' });
}

function browserLocationOutput() {
  return screen.getByRole('status', { name: 'Browser location' });
}

function routerStateOutput() {
  return screen.getByRole('status', { name: 'Router state' });
}
