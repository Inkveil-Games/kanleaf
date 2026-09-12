import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createTaskQuery, type SavedView } from '../view/types';
import type { Project, Workspace } from './types';
import { WorkspaceNavigation } from './WorkspaceNavigation';

const workspace: Workspace = {
  id: 'workspace-1',
  identifier: 'kanleaf',
  name: 'Kanleaf',
  accent: 'sage',
  role: 'owner',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

const project: Project = {
  id: 'project-1',
  workspace_id: workspace.id,
  name: 'Kanleaf Core',
  identifier: 'kanleaf-core',
  description: '',
  icon: 'rocket',
  lead_user_id: null,
  visibility: 'private',
  default_assignee_id: null,
  default_state_id: 'state-1',
  default_task_type_id: 'type-1',
  cycles_enabled: true,
  modules_enabled: false,
  pages_enabled: true,
  views_enabled: true,
  enabled_task_type_ids: ['type-1'],
  effective_role: 'admin',
  can_join: false,
  archived_at: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

const workspaceView = savedView('workspace-view', 'Board View', null);
const projectView = savedView('project-view', 'Release View', project.id);

describe('WorkspaceNavigation', () => {
  it('keeps the full hierarchy in expanded and drawer modes', () => {
    const { rerender } = renderNavigation({ mode: 'expanded' });

    expect(screen.getByRole('navigation', { name: 'Workspace' })).toHaveClass(
      'navigation-scroll',
    );
    expect(screen.getByRole('button', { name: 'Inbox' })).toBeVisible();
    expect(screen.getByText('Saved Views')).toBeVisible();
    expect(screen.getByText('Projects')).toBeVisible();

    rerender(navigation({ mode: 'drawer' }));
    expect(screen.getByRole('button', { name: 'Inbox' })).toBeVisible();
    expect(screen.getByText('Kanleaf Core')).toBeVisible();
  });

  it('exposes top-level rail actions with route-derived active state', async () => {
    const user = userEvent.setup();
    const callbacks = callbackSpies();
    renderNavigation({
      mode: 'rail',
      surface: 'tasks',
      collection: { kind: 'all' },
      callbacks,
    });

    const rail = screen.getByRole('navigation', {
      name: 'Workspace navigation rail',
    });
    const railButtons = within(rail).getAllByRole('button');
    expect(railButtons[0]).toHaveAccessibleName('Expand navigation');
    expect(railButtons[1]).toHaveAccessibleName(
      'Switch workspace, current workspace Kanleaf',
    );
    expect(within(rail).getByRole('button', { name: 'Inbox' })).toBeVisible();
    expect(within(rail).getByRole('button', { name: 'My Work' })).toBeVisible();
    expect(
      within(rail).getByRole('button', { name: 'All tasks' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(within(rail).getByRole('button', { name: 'Library' })).toBeVisible();
    expect(within(rail).queryByText('Inbox')).not.toBeInTheDocument();

    await user.click(within(rail).getByRole('button', { name: 'Inbox' }));
    expect(callbacks.onSelectCollection).toHaveBeenCalledWith({
      kind: 'inbox',
    });
    await user.click(within(rail).getByRole('button', { name: 'Library' }));
    expect(callbacks.onOpenDocuments).toHaveBeenCalledWith(null);
    await user.click(
      within(rail).getByRole('button', { name: 'Expand navigation' }),
    );
    expect(callbacks.onToggleNavigation).toHaveBeenCalledOnce();
  });

  it('exposes the narrow rail toggle as a dialog disclosure', () => {
    renderNavigation({
      mode: 'rail',
      railToggleLabel: 'Open navigation',
      railToggleOpensDrawer: true,
    });

    expect(
      screen.getByRole('button', { name: 'Open navigation' }),
    ).toHaveAttribute('aria-haspopup', 'dialog');
    expect(
      screen.getByRole('button', { name: 'Open navigation' }),
    ).toHaveAttribute('aria-controls', 'workspace-navigation-drawer');
    expect(
      screen.getByRole('button', { name: 'Open navigation' }),
    ).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens one Saved Views flyout and marks the active Workspace view', async () => {
    const user = userEvent.setup();
    const callbacks = callbackSpies();
    renderNavigation({
      mode: 'rail',
      workspaceViews: [workspaceView],
      activeViewId: workspaceView.id,
      callbacks,
    });

    const trigger = screen.getByRole('button', { name: 'Saved Views' });
    expect(trigger).toHaveAttribute('aria-current', 'page');
    await user.click(trigger);
    const menu = screen.getByRole('menu');
    const viewItem = within(menu).getByRole('menuitem', {
      name: /Board View.*Shared/,
    });
    expect(viewItem).toHaveAttribute('aria-current', 'page');
    await user.click(viewItem);
    expect(callbacks.onOpenSavedView).toHaveBeenCalledWith(workspaceView);
  });

  it('keeps the Saved Views destination available before a view exists', async () => {
    const user = userEvent.setup();
    renderNavigation({ mode: 'rail', workspaceViews: [] });

    await user.click(screen.getByRole('button', { name: 'Saved Views' }));
    expect(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: 'No Saved Views yet',
      }),
    ).toHaveAttribute('aria-disabled', 'true');
  });

  it('dismisses rail flyouts on a route change without remounting direct destinations', async () => {
    const user = userEvent.setup();
    const { rerender } = renderNavigation({
      mode: 'rail',
      navigationRouteKey: 'task:1',
    });
    const inbox = screen.getByRole('button', { name: 'Inbox' });

    await user.click(screen.getByRole('button', { name: 'Saved Views' }));
    expect(screen.getByRole('menu')).toBeVisible();

    rerender(navigation({ mode: 'rail', navigationRouteKey: 'task:2' }));
    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Inbox' })).toBe(inbox);

    rerender(navigation({ mode: 'rail', navigationRouteKey: 'task:1' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens Project chooser and active Project nested navigation', async () => {
    const user = userEvent.setup();
    const callbacks = callbackSpies();
    renderNavigation({
      mode: 'rail',
      projects: [project],
      projectViews: [projectView],
      activeProjectId: project.id,
      surface: 'documents',
      callbacks,
    });

    await user.click(screen.getByRole('button', { name: 'Projects' }));
    let menu = screen.getByRole('menu');
    expect(
      within(menu).getByRole('menuitem', { name: 'New project' }),
    ).toBeVisible();
    await user.click(
      within(menu).getByRole('menuitem', { name: /Kanleaf Core/ }),
    );
    expect(callbacks.onOpenProjectOverview).toHaveBeenCalledWith(project.id);

    const activeProject = screen.getByRole('button', { name: 'Kanleaf Core' });
    expect(activeProject).toHaveAttribute('aria-current', 'page');
    await user.click(activeProject);
    menu = screen.getByRole('menu');
    expect(
      within(menu).getByRole('menuitem', { name: 'Library' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(
      within(menu).getByRole('menuitem', { name: 'Cycles' }),
    ).toBeVisible();
    expect(
      within(menu).queryByRole('menuitem', { name: 'Modules' }),
    ).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'Views' })).toBeVisible();
    expect(
      within(menu).getByRole('menuitem', { name: /Release View/ }),
    ).toBeVisible();

    await user.click(
      within(menu).getByRole('menuitem', { name: 'Work items' }),
    );
    expect(callbacks.onSelectCollection).toHaveBeenCalledWith({
      kind: 'project',
      projectId: project.id,
    });
  });

  it('does not offer Project creation or inaccessible nested routes to guests', async () => {
    const user = userEvent.setup();
    renderNavigation({
      mode: 'rail',
      workspace: { ...workspace, role: 'guest' },
      projects: [{ ...project, effective_role: null, can_join: true }],
      activeProjectId: project.id,
      surface: 'project-overview',
    });

    await user.click(screen.getByRole('button', { name: 'Projects' }));
    expect(
      within(screen.getByRole('menu')).queryByRole('menuitem', {
        name: 'New project',
      }),
    ).toBeNull();
    await user.keyboard('[Escape]');

    await user.click(screen.getByRole('button', { name: 'Kanleaf Core' }));
    const menu = screen.getByRole('menu');
    expect(
      within(menu).getByRole('menuitem', { name: 'Overview' }),
    ).toBeVisible();
    expect(
      within(menu).queryByRole('menuitem', { name: 'Work items' }),
    ).toBeNull();
  });
});

interface NavigationOptions {
  mode?: 'expanded' | 'rail' | 'drawer';
  workspace?: Workspace;
  projects?: Project[];
  workspaceViews?: SavedView[];
  projectViews?: SavedView[];
  collection?: { kind: 'all' } | { kind: 'inbox' };
  surface?: 'tasks' | 'project-overview' | 'documents';
  activeProjectId?: string | null;
  activeViewId?: string | null;
  navigationRouteKey?: string | null;
  railToggleLabel?: string;
  railToggleOpensDrawer?: boolean;
  callbacks?: ReturnType<typeof callbackSpies>;
}

function renderNavigation(options: NavigationOptions = {}) {
  return render(navigation(options));
}

function navigation({
  mode = 'expanded',
  workspace: currentWorkspace = workspace,
  projects = [project],
  workspaceViews = [workspaceView],
  projectViews = [projectView],
  collection = { kind: 'inbox' },
  surface = 'tasks',
  activeProjectId = project.id,
  activeViewId = null,
  navigationRouteKey = 'route-1',
  railToggleLabel = 'Expand navigation',
  railToggleOpensDrawer = false,
  callbacks = callbackSpies(),
}: NavigationOptions = {}) {
  return (
    <WorkspaceNavigation
      mode={mode}
      accountSwitcher={<button type="button">Account</button>}
      railWorkspaceControl={
        <button
          type="button"
          aria-label="Switch workspace, current workspace Kanleaf"
        >
          K
        </button>
      }
      context={{ serverUrl: 'https://kanleaf.example.com', token: 'token' }}
      workspace={currentWorkspace}
      currentUser={{ id: 'user-1', displayName: 'Quang Tran' }}
      projects={projects}
      workspaceViews={workspaceViews}
      projectViews={projectViews}
      collection={collection}
      surface={surface}
      activeProjectId={activeProjectId}
      activeViewId={activeViewId}
      navigationRouteKey={navigationRouteKey}
      onCreateProject={callbacks.onCreateProject}
      onSelectCollection={callbacks.onSelectCollection}
      onOpenProjectOverview={callbacks.onOpenProjectOverview}
      onOpenPlanning={callbacks.onOpenPlanning}
      onOpenDocuments={callbacks.onOpenDocuments}
      onOpenViews={callbacks.onOpenViews}
      onOpenSavedView={callbacks.onOpenSavedView}
      onToggleNavigation={callbacks.onToggleNavigation}
      railToggleLabel={railToggleLabel}
      railToggleExpanded={false}
      railToggleOpensDrawer={railToggleOpensDrawer}
    />
  );
}

function callbackSpies() {
  return {
    onCreateProject: vi.fn().mockResolvedValue(project),
    onSelectCollection: vi.fn(),
    onOpenProjectOverview: vi.fn(),
    onOpenPlanning: vi.fn(),
    onOpenDocuments: vi.fn(),
    onOpenViews: vi.fn(),
    onOpenSavedView: vi.fn(),
    onToggleNavigation: vi.fn(),
  };
}

function savedView(
  id: string,
  name: string,
  projectId: string | null,
): SavedView {
  return {
    id,
    workspace_id: workspace.id,
    project_id: projectId,
    owner_id: 'user-1',
    name,
    visibility: 'shared',
    query_version: 1,
    query: createTaskQuery(
      projectId ? { kind: 'project', projectId } : { kind: 'all' },
    ),
    layout: 'list',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  };
}
