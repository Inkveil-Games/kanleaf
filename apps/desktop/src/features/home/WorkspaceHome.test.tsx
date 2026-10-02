import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceHome } from './WorkspaceHome';
import * as api from './api';
import { listDocuments } from '../document/api';
import { listProjects } from '../workspace/api';
import { queryTasks } from '../view/api';
import type { Project, Workspace } from '../workspace/types';

vi.mock('./api', () => ({
  listQuickLinks: vi.fn(),
  createQuickLink: vi.fn(),
  updateQuickLink: vi.fn(),
  deleteQuickLink: vi.fn(),
  reorderQuickLinks: vi.fn(),
}));
vi.mock('../document/api', () => ({
  listDocuments: vi.fn().mockResolvedValue([]),
}));
vi.mock('../workspace/api', () => ({
  listProjects: vi.fn().mockResolvedValue([]),
}));
vi.mock('../view/api', () => ({ queryTasks: vi.fn().mockResolvedValue([]) }));
const context = { serverUrl: 'http://localhost', token: 'token' };
const workspace: Workspace = {
  id: 'w1',
  identifier: 'team',
  name: 'Team',
  role: 'owner',
  accent: 'sage',
  created_at: '',
  updated_at: '',
};
const external: api.QuickLink = {
  id: 'q1',
  kind: 'external',
  title: 'Design',
  url: 'https://example.com/design',
  project_id: null,
  project_identifier: null,
  document_id: null,
  document_number: null,
  position: 0,
  available: true,
};
const projectFixture: Project = {
  id: 'p1',
  workspace_id: 'w1',
  name: 'Core',
  identifier: 'core',
  description: '',
  icon: 'folder',
  visibility: 'private',
  lead_user_id: null,
  default_assignee_id: null,
  default_state_id: 's1',
  cycles_enabled: false,
  modules_enabled: false,
  pages_enabled: true,
  views_enabled: false,
  effective_role: 'admin',
  can_join: false,
  archived_at: null,
  created_at: '',
  updated_at: '',
};

function mount(
  overrides: Partial<React.ComponentProps<typeof WorkspaceHome>> = {},
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 15_000 } },
  }),
) {
  const props = {
    context,
    workspace,
    displayName: 'Quang Tran',
    userId: 'u1',
    accessSettled: true,
    projects: [projectFixture],
    projectsAccessSettled: true,
    projectsError: null,
    onRetryProjects: vi.fn(),
    onNavigate: vi.fn(),
    ...overrides,
  };
  const ui = (next = props) => (
    <QueryClientProvider client={client}>
      <WorkspaceHome {...next} />
    </QueryClientProvider>
  );
  return { ...render(ui()), props, client, ui };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listQuickLinks).mockResolvedValue([external]);
  vi.mocked(listDocuments).mockResolvedValue([]);
  vi.mocked(queryTasks).mockResolvedValue([]);
});
describe('Workspace Home', () => {
  it('keeps project descriptions in a tooltip instead of the project row', async () => {
    mount({
      projects: [{ ...projectFixture, description: 'Core delivery project' }],
    });
    const project = within(
      screen.getByRole('region', { name: 'Projects' }),
    ).getByRole('link', { name: /Core/ });
    expect(project).not.toHaveTextContent('Core delivery project');
    await userEvent.hover(project);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Core delivery project',
    );
  });
  it('lists active projects separately from quick links and navigates to their overview', async () => {
    const view = mount({
      projects: [
        projectFixture,
        {
          ...projectFixture,
          id: 'archived',
          name: 'Archived',
          archived_at: '2026-10-01',
        },
      ],
    });
    const projects = screen.getByRole('region', { name: 'Projects' });
    const link = within(projects).getByRole('link', { name: /Core/ });
    expect(link).toHaveAttribute('href', '/w/team/p/core');
    expect(within(projects).queryByText('Archived')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Quick links' })).queryByText(
        'Core',
      ),
    ).not.toBeInTheDocument();
    await userEvent.click(link);
    expect(view.props.onNavigate).toHaveBeenCalledWith({
      kind: 'project-overview',
      workspaceId: 'w1',
      projectId: 'p1',
    });
  });
  it('hides cached projects until access settles and after access fails, with retry', async () => {
    const view = mount({ projectsAccessSettled: false });
    expect(screen.getByText('Loading projects…')).toBeVisible();
    expect(
      screen.queryByRole('link', { name: /Core/ }),
    ).not.toBeInTheDocument();
    view.rerender(view.ui({ ...view.props, projectsAccessSettled: true }));
    expect(screen.getByRole('link', { name: /Core/ })).toBeVisible();
    view.rerender(
      view.ui({
        ...view.props,
        projectsError: new Error('Projects unavailable'),
      }),
    );
    expect(
      screen.queryByRole('link', { name: /Core/ }),
    ).not.toBeInTheDocument();
    for (const name of ['Projects', 'Upcoming', 'Recent pages']) {
      expect(
        within(screen.getByRole('region', { name })).getByRole('alert'),
      ).toHaveTextContent('Projects unavailable');
    }
    await userEvent.click(
      screen.getByRole('button', { name: 'Retry projects' }),
    );
    expect(view.props.onRetryProjects).toHaveBeenCalledOnce();
    view.rerender(view.ui({ ...view.props, accessSettled: false }));
    expect(
      screen.queryByRole('link', { name: /Core/ }),
    ).not.toBeInTheDocument();
  });
  it('shows an empty project list without an empty quick link shortcut', () => {
    mount({ projects: [] });
    expect(
      screen.getByText('No active projects in this Workspace yet.'),
    ).toBeVisible();
  });
  it('opens external links in a separate tab with an origin favicon and fallback', async () => {
    mount();
    const link = await screen.findByRole('link', { name: /Design/ });
    expect(link).toHaveAttribute('href', external.url);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('example.com')).toBeVisible();
    const image = link.querySelector('img');
    expect(image).toHaveAttribute('src', 'https://example.com/favicon.ico');
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
    if (image) fireEvent.error(image);
    expect(link.querySelector('img')).toBeNull();
  });
  it.each(['member', 'guest'] as const)(
    'keeps links readonly for %s',
    async (role) => {
      mount({ workspace: { ...workspace, role } });
      await screen.findByRole('link', { name: /Design/ });
      expect(
        screen.queryByRole('button', { name: 'Add link' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Manage Design' }),
      ).not.toBeInTheDocument();
    },
  );
  it('does not fetch or render cached links before access settles and hides them after access loss', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(
      ['quick-links', context.serverUrl, context.token, workspace.id],
      [external],
    );
    const view = mount({ accessSettled: false }, client);
    expect(api.listQuickLinks).not.toHaveBeenCalled();
    expect(screen.queryByText('Design')).not.toBeInTheDocument();
    view.rerender(view.ui({ ...view.props, accessSettled: true }));
    await screen.findByRole('link', { name: /Design/ });
    view.rerender(view.ui({ ...view.props, accessSettled: false }));
    expect(screen.queryByText('Design')).not.toBeInTheDocument();
  });
  it('shows failures and retries without stale links', async () => {
    vi.mocked(api.listQuickLinks).mockRejectedValueOnce(
      new Error('Links unavailable'),
    );
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Links unavailable',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Retry quick links' }),
    );
    expect(await screen.findByRole('link', { name: /Design/ })).toBeVisible();
  });
  it('preserves the external link draft after a failed save, then saves it', async () => {
    vi.mocked(api.createQuickLink)
      .mockRejectedValueOnce(new Error('Try again'))
      .mockResolvedValue(external);
    mount();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Add link' }),
    );
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Title' }),
      'Design',
    );
    await userEvent.type(
      screen.getByRole('textbox', { name: 'URL' }),
      'https://example.com/design',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Add quick link' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again');
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(
      'Design',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Add quick link' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(api.createQuickLink).toHaveBeenLastCalledWith(context, 'w1', {
      kind: 'external',
      title: 'Design',
      url: 'https://example.com/design',
    });
  });
  it('navigates internal links using target identities and keeps unavailable links disabled', async () => {
    vi.mocked(api.listQuickLinks).mockResolvedValue([
      {
        ...external,
        id: 'page',
        kind: 'page',
        title: 'Handbook',
        url: null,
        document_id: 'doc1',
        document_number: 12,
        project_id: 'p1',
        project_identifier: 'core',
      },
      {
        ...external,
        id: 'archived',
        title: 'Archived project',
        kind: 'project',
        available: false,
      },
    ]);
    const { props } = mount();
    await userEvent.click(
      await screen.findByRole('link', { name: /Handbook/ }),
    );
    expect(props.onNavigate).toHaveBeenCalledWith({
      kind: 'project-library',
      workspaceId: 'w1',
      projectId: 'p1',
      documentId: 'doc1',
    });
    expect(
      screen.queryByRole('link', { name: /Archived project/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeVisible();
  });
});

describe('Quick link access refresh', () => {
  it('refreshes links when returning Home within the app cache freshness window', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 15_000 } },
    });
    const first = mount({}, client);
    await screen.findByRole('link', { name: /Design/ });
    first.unmount();
    mount({}, client);
    await screen.findByRole('link', { name: /Design/ });
    expect(api.listQuickLinks).toHaveBeenCalledTimes(2);
  });
  it('refreshes cached targets when reopening the editor and enabling the Page picker', async () => {
    const user = userEvent.setup();
    vi.mocked(listProjects).mockResolvedValue([projectFixture]);
    vi.mocked(listDocuments).mockResolvedValue([]);
    mount();
    await user.click(await screen.findByRole('button', { name: 'Add link' }));
    screen.getByRole('combobox', { name: 'Link type' }).focus();
    await user.keyboard('{ArrowDown}');
    await user.click(screen.getByRole('option', { name: 'Project' }));
    await screen.findByRole('combobox', { name: 'Project' });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: 'Add link' }));
    screen.getByRole('combobox', { name: 'Link type' }).focus();
    await user.keyboard('{ArrowDown}');
    await user.click(await screen.findByRole('option', { name: 'Page' }));
    await screen.findByRole('combobox', { name: 'Page' });
    expect(listProjects).toHaveBeenCalledTimes(2);
    expect(listDocuments).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: 'Add link' }));
    screen.getByRole('combobox', { name: 'Link type' }).focus();
    await user.keyboard('{ArrowDown}');
    await user.click(await screen.findByRole('option', { name: 'Page' }));
    await screen.findByRole('combobox', { name: 'Page' });
    expect(listProjects).toHaveBeenCalledTimes(3);
    expect(listDocuments).toHaveBeenCalledTimes(3);
  });

  it('waits for fresh links on mount, preserves content during a later refresh, then hides stale data on error', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const key = ['quick-links', context.serverUrl, context.token, workspace.id];
    client.setQueryData(key, [external]);
    let finish: (value: api.QuickLink[]) => void = () => {};
    vi.mocked(api.listQuickLinks).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    mount({}, client);
    expect(
      screen.queryByRole('link', { name: /Design/ }),
    ).not.toBeInTheDocument();
    await act(async () => {
      finish([external]);
    });
    await screen.findByRole('link', { name: /Design/ });
    let fail: (reason: Error) => void = () => {};
    vi.mocked(api.listQuickLinks).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    let refresh: Promise<void> = Promise.resolve();
    act(() => {
      refresh = client.invalidateQueries({ queryKey: key });
    });
    expect(screen.getByRole('link', { name: /Design/ })).toBeVisible();
    await act(async () => {
      fail(new Error('Access denied'));
      await refresh;
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
    expect(
      screen.queryByRole('link', { name: /Design/ }),
    ).not.toBeInTheDocument();
  });
});

describe('Quick link management', () => {
  it('edits an external link from its own keyboard-accessible menu', async () => {
    vi.mocked(api.updateQuickLink).mockResolvedValue(external);
    const user = userEvent.setup();
    mount();
    const menu = await screen.findByRole('button', { name: 'Manage Design' });
    menu.focus();
    await user.keyboard('{Enter}');
    await user.click(
      await screen.findByRole('menuitem', { name: 'Edit link' }),
    );
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(
      'Design',
    );
    expect(screen.getByRole('textbox', { name: 'URL' })).toHaveValue(
      external.url,
    );
    await user.clear(screen.getByRole('textbox', { name: 'Title' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Title' }),
      'Design system',
    );
    await user.click(screen.getByRole('button', { name: 'Save link' }));
    await waitFor(() =>
      expect(api.updateQuickLink).toHaveBeenCalledWith(context, 'w1', 'q1', {
        kind: 'external',
        title: 'Design system',
        url: external.url,
      }),
    );
  });
  it.each(['page', 'project'] as const)(
    'edits a %s using its stable target ID',
    async (kind) => {
      vi.mocked(listProjects).mockResolvedValue([projectFixture]);
      vi.mocked(listDocuments).mockResolvedValue([
        {
          id: 'd1',
          document_number: 1,
          workspace_id: 'w1',
          project_id: 'p1',
          parent_id: null,
          title: 'Handbook',
          storage_name: 'handbook',
          library_path: '',
          position: 0,
          can_edit: true,
          archived_at: null,
          created_at: '',
          updated_at: '',
        },
      ]);
      const link = {
        ...external,
        kind,
        title: kind === 'page' ? 'Handbook' : 'Core',
        url: null,
        project_id: 'p1',
        project_identifier: 'core',
        document_id: kind === 'page' ? 'd1' : null,
        document_number: kind === 'page' ? 1 : null,
      };
      vi.mocked(api.listQuickLinks).mockResolvedValue([link]);
      vi.mocked(api.updateQuickLink).mockResolvedValue(link);
      mount();
      (
        await screen.findByRole('button', { name: `Manage ${link.title}` })
      ).focus();
      await userEvent.keyboard('{ArrowDown}');
      await userEvent.click(
        screen.getByRole('menuitem', { name: 'Edit link' }),
      );
      const select = await screen.findByRole('combobox', {
        name: kind === 'page' ? 'Page' : 'Project',
      });
      expect(select).toHaveTextContent(link.title);
      await userEvent.click(screen.getByRole('button', { name: 'Save link' }));
      await waitFor(() =>
        expect(api.updateQuickLink).toHaveBeenCalledWith(
          context,
          'w1',
          'q1',
          kind === 'page'
            ? { kind, document_id: 'd1' }
            : { kind, project_id: 'p1' },
        ),
      );
    },
  );
  it.each(['disabled', 'inaccessible', 'archived'] as const)(
    'excludes pages from %s Projects',
    async (state) => {
      vi.mocked(listProjects).mockResolvedValue([
        {
          ...projectFixture,
          pages_enabled: state !== 'disabled',
          effective_role: state === 'inaccessible' ? null : 'admin',
          archived_at: state === 'archived' ? '2026-01-01' : null,
        },
      ]);
      vi.mocked(listDocuments).mockResolvedValue([
        {
          id: 'd1',
          document_number: 1,
          workspace_id: 'w1',
          project_id: 'p1',
          parent_id: null,
          title: 'Handbook',
          storage_name: 'handbook',
          library_path: '',
          position: 0,
          can_edit: true,
          archived_at: null,
          created_at: '',
          updated_at: '',
        },
      ]);
      vi.mocked(api.listQuickLinks).mockResolvedValue([
        {
          ...external,
          kind: 'page',
          title: 'Handbook',
          url: null,
          project_id: 'p1',
          document_id: 'd1',
          document_number: 1,
        },
      ]);
      mount();
      (await screen.findByRole('button', { name: 'Manage Handbook' })).focus();
      await userEvent.keyboard('{ArrowDown}');
      await userEvent.click(
        screen.getByRole('menuitem', { name: 'Edit link' }),
      );
      expect(
        await screen.findByRole('combobox', { name: 'Page' }),
      ).toHaveTextContent('No available pages');
      expect(screen.getByRole('button', { name: 'Save link' })).toBeDisabled();
      expect(api.updateQuickLink).not.toHaveBeenCalled();
    },
  );
  it('reorders from the menu and reports a failed order without losing the list', async () => {
    vi.mocked(api.listQuickLinks).mockResolvedValue([
      external,
      { ...external, id: 'q2', title: 'Docs', position: 1 },
    ]);
    vi.mocked(api.reorderQuickLinks).mockRejectedValueOnce(
      new Error('Order changed; try again'),
    );
    mount();
    (await screen.findByRole('button', { name: 'Manage Design' })).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Move left' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move right' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Order changed; try again',
    );
    expect(api.reorderQuickLinks).toHaveBeenCalledWith(context, 'w1', [
      'q2',
      'q1',
    ]);
    expect(screen.getByRole('link', { name: /Design/ })).toBeVisible();
  });
  it('confirms removing only the shared shortcut', async () => {
    vi.mocked(api.deleteQuickLink).mockResolvedValue(undefined);
    mount();
    (await screen.findByRole('button', { name: 'Manage Design' })).focus();
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.click(
      screen.getByRole('menuitem', { name: 'Remove link' }),
    );
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'The linked content is kept.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove link' }));
    await waitFor(() =>
      expect(api.deleteQuickLink).toHaveBeenCalledWith(context, 'w1', 'q1'),
    );
  });
  it.each(['javascript:alert(1)', 'https://user:password@example.com/'])(
    'rejects unsafe external URL %s',
    async (url) => {
      mount();
      await userEvent.click(
        await screen.findByRole('button', { name: 'Add link' }),
      );
      await userEvent.type(
        screen.getByRole('textbox', { name: 'Title' }),
        'Unsafe',
      );
      await userEvent.type(screen.getByRole('textbox', { name: 'URL' }), url);
      await userEvent.click(
        screen.getByRole('button', { name: 'Add quick link' }),
      );
      expect(screen.getByRole('alert')).toHaveTextContent(
        'HTTP or HTTPS URL without embedded credentials',
      );
      expect(api.createQuickLink).not.toHaveBeenCalled();
    },
  );
});
