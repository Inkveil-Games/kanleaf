import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import examples from '../../../../../server/tests/fixtures/webhook-payloads.json';
import { ApiError } from '../../../lib/api/client';
import { DeveloperWebhooks } from '../DeveloperWebhooks';
import type { Webhook, WebhookDelivery } from './types';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  enabled: vi.fn(),
  regenerate: vi.fn(),
  test: vi.fn(),
  deliveries: vi.fn(),
  delivery: vi.fn(),
  delete: vi.fn(),
  catalog: vi.fn(),
  projects: vi.fn(),
}));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  listWebhooks: mocks.list,
  getWebhook: mocks.get,
  createWebhook: mocks.create,
  updateWebhook: mocks.update,
  setWebhookEnabled: mocks.enabled,
  regenerateWebhookSecret: mocks.regenerate,
  sendTestWebhook: mocks.test,
  listWebhookDeliveries: mocks.deliveries,
  getWebhookDelivery: mocks.delivery,
  deleteWebhook: mocks.delete,
  getWebhookCatalog: mocks.catalog,
}));
vi.mock('../../workspace/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../workspace/api')>()),
  listProjects: mocks.projects,
}));

const workspace = {
  id: 'workspace-1',
  identifier: 'kanleaf',
  name: 'Kanleaf',
  role: 'owner' as const,
  accent: 'sage' as const,
  created_at: '',
  updated_at: '',
};
const hook: Webhook = {
  id: 'hook-1',
  workspace_id: workspace.id,
  name: 'Build automation',
  endpoint_url: 'https://receiver.example.com/events',
  enabled: true,
  project_scope: 'all',
  projects: [],
  event_types: ['task.updated'],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  secret_regenerated_at: '2026-01-01T00:00:00Z',
};
const delivery: WebhookDelivery = {
  id: 'delivery-1',
  event_id: 'event-1',
  event_type: 'webhook.test',
  is_test: true,
  status: 'succeeded',
  attempt_count: 1,
  http_status: 204,
  duration_ms: 12,
  last_error: null,
  created_at: '2026-01-01T00:00:00Z',
  next_attempt_at: '2026-01-01T00:00:00Z',
  delivered_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([]);
  mocks.get.mockResolvedValue(hook);
  mocks.projects.mockResolvedValue([
    { id: 'project-1', name: 'Backend' },
    { id: 'project-2', name: 'Frontend' },
  ]);
  mocks.catalog.mockResolvedValue({
    event_types: Object.keys(examples),
    examples,
    allow_http: false,
  });
  mocks.create.mockResolvedValue({
    webhook: hook,
    signing_secret: 'klf_whsec_created_fixture',
  });
  mocks.update.mockImplementation(async (_context, _workspace, _id, input) => ({
    ...hook,
    ...input,
  }));
  mocks.enabled.mockResolvedValue({ ...hook, enabled: false });
  mocks.deliveries.mockResolvedValue([]);
  mocks.delivery.mockResolvedValue(delivery);
  mocks.test.mockResolvedValue({ ...delivery, status: 'pending' });
  mocks.regenerate.mockResolvedValue({
    signing_secret: 'klf_whsec_replacement_fixture',
  });
  mocks.delete.mockResolvedValue(undefined);
});
function Boundary({
  section,
}: {
  section: 'webhooks' | 'webhook-new' | 'webhook-detail';
}) {
  const params = useParams();
  const navigate = useNavigate();
  return (
    <DeveloperWebhooks
      context={{ serverUrl: 'https://kanleaf.example', token: 'token' }}
      workspace={workspace}
      section={section}
      webhookId={params.webhookId}
      navigateTo={(path) => navigate(path)}
      onNavigate={(event) => {
        event.preventDefault();
        navigate(event.currentTarget.getAttribute('href') ?? '');
      }}
    />
  );
}
function Probe() {
  return <output aria-label="Location">{useLocation().pathname}</output>;
}
function mount(path = '/developer/w/kanleaf/webhooks') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const rendered = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/developer/w/:workspaceIdentifier/webhooks"
            element={<Boundary section="webhooks" />}
          />
          <Route
            path="/developer/w/:workspaceIdentifier/webhooks/new"
            element={<Boundary section="webhook-new" />}
          />
          <Route
            path="/developer/w/:workspaceIdentifier/webhooks/:webhookId"
            element={<Boundary section="webhook-detail" />}
          />
        </Routes>
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...rendered, client };
}

describe('Webhook pages', () => {
  it('resolves a test result independently of the recent-history page', async () => {
    const user = userEvent.setup();
    mount('/developer/w/kanleaf/webhooks/hook-1');
    await screen.findByRole('button', { name: 'Send test webhook' });
    await user.click(screen.getByRole('button', { name: 'Send test webhook' }));
    await waitFor(() =>
      expect(mocks.delivery).toHaveBeenCalledWith(
        expect.anything(),
        workspace.id,
        hook.id,
        delivery.id,
      ),
    );
    await screen.findByText('Succeeded · HTTP 204 · 12 ms');
    expect(
      screen.getByRole('button', { name: 'Send test webhook' }),
    ).toBeEnabled();
    expect(
      within(
        screen.getByRole('region', { name: 'Recent deliveries' }),
      ).queryByText('webhook.test'),
    ).not.toBeInTheDocument();
  });
  it('preserves an edit through transient background errors and hides it on revoked access', async () => {
    const user = userEvent.setup();
    const { client } = mount('/developer/w/kanleaf/webhooks/hook-1');
    const name = await screen.findByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'Unsaved endpoint changes');
    mocks.get.mockRejectedValue(
      new ApiError(500, 'internal', 'Temporary server error'),
    );
    await client.refetchQueries({
      queryKey: [
        'webhooks',
        'https://kanleaf.example',
        'token',
        workspace.id,
        'detail',
        hook.id,
      ],
    });
    await screen.findByText('Temporary server error');
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue(
      'Unsaved endpoint changes',
    );
    mocks.get.mockResolvedValue(hook);
    await user.click(screen.getByRole('button', { name: 'Retry webhook' }));
    await waitFor(() =>
      expect(
        screen.queryByText('Temporary server error'),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue(
      'Unsaved endpoint changes',
    );
    mocks.get.mockRejectedValue(
      new ApiError(403, 'forbidden', 'Workspace admin access required'),
    );
    await client.refetchQueries({
      queryKey: [
        'webhooks',
        'https://kanleaf.example',
        'token',
        workspace.id,
        'detail',
        hook.id,
      ],
    });
    await screen.findByRole('heading', { name: 'Webhook unavailable' });
    expect(
      screen.queryByRole('textbox', { name: 'Name' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Recent deliveries' }),
    ).not.toBeInTheDocument();
  });
  it('opens a routed create form from the empty state', async () => {
    mount();
    await screen.findByText('No webhooks yet');
    fireEvent.click(
      screen.getByRole('button', { name: 'Create your first webhook' }),
    );
    await screen.findByRole('textbox', { name: 'Name' });
    expect(screen.getByLabelText('Location')).toHaveTextContent(
      '/webhooks/new',
    );
  });
  it('lists compact subscription metadata and supports disabling', async () => {
    mocks.list.mockResolvedValue([hook]);
    mount();
    await screen.findByRole('link', { name: hook.name });
    expect(screen.getByText('1 event · All projects')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: `Actions for ${hook.name}` }),
    );
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Disable' }));
    await waitFor(() =>
      expect(mocks.enabled).toHaveBeenCalledWith(
        expect.anything(),
        workspace.id,
        hook.id,
        false,
      ),
    );
  });
  it('validates fields, Projects, and events before submission', async () => {
    mount('/developer/w/kanleaf/webhooks/new');
    await screen.findByRole('textbox', { name: 'Name' });
    fireEvent.click(screen.getByRole('radio', { name: 'Selected projects' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create webhook' }));
    expect(
      await screen.findByText('Select at least one event.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Select at least one Project.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Enter a name of 1 to 120 characters.'),
    ).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('creates selected-project subscriptions and displays a secret only in the creation result', async () => {
    const user = userEvent.setup();
    mount('/developer/w/kanleaf/webhooks/new');
    await screen.findByRole('textbox', { name: 'Name' });
    await user.type(
      screen.getByRole('textbox', { name: 'Name' }),
      'Build automation',
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Endpoint URL' }),
      hook.endpoint_url,
    );
    await user.click(screen.getByRole('radio', { name: 'Selected projects' }));
    await user.type(
      screen.getByRole('searchbox', { name: 'Search Projects' }),
      'Back',
    );
    expect(
      screen.queryByRole('checkbox', { name: 'Frontend' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Backend' }));
    await user.click(screen.getByRole('checkbox', { name: 'Task updated' }));
    await user.click(screen.getByRole('button', { name: 'Create webhook' }));
    expect(
      await screen.findByText('klf_whsec_created_fixture'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Copy this secret now/)).toBeInTheDocument();
    expect(mocks.create).toHaveBeenCalledWith(
      expect.anything(),
      workspace.id,
      expect.objectContaining({
        project_scope: 'selected',
        project_ids: ['project-1'],
        event_types: ['task.updated'],
        enabled: true,
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Copy secret' }));
    expect(await navigator.clipboard.readText()).toBe(
      'klf_whsec_created_fixture',
    );
    await user.click(screen.getByRole('link', { name: 'Open webhook' }));
    await screen.findByRole('heading', { name: hook.name });
    expect(
      screen.queryByText('klf_whsec_created_fixture'),
    ).not.toBeInTheDocument();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
  it('uses serializer-owned fixtures for read-only JSON and dynamic header placeholders', async () => {
    const user = userEvent.setup();
    mount('/developer/w/kanleaf/webhooks/new');
    await screen.findByRole('textbox', { name: 'Name' });
    await user.click(screen.getByRole('checkbox', { name: 'Comment deleted' }));
    expect(
      JSON.parse(screen.getByLabelText('JSON request body').textContent ?? ''),
    ).toEqual(examples['comment.deleted']);
    await user.click(screen.getByRole('button', { name: 'Copy JSON' }));
    expect(JSON.parse(await navigator.clipboard.readText())).toEqual(
      examples['comment.deleted'],
    );
    await user.click(screen.getByText('Request headers'));
    const headers = screen.getByLabelText('Example request headers');
    expect(headers).toHaveTextContent('X-Kanleaf-Event: comment.deleted');
    expect(headers).toHaveTextContent('v1=<HMAC signature>');
    await user.click(screen.getByRole('checkbox', { name: 'Task created' }));
    await user.click(screen.getByRole('combobox', { name: 'Preview event' }));
    await user.click(
      await screen.findByRole('option', { name: 'task.created' }),
    );
    expect(
      JSON.parse(screen.getByLabelText('JSON request body').textContent ?? ''),
    ).toEqual(examples['task.created']);
    expect(screen.queryByText('Response preview')).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Task created' }));
    expect(
      JSON.parse(screen.getByLabelText('JSON request body').textContent ?? ''),
    ).toEqual(examples['comment.deleted']);
  });
  it('edits configuration, disables, tests, regenerates with confirmation, and deletes', async () => {
    const user = userEvent.setup();
    mount('/developer/w/kanleaf/webhooks/hook-1');
    await screen.findByRole('textbox', { name: 'Name' });
    await user.clear(screen.getByRole('textbox', { name: 'Name' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Renamed');
    await user.click(screen.getByRole('switch', { name: 'Webhook enabled' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith(
        expect.anything(),
        workspace.id,
        hook.id,
        expect.objectContaining({ name: 'Renamed', enabled: false }),
      ),
    );
    mocks.deliveries.mockResolvedValue([delivery]);
    await user.click(screen.getByRole('button', { name: 'Send test webhook' }));
    await waitFor(() =>
      expect(
        within(
          screen.getByRole('region', { name: 'Recent deliveries' }),
        ).getByText('Succeeded · HTTP 204 · 12 ms'),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText('1 attempt')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Regenerate secret' }));
    expect(mocks.regenerate).not.toHaveBeenCalled();
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Regenerate secret',
      }),
    );
    expect(
      await screen.findByText('klf_whsec_replacement_fixture'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete webhook' }));
    expect(mocks.delete).not.toHaveBeenCalled();
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Delete webhook',
      }),
    );
    await waitFor(() =>
      expect(mocks.delete).toHaveBeenCalledWith(
        expect.anything(),
        workspace.id,
        hook.id,
      ),
    );
    await screen.findByText('No webhooks yet');
  });
  it('shows safe delivery failure information', async () => {
    mocks.deliveries.mockResolvedValue([
      {
        ...delivery,
        is_test: false,
        event_type: 'task.updated',
        status: 'failed',
        attempt_count: 6,
        http_status: 503,
        last_error: 'Endpoint returned a non-success HTTP status',
      },
    ]);
    mount('/developer/w/kanleaf/webhooks/hook-1');
    expect(
      await screen.findByText('Failed · HTTP 503 · 12 ms'),
    ).toBeInTheDocument();
    expect(screen.getByText('6 attempts')).toBeInTheDocument();
    expect(
      screen.getByText('Endpoint returned a non-success HTTP status'),
    ).toBeInTheDocument();
  });
  it('hides configuration on access errors and offers retry', async () => {
    mocks.get.mockRejectedValue(new Error('Workspace admin access required'));
    mount('/developer/w/kanleaf/webhooks/hook-1');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Workspace admin access required',
    );
    expect(
      screen.queryByRole('button', { name: 'Save changes' }),
    ).not.toBeInTheDocument();
    expect(mocks.deliveries).not.toHaveBeenCalled();
  });
});
