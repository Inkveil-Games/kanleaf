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
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TaskConfigurationSettings', () => {
  it('shows server validation and reorders the complete active state set', async () => {
    const user = userEvent.setup();
    mockApi({ rejectCreate: true });
    renderSettings();

    const stateName = await screen.findByPlaceholderText('State name');
    fireEvent.change(stateName, {
      target: { value: 'Todo' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add state' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'An active state already uses this name',
    );

    await user.click(screen.getByRole('button', { name: 'Actions for Done' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Move up' }));
    await waitFor(() => {
      const reorder = requests.find(
        ({ method, url }) =>
          method === 'PUT' && url.endsWith('/states/reorder'),
      );
      expect(JSON.parse(reorder?.body ?? '{}').ids).toEqual([
        'state-todo',
        'state-ready',
        'state-done',
        'state-progress',
      ]);
    });
  });

  it('requires an intentional replacement choice before deleting a used state', async () => {
    const user = userEvent.setup();
    mockApi({ rejectCreate: false });
    renderSettings();

    await user.click(
      await screen.findByRole('button', { name: 'Actions for Todo' }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete Todo' });
    await chooseSelectOption('Replacement for Todo', 'Ready');
    fireEvent.click(
      within(dialog).getByRole('button', {
        name: 'Delete',
      }),
    );

    await waitFor(() =>
      expect(
        requests.some(
          ({ method, url }) =>
            method === 'DELETE' &&
            url.endsWith('/states/state-todo?replacement_id=state-ready'),
        ),
      ).toBe(true),
    );
    expect(window.confirm).toHaveBeenCalledWith('Delete Todo?');
  });

  it('uses readable display rows and opens a label editor on demand', async () => {
    const user = userEvent.setup();
    mockApi({ rejectCreate: false });
    renderSettings('labels');

    expect(await screen.findByText('Documentation')).toBeVisible();
    expect(
      screen.queryByRole('textbox', { name: 'Documentation name' }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Actions for Documentation' }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));

    expect(
      screen.getByRole('textbox', { name: 'Documentation name' }),
    ).toHaveValue('Documentation');
    expect(
      screen.getByRole('button', {
        name: 'Change color for Documentation',
      }),
    ).toBeVisible();
  });

  it('uses a visual Task type icon picker and hides internal icon keys', async () => {
    const user = userEvent.setup();
    mockApi({ rejectCreate: false });
    renderSettings('task-types');

    expect(
      await screen.findByRole('button', { name: 'Choose Task type icon' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('textbox', { name: /icon key/i }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Actions for Task' }));
    expect(
      screen.queryByRole('menuitem', { name: 'Delete' }),
    ).not.toBeInTheDocument();
  });
});

function renderSettings(
  section: 'states' | 'labels' | 'task-types' = 'states',
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <TaskConfigurationSettings
        context={{ serverUrl: 'https://kanleaf.example.com', token: 'token' }}
        workspace={workspace}
        section={section}
        onConfigurationUpdated={vi.fn().mockResolvedValue(undefined)}
      />
    </QueryClientProvider>,
  );
}

function mockApi({ rejectCreate }: { rejectCreate: boolean }) {
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
  state_group: TaskState['state_group'],
  position: number,
): TaskState {
  return {
    id,
    workspace_id: workspace.id,
    name,
    color: '#64748B',
    state_group,
    position,
    archived_at: null,
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
    state('state-ready', 'Ready', 'todo', 1),
    state('state-progress', 'In Progress', 'in_progress', 2),
    state('state-done', 'Done', 'done', 3),
  ],
  labels: [
    {
      id: 'label-docs',
      workspace_id: workspace.id,
      name: 'Documentation',
      color: '#3B82F6',
      description: 'Docs and guides',
      archived_at: null,
      created_at: '2026-08-27T01:00:00Z',
      updated_at: '2026-08-27T01:00:00Z',
    },
  ],
  task_types: [
    {
      id: 'type-task',
      workspace_id: workspace.id,
      name: 'Task',
      icon: 'check-square',
      color: '#64748B',
      description: 'General work item',
      position: 0,
      is_protected: true,
      archived_at: null,
      created_at: '2026-08-27T01:00:00Z',
      updated_at: '2026-08-27T01:00:00Z',
    },
  ],
  default_state_id: 'state-todo',
  default_task_type_id: 'type-task',
};
