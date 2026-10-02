import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaskConfiguration, Workspace } from '../workspace/types';
import { LabelSettings } from './LabelSettings';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LabelSettings', () => {
  it('edits Labels through the shared icon-free value editor', async () => {
    const user = userEvent.setup();
    const requests: Array<{ method: string; url: string; body?: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          method: init?.method ?? 'GET',
          url: input.toString(),
          body: init?.body?.toString(),
        });
        return jsonResponse(configuration.labels[0]);
      }),
    );
    const onChanged = vi.fn().mockResolvedValue(undefined);

    render(
      <LabelSettings
        context={{ serverUrl: 'https://kanleaf.example.com', token: 'token' }}
        workspace={workspace}
        configuration={configuration}
        onChanged={onChanged}
      />,
    );

    expect(screen.getByLabelText('Name')).toHaveValue('Labels');
    expect(screen.getByLabelText('Type')).toHaveValue('Multi select');
    expect(screen.queryByText('Icon')).toBeNull();
    expect(screen.queryByRole('button', { name: /icon/i })).toBeNull();

    await user.click(
      screen.getByRole('button', { name: 'Edit Documentation' }),
    );
    const editor = screen.getByRole('dialog', { name: 'Edit Documentation' });
    const name = within(editor).getByRole('textbox', { name: 'Value name' });
    fireEvent.change(name, { target: { value: 'Docs' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Save value' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(requests).toContainEqual({
        method: 'PATCH',
        url: 'https://kanleaf.example.com/api/workspaces/workspace-1/labels/label-docs',
        body: JSON.stringify({ name: 'Docs' }),
      }),
    );
    expect(onChanged).toHaveBeenCalledOnce();
  });
});

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json' },
  });
}

const workspace: Workspace = {
  id: 'workspace-1',
  identifier: 'kanleaf',
  name: 'Kanleaf',
  accent: 'sage',
  role: 'owner',
  created_at: '2026-09-24T00:00:00Z',
  updated_at: '2026-09-24T00:00:00Z',
};

const configuration: TaskConfiguration = {
  states: [],
  labels: [
    {
      id: 'label-docs',
      workspace_id: workspace.id,
      name: 'Documentation',
      color: '#3B82F6',
      description: 'Docs and guides',
      position: 0,
      archived_at: null,
      created_at: '2026-09-24T00:00:00Z',
      updated_at: '2026-09-24T00:00:00Z',
    },
  ],
  default_state_id: 'state-todo',
  default_priority: 'none',
  default_start_date: null,
  default_due_date: null,
  state_property_description: 'The current step of work.',
  default_label_ids: [],
  label_property_description: 'Shared tags used to organize work.',
};

describe('Label defaults', () => {
  it('saves multiple selected labels and clears the unchecked label', async () => {
    const user = userEvent.setup();
    const requests: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(JSON.parse(String(init?.body)));
        return jsonResponse(configuration);
      }),
    );
    render(
      <LabelSettings
        context={{ serverUrl: 'https://kanleaf.example.com', token: 'token' }}
        workspace={{ ...workspace, role: 'admin' }}
        configuration={{
          ...configuration,
          labels: [
            configuration.labels[0],
            {
              ...configuration.labels[0],
              id: 'label-product',
              name: 'Product',
              position: 1,
            },
          ],
          default_label_ids: ['label-docs', 'label-product'],
        }}
        onChanged={async () => {}}
      />,
    );
    expect(
      screen.getByRole('checkbox', { name: 'Use Documentation as default' }),
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'Use Product as default' }),
    ).toBeChecked();
    await user.click(
      screen.getByRole('checkbox', { name: 'Use Documentation as default' }),
    );
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(requests).toContainEqual({ default_label_ids: ['label-product'] }),
    );
  });

  it('maps a new default to its server ID and retries configuration without creating it twice', async () => {
    const user = userEvent.setup();
    const requests: Array<{ method?: string; url: string; body: unknown }> = [];
    let failed = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        requests.push({
          method: init?.method,
          url,
          body: JSON.parse(String(init?.body)),
        });
        if (init?.method === 'POST')
          return jsonResponse({
            ...configuration.labels[0],
            id: 'label-new',
            name: 'Web',
          });
        if (url.endsWith('task-configuration') && !failed) {
          failed = true;
          return new Response(
            JSON.stringify({
              error: { code: 'internal_error', message: 'Try again' },
            }),
            { status: 500, headers: { 'content-type': 'application/json' } },
          );
        }
        return jsonResponse(configuration);
      }),
    );
    render(
      <LabelSettings
        context={{ serverUrl: 'https://kanleaf.example.com', token: 'token' }}
        workspace={workspace}
        configuration={{ ...configuration, default_label_ids: ['label-docs'] }}
        onChanged={async () => {}}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Add label' }));
    const editor = screen.getByRole('dialog', { name: 'Add label' });
    fireEvent.change(
      within(editor).getByRole('textbox', { name: 'Value name' }),
      { target: { value: 'Web' } },
    );
    await user.click(
      within(editor).getByRole('checkbox', { name: 'Set as default' }),
    );
    await user.click(within(editor).getByRole('button', { name: 'Add label' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(requests.filter(({ method }) => method === 'POST')).toHaveLength(1);
    expect(
      requests
        .filter(({ url }) => url.endsWith('task-configuration'))
        .map(({ body }) => body),
    ).toEqual([
      { default_label_ids: ['label-docs', 'label-new'] },
      { default_label_ids: ['label-docs', 'label-new'] },
    ]);
  });

  it('shows saved defaults disabled for members', () => {
    render(
      <LabelSettings
        context={{ serverUrl: 'https://kanleaf.example.com', token: 'token' }}
        workspace={{ ...workspace, role: 'member' }}
        configuration={{ ...configuration, default_label_ids: ['label-docs'] }}
        onChanged={async () => {}}
      />,
    );
    expect(
      screen.getByRole('checkbox', { name: 'Use Documentation as default' }),
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'Use Documentation as default' }),
    ).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  });
});

// The server retains successful writes when a later step fails. Retry must use
// that persisted Label as its mutation baseline, even before query refresh.
describe.each(['configuration', 'reorder'] as const)(
  'Label retry after %s failure',
  (failureStep) => {
    it.each(['edit', 'delete', 'archive'] as const)(
      'persists %s of a newly created Label before retry',
      async (action) => {
        const user = userEvent.setup();
        const serverLabels = new Map(
          configuration.labels.map((label) => [label.id, { ...label }]),
        );
        let failed = false;
        let creates = 0;
        vi.stubGlobal(
          'fetch',
          vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = input.toString();
            const body = init?.body
              ? (JSON.parse(String(init.body)) as Record<string, unknown>)
              : {};
            if (init?.method === 'POST') {
              creates += 1;
              const label = {
                ...configuration.labels[0],
                id: 'label-new',
                name: String(body.name),
                position: 1,
              };
              serverLabels.set(label.id, label);
              return jsonResponse(label);
            }
            if (
              (failureStep === 'configuration'
                ? url.endsWith('task-configuration')
                : url.endsWith('/labels/reorder')) &&
              !failed
            ) {
              failed = true;
              return new Response(
                JSON.stringify({
                  error: { code: 'internal_error', message: 'Try again' },
                }),
                {
                  status: 500,
                  headers: { 'content-type': 'application/json' },
                },
              );
            }
            if (url.endsWith('/labels/label-new')) {
              if (init?.method === 'DELETE') {
                serverLabels.delete('label-new');
                return new Response(null, { status: 204 });
              }
              const original = serverLabels.get('label-new');
              if (!original) throw new Error('Label missing');
              const label = {
                ...original,
                ...body,
                archived_at: body.archived
                  ? '2026-10-03T00:00:00Z'
                  : original.archived_at,
              };
              serverLabels.set('label-new', label);
              return jsonResponse(label);
            }
            return jsonResponse({
              ...configuration,
              labels: [...serverLabels.values()],
            });
          }),
        );
        render(
          <LabelSettings
            context={{
              serverUrl: 'https://kanleaf.example.com',
              token: 'token',
            }}
            workspace={workspace}
            configuration={configuration}
            onChanged={async () => {}}
          />,
        );
        await user.click(screen.getByRole('button', { name: 'Add label' }));
        let editor = screen.getByRole('dialog', { name: 'Add label' });
        fireEvent.change(
          within(editor).getByRole('textbox', { name: 'Value name' }),
          { target: { value: 'Web' } },
        );
        await user.click(
          within(editor).getByRole('checkbox', { name: 'Set as default' }),
        );
        await user.click(
          within(editor).getByRole('button', { name: 'Add label' }),
        );
        await user.click(screen.getByRole('button', { name: 'Save changes' }));
        await screen.findByRole('alert');
        await user.click(screen.getByRole('button', { name: 'Edit Web' }));
        editor = screen.getByRole('dialog', { name: 'Edit Web' });
        if (action === 'edit') {
          fireEvent.change(
            within(editor).getByRole('textbox', { name: 'Value name' }),
            { target: { value: 'Android' } },
          );
          await user.click(
            within(editor).getByRole('button', { name: 'Save value' }),
          );
        } else if (action === 'archive') {
          await user.click(
            within(editor).getByRole('button', { name: 'Archive' }),
          );
        } else {
          await user.click(
            within(editor).getByRole('button', { name: 'Delete permanently' }),
          );
          await user.click(
            screen.getByRole('button', { name: 'Delete value' }),
          );
        }
        await user.click(screen.getByRole('button', { name: 'Save changes' }));
        await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
        expect(creates).toBe(1);
        if (action === 'delete')
          expect(serverLabels.has('label-new')).toBe(false);
        else if (action === 'archive')
          expect(serverLabels.get('label-new')).toMatchObject({
            archived_at: '2026-10-03T00:00:00Z',
          });
        else expect(serverLabels.get('label-new')?.name).toBe('Android');
      },
    );
  },
);
