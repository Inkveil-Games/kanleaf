import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseSelectOption } from '../../test/select';
import type {
  TaskConfiguration,
  TaskState,
  Workspace,
} from '../workspace/types';
import { TaskConfigurationSettings } from './TaskConfigurationSettings';

const requests: Array<{ method: string; url: string; body?: string }> = [];

beforeEach(() => {
  requests.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TaskConfigurationSettings', () => {
  it('renders States in the unified property order and protects core identity', async () => {
    mockApi();
    renderSettings();

    const name = await screen.findByLabelText('Name');
    const type = screen.getByLabelText('Type');
    const description = screen.getByRole('heading', {
      name: 'Property description',
    });
    const values = screen.getByText('Property values');
    expect(name).toHaveValue('State');
    expect(name).toBeDisabled();
    expect(type).toHaveValue('Single select');
    expect(type).toBeDisabled();
    expect(name.compareDocumentPosition(type)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(type.compareDocumentPosition(description)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(description.compareDocumentPosition(values)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    expect(screen.getByRole('button', { name: 'Reorder Todo' })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Change icon for Todo' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Change color for Todo' }),
    ).toBeDisabled();
    const stateNames = screen.getAllByRole('textbox', { name: 'Value name' });
    const stateDescriptions = screen.getAllByRole('textbox', {
      name: 'Value description',
    });
    expect(stateNames[0]).toBeDisabled();
    expect(stateDescriptions[0]).toBeEnabled();
    expect(stateNames[1]).toBeEnabled();
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(
      screen.queryByRole('button', { name: 'Actions for Todo' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Actions for Ready' }),
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole('radio', { name: 'Use Ready as default' }),
    );
    await waitFor(() =>
      expect(
        requests.some(
          ({ method, url, body }) =>
            method === 'PATCH' &&
            url.endsWith('/task-configuration') &&
            body === JSON.stringify({ state_id: 'state-ready' }),
        ),
      ).toBe(true),
    );
  });

  it('renders Labels as the same multi-select editor without a default column', async () => {
    mockApi();
    renderSettings('labels');

    expect(await screen.findByLabelText('Name')).toHaveValue('Labels');
    expect(screen.getByLabelText('Type')).toHaveValue('Multi select');
    expect(
      screen.getByRole('heading', { name: 'Property description' }),
    ).toBeVisible();
    expect(screen.getByText('Property values')).toBeVisible();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Reorder Documentation' }),
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Change icon for Documentation' }),
    ).toBeEnabled();
    expect(screen.getByRole('textbox', { name: 'Value name' })).toHaveValue(
      'Documentation',
    );
    expect(
      screen.getByRole('textbox', { name: 'Value description' }),
    ).toHaveValue('Docs and guides');
  });

  it('keeps read-only, archived, and adjacent validation states visible', async () => {
    mockApi({ rejectCreate: true });
    const { unmount } = renderSettings('states', {
      ...workspace,
      role: 'member',
    });

    expect(await screen.findByText('Deferred')).toBeVisible();
    expect(screen.getByText('Archived values')).toBeVisible();
    expect(
      screen
        .getAllByRole('textbox', { name: 'Value name' })
        .every((input) => input.hasAttribute('disabled')),
    ).toBe(true);
    expect(
      screen.queryByRole('button', { name: 'Save changes' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'Only Workspace Owners and Admins can change task states.',
      ),
    ).toBeVisible();

    unmount();
    renderSettings('states');
    fireEvent.click(await screen.findByRole('button', { name: 'Add state' }));
    const names = screen.getAllByRole('textbox', { name: 'Value name' });
    fireEvent.change(names.at(-1) as HTMLInputElement, {
      target: { value: 'Todo' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'An active state already uses this name',
    );
  });

  it('uses any other active State as the explicit delete replacement', async () => {
    const user = userEvent.setup();
    mockApi();
    renderSettings();

    await user.click(
      await screen.findByRole('button', { name: 'Actions for Ready' }),
    );
    await user.click(
      await screen.findByRole('menuitem', { name: 'Delete permanently' }),
    );
    const dialog = screen.getByRole('alertdialog', { name: 'Delete Ready?' });
    await chooseSelectOption('Replacement for Ready', 'Todo');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(
        requests.some(
          ({ method, url }) =>
            method === 'DELETE' &&
            url.endsWith('/states/state-ready?replacement_id=state-todo'),
        ),
      ).toBe(true),
    );
  });
});

function renderSettings(
  section: 'states' | 'labels' = 'states',
  selectedWorkspace = workspace,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TaskConfigurationSettings
        context={{ serverUrl: 'https://kanleaf.example.com', token: 'token' }}
        workspace={selectedWorkspace}
        section={section}
        onConfigurationUpdated={vi.fn().mockResolvedValue(undefined)}
      />
    </QueryClientProvider>,
  );
}

function mockApi({ rejectCreate = false }: { rejectCreate?: boolean } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const url = String(input);
      requests.push({ method, url, body: init?.body?.toString() });
      if (method === 'GET') return jsonResponse(configuration);
      if (method === 'POST' && rejectCreate) {
        return jsonResponse(
          {
            error: {
              code: 'conflict',
              message: 'An active state already uses this name',
            },
          },
          409,
        );
      }
      if (method === 'PATCH' && url.endsWith('/task-configuration')) {
        return jsonResponse(configuration);
      }
      if (method === 'POST' && url.endsWith('/states')) {
        return jsonResponse(state('state-new', 'Todo', null, 4));
      }
      return new Response(null, { status: 204 });
    }),
  );
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function state(
  id: string,
  name: string,
  system_role: TaskState['system_role'],
  position: number,
  archived_at: string | null = null,
): TaskState {
  return {
    id,
    workspace_id: workspace.id,
    name,
    icon: system_role === 'in_progress' ? 'loader-circle' : 'circle',
    color: '#64748B',
    description: `${name} description`,
    system_role,
    position,
    archived_at,
    created_at: '2026-08-27T01:00:00Z',
    updated_at: '2026-08-27T01:00:00Z',
  };
}

const workspace: Workspace = {
  id: 'workspace-1',
  identifier: 'kanleaf',
  name: 'Kanleaf',
  accent: 'sage',
  role: 'owner',
  created_at: '2026-08-27T01:00:00Z',
  updated_at: '2026-08-27T01:00:00Z',
};

const configuration: TaskConfiguration = {
  states: [
    state('state-todo', 'Todo', 'todo', 0),
    state('state-ready', 'Ready', null, 1),
    state('state-progress', 'In Progress', 'in_progress', 2),
    state('state-done', 'Done', 'done', 3),
    state('state-deferred', 'Deferred', null, 4, '2026-08-28T01:00:00Z'),
  ],
  labels: [
    {
      id: 'label-docs',
      workspace_id: workspace.id,
      name: 'Documentation',
      icon: 'book-open',
      color: '#3B82F6',
      description: 'Docs and guides',
      position: 0,
      archived_at: null,
      created_at: '2026-08-27T01:00:00Z',
      updated_at: '2026-08-27T01:00:00Z',
    },
  ],
  default_state_id: 'state-todo',
  state_property_description: 'The current step of work.',
  label_property_description: 'Shared tags used to organize work.',
};
