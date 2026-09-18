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
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticatedRoutes } from '../../app/routing/AuthenticatedRoutes';
import examples from '../../../../server/tests/fixtures/webhook-payloads.json';
import type { Workspace } from '../workspace/types';

const mocks = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  flush: vi.fn(),
  signOut: vi.fn(),
  addAccount: vi.fn(),
  listWebhooks: vi.fn(),
  getWebhook: vi.fn(),
  listProjects: vi.fn(),
  catalog: vi.fn(),
}));
vi.mock('../workspace/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../workspace/api')>()),
  listWorkspaces: mocks.listWorkspaces,
  listProjects: mocks.listProjects,
}));
vi.mock('../collaboration/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../collaboration/api')>()),
  listNotifications: vi.fn().mockResolvedValue([]),
}));

vi.mock('./webhooks/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./webhooks/api')>()),
  listWebhooks: mocks.listWebhooks,
  getWebhook: mocks.getWebhook,
  getWebhookCatalog: mocks.catalog,
}));

const workspace: Workspace = {
  id: 'workspace-1',
  identifier: 'kanleaf',
  name: 'Kanleaf team',
  role: 'owner',
  accent: 'sage',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};
const second: Workspace = {
  ...workspace,
  id: 'workspace-2',
  identifier: 'inkveil',
  name: 'Inkveil',
  role: 'admin',
};
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.flush.mockResolvedValue(undefined);
  mocks.listWebhooks.mockResolvedValue([]);
  mocks.listProjects.mockResolvedValue([]);
  mocks.catalog.mockResolvedValue({
    event_types: Object.keys(examples),
    examples,
    allow_http: false,
  });
  mocks.getWebhook.mockRejectedValue(new Error('Webhook not found'));

  mocks.listWorkspaces.mockResolvedValue([workspace, second]);
});

function renderRoutes(
  path: string,
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  }),
) {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AuthenticatedRoutes
          serverUrl="https://kanleaf.example.com"
          token="token"
          user={{
            id: 'user-1',
            email: 'owner@example.com',
            display_name: 'Owner',
            is_host: false,
            theme: 'system',
            timezone: 'UTC',
            week_start: 'monday',
            date_format: 'locale',
            active_workspace_id: second.id,
            setup_stage: 'complete',
          }}
          accountSessions={[
            {
              user_id: 'user-1',
              email: 'owner@example.com',
              display_name: 'Owner',
              token: 'token',
              expires_at: '2099-01-01T00:00:00Z',
              last_used_at: '2026-09-01T00:00:00Z',
            },
          ]}
          accountTransitioning={false}
          accountError={null}
          onSwitchAccount={vi.fn()}
          onAddAccount={mocks.addAccount}
          onDismissAccountError={vi.fn()}
          onSignOut={mocks.signOut}
          onSessionChanged={vi.fn()}
          flushDocumentSaves={mocks.flush}
        />
        <HistoryProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
function HistoryProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="Browser location">
        {location.pathname}
        {location.search}
        {location.hash}
      </output>
      <button onClick={() => navigate(-1)}>Browser back</button>
      <button onClick={() => navigate(1)}>Browser forward</button>
    </>
  );
}
const browserLocation = () => screen.getByLabelText('Browser location');

describe('Developer routes', () => {
  it.each(['new', 'webhook-a'])(
    'drops %s when switching Workspace from a webhook form/detail',
    async (suffix) => {
      renderRoutes(`/developer/w/kanleaf/webhooks/${suffix}`);
      await screen.findByRole('button', {
        name: /Switch workspace, current workspace Kanleaf team/,
      });
      fireEvent.click(
        screen.getByRole('button', {
          name: /Switch workspace, current workspace Kanleaf team/,
        }),
      );
      fireEvent.click(await screen.findByRole('button', { name: /Inkveil/ }));
      await waitFor(() =>
        expect(browserLocation()).toHaveTextContent(
          /^\/developer\/w\/inkveil\/webhooks$/,
        ),
      );
    },
  );
  it.each(['owner', 'admin'] as const)(
    'allows %s deep links and preserves global chrome',
    async (role) => {
      mocks.listWorkspaces.mockResolvedValue([{ ...workspace, role }, second]);
      renderRoutes('/developer/w/kanleaf');
      expect(
        await screen.findByRole('heading', { name: 'Developer overview' }),
      ).toBeInTheDocument();
      expect(browserLocation()).toHaveTextContent(/^\/developer\/w\/kanleaf$/);
      expect(
        screen.getByRole('button', {
          name: /Switch workspace, current workspace Kanleaf team/,
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Notifications' }),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
      expect(
        await screen.findByText('No notifications yet'),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
      fireEvent.click(screen.getByRole('button', { name: 'Switch account' }));
      fireEvent.click(
        await screen.findByRole('button', { name: 'Add another account' }),
      );
      expect(mocks.addAccount).toHaveBeenCalledOnce();
      fireEvent.click(screen.getByRole('button', { name: 'Switch account' }));
      fireEvent.click(
        await screen.findByRole('button', { name: 'Sign out this account' }),
      );
      expect(mocks.signOut).toHaveBeenCalledOnce();
    },
  );
  it.each(['member', 'guest'] as const)(
    'denies %s developer deep links',
    async (role) => {
      mocks.listWorkspaces.mockResolvedValue([{ ...workspace, role }]);
      renderRoutes('/developer/w/kanleaf/webhooks');
      expect(
        await screen.findByRole('heading', {
          name: 'Workspace admin access required',
        }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'Webhooks' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('navigation', { name: 'Developer navigation' }),
      ).not.toBeInTheDocument();
      expect(browserLocation()).toHaveTextContent(
        '/developer/w/kanleaf/webhooks',
      );
    },
  );
  it('keeps Back to Workspace in a footer above the account control', async () => {
    renderRoutes('/developer/w/kanleaf');
    await screen.findByRole('heading', { name: 'Developer overview' });
    const footer = screen.getByLabelText('Developer footer');
    const back = within(footer).getByRole('link', {
      name: 'Back to Workspace',
    });
    const account = within(footer).getByRole('button', {
      name: 'Switch account',
    });
    expect(
      back.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(
        screen.getByRole('navigation', { name: 'Developer navigation' }),
      ).queryByRole('link', { name: 'Back to Workspace' }),
    ).not.toBeInTheDocument();
  });
  it('offers only eligible workspaces at the global entry', async () => {
    mocks.listWorkspaces.mockResolvedValue([
      workspace,
      second,
      {
        ...workspace,
        id: 'member',
        identifier: 'member',
        name: 'Member team',
        role: 'member',
      },
      {
        ...workspace,
        id: 'guest',
        identifier: 'guest',
        name: 'Guest team',
        role: 'guest',
      },
    ]);
    renderRoutes('/developer');
    expect(
      await screen.findByRole('heading', { name: 'Developer console' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /Member team|Guest team/ }),
    ).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Switch workspace/ }));
    const switcher = await screen.findByRole('dialog', {
      name: 'Workspace Switcher',
    });
    expect(within(switcher).queryByText('Member team')).not.toBeInTheDocument();
    expect(within(switcher).queryByText('Guest team')).not.toBeInTheDocument();
    await user.click(within(switcher).getByRole('button', { name: /Inkveil/ }));
    await waitFor(() =>
      expect(browserLocation()).toHaveTextContent(/^\/developer\/w\/inkveil$/),
    );
  });
  it('explains when there are no eligible workspaces', async () => {
    mocks.listWorkspaces.mockResolvedValue([{ ...workspace, role: 'member' }]);
    renderRoutes('/developer');
    expect(
      await screen.findByText('No Workspaces to manage'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Switch account' }),
    ).toBeInTheDocument();
  });
  it('keeps Webhooks selected when switching and supports browser history', async () => {
    const user = userEvent.setup();
    renderRoutes('/developer/w/kanleaf/webhooks');
    expect(
      await screen.findByRole('heading', { name: 'Webhooks', level: 1 }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        'Create a webhook to send task and comment events to an external service.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create webhook' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Switch workspace/ }));
    await user.click(await screen.findByRole('button', { name: /Inkveil/ }));
    await waitFor(() =>
      expect(browserLocation()).toHaveTextContent(
        '/developer/w/inkveil/webhooks',
      ),
    );
    expect(mocks.flush).toHaveBeenCalled();
    fireEvent.click(screen.getByText('Browser back'));
    await waitFor(() =>
      expect(browserLocation()).toHaveTextContent(
        '/developer/w/kanleaf/webhooks',
      ),
    );
    fireEvent.click(screen.getByText('Browser forward'));
    await waitFor(() =>
      expect(browserLocation()).toHaveTextContent(
        '/developer/w/inkveil/webhooks',
      ),
    );
    await user.click(screen.getByRole('link', { name: 'Overview' }));
    expect(
      await screen.findByRole('heading', { name: 'Developer overview' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Open Webhooks' }));
    expect(
      await screen.findByRole('heading', { name: 'Webhooks', level: 1 }),
    ).toBeInTheDocument();
  });
  it('blocks navigation when document saves fail', async () => {
    renderRoutes('/developer/w/kanleaf');
    await screen.findByRole('heading', { name: 'Developer overview' });
    mocks.flush.mockRejectedValueOnce(new Error('Markdown save failed'));
    fireEvent.click(screen.getByRole('link', { name: 'Open Webhooks' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Markdown save failed',
    );
    expect(browserLocation()).toHaveTextContent(/^\/developer\/w\/kanleaf$/);
  });
  it('does not expose cached access while the initial membership check is pending', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    client.setQueryData(
      ['workspaces', 'https://kanleaf.example.com', 'token'],
      [workspace],
    );
    let resolve!: (value: Workspace[]) => void;
    mocks.listWorkspaces.mockReturnValue(
      new Promise<Workspace[]>((done) => {
        resolve = done;
      }),
    );
    renderRoutes('/developer/w/kanleaf/webhooks', client);
    expect(
      screen.queryByRole('heading', { name: 'Webhooks' }),
    ).not.toBeInTheDocument();
    expect(browserLocation()).toHaveTextContent(
      '/developer/w/kanleaf/webhooks',
    );
    await act(async () => resolve([{ ...workspace, role: 'member' }]));
    expect(
      await screen.findByRole('heading', {
        name: 'Workspace admin access required',
      }),
    ).toBeInTheDocument();
  });
  it('preserves confirmed UI during refetch and hides it on access failure, with retry', async () => {
    const client = renderRoutes('/developer/w/kanleaf/webhooks');
    await screen.findByRole('heading', { name: 'Webhooks', level: 1 });
    let reject!: (error: Error) => void;
    mocks.listWorkspaces.mockReturnValueOnce(
      new Promise((_done, failed) => {
        reject = failed;
      }),
    );
    await act(async () => {
      void client.invalidateQueries({ queryKey: ['workspaces'] });
    });
    expect(
      screen.getByRole('heading', { name: 'Webhooks', level: 1 }),
    ).toBeInTheDocument();
    await act(async () => reject(new Error('Access check failed')));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Access check failed',
    );
    expect(
      screen.queryByRole('heading', { name: 'Webhooks' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('heading', { name: 'Webhooks', level: 1 }),
    ).toBeInTheDocument();
  });
  it.each([
    [
      '/developer/w/workspace-1/webhooks/new',
      '/developer/w/kanleaf/webhooks/new',
    ],
    [
      '/developer/w/workspace-1/webhooks/hook-a',
      '/developer/w/kanleaf/webhooks/hook-a',
    ],
    [
      '/developer/w/workspace-1/webhooks?source=link#page',
      '/developer/w/kanleaf/webhooks?source=link#page',
    ],
    ['/developer/w/kanleaf/webhooks/', '/developer/w/kanleaf/webhooks'],
    ['/developer/w/kanleaf/unknown', '/developer/w/kanleaf'],
    ['/developer/w/missing/webhooks', '/developer'],
  ])('canonicalizes %s to %s', async (path, expected) => {
    renderRoutes(path);
    await waitFor(() => expect(browserLocation().textContent).toBe(expected));
  });
});
