import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceLocation } from '../../features/workspace/workspaceLocation';
import { AuthenticatedRoutes } from './AuthenticatedRoutes';

vi.mock('../../features/workspace/WorkspaceShell', () => ({
  WorkspaceShell: ({ location }: { location: WorkspaceLocation | null }) => (
    <output aria-label="Workspace location">{JSON.stringify(location)}</output>
  ),
}));

vi.mock('../../features/host/HostConsole', () => ({
  HostConsole: () => <output aria-label="Host Console">Host Console</output>,
}));

const mocks = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  listProjects: vi.fn(),
  getTaskByNumber: vi.fn(),
  getDocument: vi.fn(),
  getDocumentByNumber: vi.fn(),
}));

vi.mock('../../features/workspace/api', () => ({
  listWorkspaces: mocks.listWorkspaces,
  listProjects: mocks.listProjects,
  getTaskByNumber: mocks.getTaskByNumber,
}));

vi.mock('../../features/document/api', () => ({
  getDocument: mocks.getDocument,
  getDocumentByNumber: mocks.getDocumentByNumber,
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
] as const;

beforeEach(() => {
  mocks.listWorkspaces.mockReset();
  mocks.listProjects.mockReset();
  mocks.getTaskByNumber.mockReset();
  mocks.getDocument.mockReset();
  mocks.getDocumentByNumber.mockReset();
  mocks.listWorkspaces.mockResolvedValue(workspaces);
  mocks.listProjects.mockResolvedValue([
    {
      id: 'project-1',
      workspace_id: 'workspace-1',
      identifier: 'project-one',
    },
  ]);
  mocks.getTaskByNumber.mockResolvedValue({
    id: 'task-1',
    workspace_id: 'workspace-1',
    project_id: 'project-1',
    task_number: 42,
  });
  mocks.getDocument.mockResolvedValue({
    id: 'document-1',
    document_number: 42,
    workspace_id: 'workspace-1',
    project_id: null,
  });
  mocks.getDocumentByNumber.mockImplementation(
    (_context, _workspaceId, documentNumber: number) =>
      Promise.resolve({
        id: 'document-1',
        document_number: documentNumber,
        workspace_id: 'workspace-1',
        project_id: documentNumber === 43 ? 'project-1' : null,
      }),
  );
});

describe('AuthenticatedRoutes Workspace tree', () => {
  it('gates every authenticated route behind the server-owned setup stage', async () => {
    renderAuthenticatedRoutes('/host', {
      setupStage: 'workspace',
      isHost: true,
    });

    await waitFor(() =>
      expect(browserLocationOutput()).toHaveTextContent('/setup/workspace'),
    );
    expect(
      screen.getByRole('heading', {
        name: 'Create a home for your work, or join one',
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('status', { name: 'Host Console' }),
    ).not.toBeInTheDocument();
  });

  it('does not let a completed account return to setup routes', async () => {
    renderAuthenticatedRoutes('/setup/account');

    await waitFor(() =>
      expect(browserLocationOutput()).toHaveTextContent(/^\/$/),
    );
    expect(
      screen.queryByRole('heading', { name: 'Make Kanleaf feel like yours' }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ['/', null],
    [
      '/w/kanleaf-core/my-work?task=42',
      {
        kind: 'my-work',
        workspaceId: 'workspace-1',
        taskId: 'task-1',
      },
    ],
    [
      '/w/kanleaf-core/inbox',
      { kind: 'inbox', workspaceId: 'workspace-1', taskId: null },
    ],
    [
      '/w/kanleaf-core/tasks',
      { kind: 'all-tasks', workspaceId: 'workspace-1', taskId: null },
    ],
    [
      '/w/kanleaf-core/views/view-1',
      {
        kind: 'workspace-view',
        workspaceId: 'workspace-1',
        viewId: 'view-1',
        taskId: null,
      },
    ],
    [
      '/w/kanleaf-core/library',
      {
        kind: 'workspace-library',
        workspaceId: 'workspace-1',
        documentId: null,
      },
    ],
    [
      '/w/kanleaf-core/library?page=42',
      {
        kind: 'workspace-library',
        workspaceId: 'workspace-1',
        documentId: 'document-1',
      },
    ],
    [
      '/w/kanleaf-core/p/project-one',
      {
        kind: 'project-overview',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
      },
    ],
    [
      '/w/kanleaf-core/p/project-one/work-items?task=42',
      {
        kind: 'project-work-items',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        taskId: 'task-1',
      },
    ],
    [
      '/w/kanleaf-core/p/project-one/cycles',
      {
        kind: 'project-cycles',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        cycleId: null,
      },
    ],
    [
      '/w/kanleaf-core/p/project-one/cycles/cycle-1',
      {
        kind: 'project-cycles',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        cycleId: 'cycle-1',
      },
    ],
    [
      '/w/kanleaf-core/p/project-one/modules',
      {
        kind: 'project-modules',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        moduleId: null,
      },
    ],
    [
      '/w/kanleaf-core/p/project-one/modules/module-1',
      {
        kind: 'project-modules',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        moduleId: 'module-1',
      },
    ],
    [
      '/w/kanleaf-core/p/project-one/library',
      {
        kind: 'project-library',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        documentId: null,
      },
    ],
    [
      '/w/kanleaf-core/p/project-one/library?page=43',
      {
        kind: 'project-library',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        documentId: 'document-1',
      },
    ],
    [
      '/w/kanleaf-core/p/project-one/views',
      {
        kind: 'project-views',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
      },
    ],
    [
      '/w/kanleaf-core/p/project-one/views/view-1',
      {
        kind: 'project-view',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        viewId: 'view-1',
        taskId: null,
      },
    ],
    [
      '/w/kanleaf-core/settings/account/security',
      {
        kind: 'account-settings',
        workspaceId: 'workspace-1',
        section: 'security',
        returnTo: null,
      },
    ],
    [
      '/w/kanleaf-core/settings/workspace/members',
      {
        kind: 'workspace-settings',
        workspaceId: 'workspace-1',
        section: 'members',
        returnTo: null,
      },
    ],
    [
      '/w/kanleaf-core/p/project-one/settings/features',
      {
        kind: 'project-settings',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        section: 'features',
        returnTo: null,
      },
    ],
  ] as const)(
    'maps %s to its typed Workspace location',
    async (path, expected) => {
      renderAuthenticatedRoutes(path);

      expect(await workspaceLocationOutput()).toHaveTextContent(
        JSON.stringify(expected),
      );
    },
  );

  it.each([
    ['/kanleaf-core', '/w/kanleaf-core/my-work'],
    ['/kanleaf-core/not-a-route', '/w/kanleaf-core/my-work'],
    ['/not-a-route', '/'],
  ])('replaces %s with %s', async (path, expected) => {
    renderAuthenticatedRoutes(path);

    await waitFor(() =>
      expect(browserLocationOutput()).toHaveTextContent(expected),
    );
  });

  it('redirects a legacy UUID URL through membership and preserves suffix, query, and hash', async () => {
    renderAuthenticatedRoutes('/w/workspace-1/my-work?task=42#selected-task');

    await waitFor(() =>
      expect(browserLocationOutput()).toHaveTextContent(
        '/w/kanleaf-core/my-work?task=42#selected-task',
      ),
    );
  });

  it('redirects a legacy Workspace index to its public My Work route', async () => {
    renderAuthenticatedRoutes('/w/workspace-1');

    await waitFor(() =>
      expect(browserLocationOutput()).toHaveTextContent(
        '/w/kanleaf-core/my-work',
      ),
    );
  });

  it('preserves encoded legacy path segments while replacing the prefix', async () => {
    renderAuthenticatedRoutes(
      '/w/workspace-1/views/view%2Fone?task=42#details',
    );

    await waitFor(() =>
      expect(browserLocationOutput()).toHaveTextContent(
        '/w/kanleaf-core/views/view%2Fone?task=42#details',
      ),
    );
    expect(await workspaceLocationOutput()).toHaveTextContent(
      '"viewId":"view/one"',
    );
    expect(browserLocationOutput()).toHaveTextContent(
      '/w/kanleaf-core/views/view%2Fone?task=42#details',
    );
  });

  it.each([
    [
      '/kanleaf-core/projects/project-1/work-items?task=42#details',
      '/w/kanleaf-core/p/project-one/work-items?task=42#details',
    ],
    [
      '/w/workspace-1/projects/project-1/library/c1e959d6-2174-4901-bd55-772d8ce4eb37#note',
      '/w/kanleaf-core/library?page=42#note',
    ],
  ])('upgrades the legacy Project URL %s', async (path, expected) => {
    renderAuthenticatedRoutes(path);

    await waitFor(() =>
      expect(browserLocationOutput()).toHaveTextContent(expected),
    );
  });

  it('does not disclose an unavailable Project from a legacy URL', async () => {
    renderAuthenticatedRoutes(
      '/kanleaf-core/projects/missing-project/work-items?task=42',
    );

    await waitFor(() =>
      expect(browserLocationOutput()).toHaveTextContent(
        '/w/kanleaf-core/my-work',
      ),
    );
    expect(browserLocationOutput()).not.toHaveTextContent('missing-project');
  });

  it('does not disclose an unauthorized legacy Workspace UUID', async () => {
    renderAuthenticatedRoutes('/w/missing-workspace/tasks?task=42#task');

    await waitFor(() =>
      expect(browserLocationOutput()).toHaveTextContent(/^\/$/),
    );
    expect(browserLocationOutput()).not.toHaveTextContent('missing-workspace');
  });
});

function renderAuthenticatedRoutes(
  initialEntry: string,
  options: {
    setupStage?: 'account' | 'workspace' | 'invite' | 'complete';
    isHost?: boolean;
  } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: 15_000 },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <AuthenticatedRoutes
          serverUrl="https://kanleaf.example.com"
          token="token"
          user={{
            id: 'user-1',
            email: 'user@example.com',
            display_name: 'User',
            is_host: options.isHost ?? false,
            theme: 'system',
            timezone: 'UTC',
            week_start: 'monday',
            date_format: 'locale',
            active_workspace_id: 'workspace-1',
            setup_stage: options.setupStage ?? 'complete',
          }}
          accountSessions={[]}
          accountTransitioning={false}
          accountError={null}
          onSwitchAccount={() => undefined}
          onAddAccount={() => undefined}
          onDismissAccountError={() => undefined}
          onSignOut={() => undefined}
          onSessionChanged={() => Promise.resolve()}
          flushDocumentSaves={() => Promise.resolve()}
        />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return (
    <output aria-label="Browser location">
      {location.pathname}
      {location.search}
      {location.hash}
    </output>
  );
}

function workspaceLocationOutput() {
  return screen.findByRole('status', { name: 'Workspace location' });
}

function browserLocationOutput() {
  return screen.getByRole('status', { name: 'Browser location' });
}
