import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceLocation } from '../../features/workspace/workspaceLocation';
import { AuthenticatedRoutes } from './AuthenticatedRoutes';

vi.mock('../../features/workspace/WorkspaceShell', () => ({
  WorkspaceShell: ({ location }: { location: WorkspaceLocation | null }) => (
    <output aria-label="Workspace location">{JSON.stringify(location)}</output>
  ),
}));

describe('AuthenticatedRoutes Workspace tree', () => {
  it.each([
    ['/', null],
    [
      '/w/workspace-1/my-work?task=task-1',
      {
        kind: 'my-work',
        workspaceId: 'workspace-1',
        taskId: 'task-1',
      },
    ],
    [
      '/w/workspace-1/inbox',
      { kind: 'inbox', workspaceId: 'workspace-1', taskId: null },
    ],
    [
      '/w/workspace-1/tasks',
      { kind: 'all-tasks', workspaceId: 'workspace-1', taskId: null },
    ],
    [
      '/w/workspace-1/views/view-1',
      {
        kind: 'workspace-view',
        workspaceId: 'workspace-1',
        viewId: 'view-1',
        taskId: null,
      },
    ],
    [
      '/w/workspace-1/library',
      {
        kind: 'workspace-library',
        workspaceId: 'workspace-1',
        documentId: null,
      },
    ],
    [
      '/w/workspace-1/library/document-1',
      {
        kind: 'workspace-library',
        workspaceId: 'workspace-1',
        documentId: 'document-1',
      },
    ],
    [
      '/w/workspace-1/projects/project-1',
      {
        kind: 'project-overview',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
      },
    ],
    [
      '/w/workspace-1/projects/project-1/work-items?task=task-1',
      {
        kind: 'project-work-items',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        taskId: 'task-1',
      },
    ],
    [
      '/w/workspace-1/projects/project-1/cycles',
      {
        kind: 'project-cycles',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        cycleId: null,
      },
    ],
    [
      '/w/workspace-1/projects/project-1/cycles/cycle-1',
      {
        kind: 'project-cycles',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        cycleId: 'cycle-1',
      },
    ],
    [
      '/w/workspace-1/projects/project-1/modules',
      {
        kind: 'project-modules',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        moduleId: null,
      },
    ],
    [
      '/w/workspace-1/projects/project-1/modules/module-1',
      {
        kind: 'project-modules',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        moduleId: 'module-1',
      },
    ],
    [
      '/w/workspace-1/projects/project-1/library',
      {
        kind: 'project-library',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        documentId: null,
      },
    ],
    [
      '/w/workspace-1/projects/project-1/library/document-1',
      {
        kind: 'project-library',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        documentId: 'document-1',
      },
    ],
    [
      '/w/workspace-1/projects/project-1/views',
      {
        kind: 'project-views',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
      },
    ],
    [
      '/w/workspace-1/projects/project-1/views/view-1',
      {
        kind: 'project-view',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        viewId: 'view-1',
        taskId: null,
      },
    ],
    [
      '/w/workspace-1/settings/account/security',
      {
        kind: 'account-settings',
        workspaceId: 'workspace-1',
        section: 'security',
        returnTo: null,
      },
    ],
    [
      '/w/workspace-1/settings/workspace/members',
      {
        kind: 'workspace-settings',
        workspaceId: 'workspace-1',
        section: 'members',
        returnTo: null,
      },
    ],
    [
      '/w/workspace-1/projects/project-1/settings/features',
      {
        kind: 'project-settings',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        section: 'features',
        returnTo: null,
      },
    ],
  ] as const)('maps %s to its typed Workspace location', (path, expected) => {
    renderAuthenticatedRoutes(path);

    expect(workspaceLocationOutput()).toHaveTextContent(
      JSON.stringify(expected),
    );
  });

  it.each([
    ['/w/workspace-1', '/w/workspace-1/my-work'],
    ['/w/workspace-1/not-a-route', '/w/workspace-1/my-work'],
    ['/not-a-route', '/'],
  ])('replaces %s with %s', async (path, expected) => {
    renderAuthenticatedRoutes(path);

    await waitFor(() =>
      expect(browserLocationOutput()).toHaveTextContent(expected),
    );
  });
});

function renderAuthenticatedRoutes(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AuthenticatedRoutes
        serverUrl="https://kanleaf.example.com"
        token="token"
        user={{
          id: 'user-1',
          email: 'user@example.com',
          display_name: 'User',
          is_host: false,
          theme: 'system',
          timezone: 'UTC',
          week_start: 'monday',
          date_format: 'locale',
          active_workspace_id: 'workspace-1',
        }}
        accountSessions={[]}
        accountTransitioning={false}
        accountError={null}
        onSwitchAccount={() => undefined}
        onAddAccount={() => undefined}
        onDismissAccountError={() => undefined}
        onSignOut={() => undefined}
        flushDocumentSaves={() => Promise.resolve()}
      />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return (
    <output aria-label="Browser location">
      {location.pathname}
      {location.search}
    </output>
  );
}

function workspaceLocationOutput() {
  return screen.getByRole('status', { name: 'Workspace location' });
}

function browserLocationOutput() {
  return screen.getByRole('status', { name: 'Browser location' });
}
