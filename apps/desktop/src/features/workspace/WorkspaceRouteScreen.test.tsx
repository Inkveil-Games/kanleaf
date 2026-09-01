import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  type InitialEntry,
} from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceReplacementLocation } from './workspaceLocation';
import { WorkspaceRouteScreen } from './WorkspaceRouteScreen';
import {
  workspaceLocationFromRoute,
  workspaceLocationPath,
} from './workspaceRouteAdapter';

vi.mock('./WorkspaceShell', () => ({
  WorkspaceShell: ({
    location,
    onNavigate,
  }: {
    location: WorkspaceReplacementLocation | null;
    onNavigate: (
      location: WorkspaceReplacementLocation,
      options?: { replace?: boolean },
    ) => void;
  }) => (
    <div>
      <output aria-label="Workspace location">
        {JSON.stringify(location)}
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
    </div>
  ),
}));

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
      '/w/workspace%2F1/views/view-1?task=task-1',
    ],
    [
      {
        kind: 'account-settings',
        workspaceId: 'workspace-1',
        section: 'security',
        returnTo: null,
      },
      '/w/workspace-1/settings/account/security',
    ],
    [
      {
        kind: 'workspace-settings',
        workspaceId: 'workspace-1',
        section: 'task-types',
        returnTo: null,
      },
      '/w/workspace-1/settings/workspace/task-types',
    ],
    [
      {
        kind: 'project-settings',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        section: 'features',
        returnTo: null,
      },
      '/w/workspace-1/projects/project-1/settings/features',
    ],
  ] as const)('serializes a typed location', (location, expected) => {
    expect(workspaceLocationPath(location)).toBe(expected);
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
        workspaceLocationFromRoute(kind, params, search, returnTo),
      ).toEqual(expected);
    },
  );

  it.each(['?task=', '?task=first&task=second'])(
    'does not expose a malformed Task selection from %s',
    (search) => {
      expect(
        workspaceLocationFromRoute(
          'my-work',
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
});

describe('WorkspaceRouteScreen', () => {
  it('reads the route, task search parameter, and validated Settings return target', () => {
    renderRouteScreen(
      {
        pathname: '/w/workspace-1/settings/account/security',
        state: { returnTo: '/w/workspace-1/my-work?task=task-1' },
      },
      'account-settings',
      '/w/:workspaceId/settings/account/:section',
    );

    expect(workspaceLocationOutput()).toHaveTextContent(
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

  it('rejects an external Settings return target', () => {
    renderRouteScreen(
      {
        pathname: '/w/workspace-1/settings/account/security',
        state: { returnTo: 'https://malicious.example/w/workspace-1/my-work' },
      },
      'account-settings',
      '/w/:workspaceId/settings/account/:section',
    );

    expect(workspaceLocationOutput()).toHaveTextContent('"returnTo":null');
  });

  it('serializes the current content route into Settings router state', () => {
    renderRouteScreen(
      '/w/workspace-1/my-work?task=task-1',
      'my-work',
      '/w/:workspaceId/my-work',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));

    expect(browserLocationOutput()).toHaveTextContent(
      '/w/workspace-1/settings/account/profile',
    );
    expect(routerStateOutput()).toHaveTextContent(
      JSON.stringify({
        returnTo: '/w/workspace-1/my-work?task=task-1',
      }),
    );
  });

  it('does not add a duplicate entry when asked to navigate to the current location', () => {
    renderRouteScreen(
      {
        pathname: '/w/workspace-1/views/view-1',
        search: '?task=task-1',
      },
      'workspace-view',
      '/w/:workspaceId/views/:viewId',
      ['/w/workspace-1/my-work'],
    );

    fireEvent.click(screen.getByRole('button', { name: 'Repeat location' }));
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));

    expect(browserLocationOutput()).toHaveTextContent('/w/workspace-1/my-work');
  });

  it.each(['?task=', '?task=first&task=second', '?filter=unsupported'])(
    'replaces the noncanonical search %s',
    async (search) => {
      renderRouteScreen(
        `/w/workspace-1/my-work${search}`,
        'my-work',
        '/w/:workspaceId/my-work',
      );

      await waitFor(() =>
        expect(browserLocationOutput()).toHaveTextContent(
          /^\/w\/workspace-1\/my-work$/,
        ),
      );
    },
  );
});

function renderRouteScreen(
  entry: InitialEntry,
  routeKind: Parameters<typeof WorkspaceRouteScreen>[0]['routeKind'],
  pattern: string,
  earlierEntries: InitialEntry[] = [],
) {
  return render(
    <MemoryRouter initialEntries={[...earlierEntries, entry]}>
      <Routes>
        <Route
          path={pattern}
          element={
            <WorkspaceRouteScreen
              routeKind={routeKind}
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
          }
        />
        <Route
          path="/w/:workspaceId/settings/account/:section"
          element={
            <WorkspaceRouteScreen
              routeKind="account-settings"
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
          }
        />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
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
  return screen.getByRole('status', { name: 'Workspace location' });
}

function browserLocationOutput() {
  return screen.getByRole('status', { name: 'Browser location' });
}

function routerStateOutput() {
  return screen.getByRole('status', { name: 'Router state' });
}
