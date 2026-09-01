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
}));

vi.mock('../../features/workspace/api', () => ({
  listWorkspaces: mocks.listWorkspaces,
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
  mocks.listWorkspaces.mockResolvedValue(workspaces);
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
      '/kanleaf-core/my-work?task=task-1',
      {
        kind: 'my-work',
        workspaceId: 'workspace-1',
        taskId: 'task-1',
      },
    ],
    [
      '/kanleaf-core/inbox',
      { kind: 'inbox', workspaceId: 'workspace-1', taskId: null },
    ],
    [
      '/kanleaf-core/tasks',
      { kind: 'all-tasks', workspaceId: 'workspace-1', taskId: null },
    ],
    [
      '/kanleaf-core/views/view-1',
      {
        kind: 'workspace-view',
        workspaceId: 'workspace-1',
        viewId: 'view-1',
        taskId: null,
      },
    ],
    [
      '/kanleaf-core/library',
      {
        kind: 'workspace-library',
        workspaceId: 'workspace-1',
        documentId: null,
      },
    ],
    [
      '/kanleaf-core/library/document-1',
      {
        kind: 'workspace-library',
        workspaceId: 'workspace-1',
        documentId: 'document-1',
      },
    ],
    [
      '/kanleaf-core/projects/project-1',
      {
        kind: 'project-overview',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
      },
    ],
    [
      '/kanleaf-core/projects/project-1/work-items?task=task-1',
      {
        kind: 'project-work-items',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        taskId: 'task-1',
      },
    ],
    [
      '/kanleaf-core/projects/project-1/cycles',
      {
        kind: 'project-cycles',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        cycleId: null,
      },
    ],
    [
      '/kanleaf-core/projects/project-1/cycles/cycle-1',
      {
        kind: 'project-cycles',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        cycleId: 'cycle-1',
      },
    ],
    [
      '/kanleaf-core/projects/project-1/modules',
      {
        kind: 'project-modules',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        moduleId: null,
      },
    ],
    [
      '/kanleaf-core/projects/project-1/modules/module-1',
      {
        kind: 'project-modules',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        moduleId: 'module-1',
      },
    ],
    [
      '/kanleaf-core/projects/project-1/library',
      {
        kind: 'project-library',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        documentId: null,
      },
    ],
    [
      '/kanleaf-core/projects/project-1/library/document-1',
      {
        kind: 'project-library',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        documentId: 'document-1',
      },
    ],
    [
      '/kanleaf-core/projects/project-1/views',
      {
        kind: 'project-views',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
      },
    ],
    [
      '/kanleaf-core/projects/project-1/views/view-1',
      {
        kind: 'project-view',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        viewId: 'view-1',
        taskId: null,
      },
    ],
    [
      '/kanleaf-core/settings/account/security',
      {
        kind: 'account-settings',
        workspaceId: 'workspace-1',
        section: 'security',
        returnTo: null,
      },
    ],
    [
      '/kanleaf-core/settings/workspace/members',
      {
        kind: 'workspace-settings',
        workspaceId: 'workspace-1',
        section: 'members',
        returnTo: null,
      },
    ],
    [
      '/kanleaf-core/projects/project-1/settings/features',
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
    ['/kanleaf-core', '/kanleaf-core/my-work'],
    ['/kanleaf-core/not-a-route', '/kanleaf-core/my-work'],
    ['/not-a-route', '/'],
  ])('replaces %s with %s', async (path, expected) => {
    renderAuthenticatedRoutes(path);

    await waitFor(() =>
      expect(browserLocationOutput()).toHaveTextContent(expected),
    );
  });

  it('redirects a legacy UUID URL through membership and preserves suffix, query, and hash', async () => {
    renderAuthenticatedRoutes(
      '/w/workspace-1/my-work?task=task-1#selected-task',
    );

    await waitFor(() =>
      expect(browserLocationOutput()).toHaveTextContent(
        '/kanleaf-core/my-work?task=task-1#selected-task',
      ),
    );
  });

  it('redirects a legacy Workspace index to its public My Work route', async () => {
    renderAuthenticatedRoutes('/w/workspace-1');

    await waitFor(() =>
      expect(browserLocationOutput()).toHaveTextContent(
        '/kanleaf-core/my-work',
      ),
    );
  });

  it('preserves encoded legacy path segments while replacing the prefix', async () => {
    renderAuthenticatedRoutes(
      '/w/workspace-1/views/view%2Fone?task=task-1#details',
    );

    await waitFor(() =>
      expect(browserLocationOutput()).toHaveTextContent(
        '/kanleaf-core/views/view%2Fone?task=task-1#details',
      ),
    );
    expect(await workspaceLocationOutput()).toHaveTextContent(
      '"viewId":"view/one"',
    );
    expect(browserLocationOutput()).toHaveTextContent(
      '/kanleaf-core/views/view%2Fone?task=task-1#details',
    );
  });

  it('does not disclose an unauthorized legacy Workspace UUID', async () => {
    renderAuthenticatedRoutes('/w/missing-workspace/tasks?task=task-1#task');

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
