import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaskConfiguration, Workspace } from '../workspace/types';
import { BuiltInPropertyDetails } from './BuiltInPropertyDetails';
import { BUILT_IN_PROPERTIES } from './builtInProperties';

const context = { serverUrl: 'https://kanleaf.example.com', token: 'token' };
const workspace: Workspace = {
  id: 'workspace-1',
  identifier: 'kanleaf',
  name: 'Kanleaf',
  accent: 'sage',
  role: 'owner',
  created_at: '',
  updated_at: '',
};
const configuration: TaskConfiguration = {
  states: ['Todo', 'Doing'].map((name, position) => ({
    id: `state-${position}`,
    workspace_id: workspace.id,
    name,
    color: '#64748B',
    description: position ? 'Work in progress.' : 'Ready to start.',
    system_role: position ? 'in_progress' : 'todo',
    position,
    archived_at: null,
    created_at: '',
    updated_at: '',
  })),
  labels: [],
  default_state_id: 'state-0',
  default_priority: 'none',
  default_start_date: null,
  default_due_date: {
    mode: 'dynamic',
    amount: 1,
    unit: 'week',
    direction: 'after',
  },
  default_label_ids: [],
  state_property_description: 'The current stage.',
  label_property_description: '',
};

afterEach(() => vi.unstubAllGlobals());

function editor(
  key: string,
  role: Workspace['role'] = 'owner',
  onChanged = async () => {},
  value = configuration,
) {
  const property = BUILT_IN_PROPERTIES.find((property) => property.key === key);
  if (!property) throw new Error('Missing test property');
  return (
    <BuiltInPropertyDetails
      context={context}
      workspace={{ ...workspace, role }}
      property={property}
      typeLabel={property.type === 'date' ? 'Date' : 'Single select'}
      configuration={value}
      onBack={() => {}}
      onChanged={onChanged}
    />
  );
}

function captureWrites() {
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const patch = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(patch);
      return new Response(
        JSON.stringify({
          ...configuration,
          ...patch,
          default_state_id: patch.state_id ?? configuration.default_state_id,
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }),
  );
  return requests;
}

describe('Built-in property defaults', () => {
  it('edits the State default and existing description without exposing value mutation', async () => {
    const user = userEvent.setup();
    const requests = captureWrites();
    render(editor('state'));
    expect(
      screen.getByRole('radio', { name: 'Use Todo as default' }),
    ).toBeChecked();
    expect(screen.getByLabelText('Name')).toHaveAttribute('readonly');
    expect(
      screen.queryByRole('button', {
        name: /add|edit|delete|archive|reorder/i,
      }),
    ).toBeNull();
    await user.click(
      screen.getByRole('radio', { name: 'Use Doing as default' }),
    );
    await user.click(
      screen.getByRole('radio', { name: 'Use Doing as default' }),
    );
    expect(
      screen.getByRole('radio', { name: 'Use Doing as default' }),
    ).toBeChecked();
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Property description' }),
      { target: { value: 'Our workflow.' } },
    );
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(requests[0]).toEqual({
        state_id: 'state-1',
        state_property_description: 'Our workflow.',
      }),
    );
    expect(
      screen.queryByText(/read-only|configuration cannot be changed/i),
    ).toBeNull();
  });

  it('loads and saves the Priority default through the same fixed values grid', async () => {
    const user = userEvent.setup();
    const requests = captureWrites();
    render(
      editor('priority', 'admin', async () => {}, {
        ...configuration,
        default_priority: 'medium',
      }),
    );
    const list = screen.getByRole('list', { name: 'Property values' });
    expect(within(list).getAllByRole('radio')).toHaveLength(5);
    for (const description of [
      'No priority assigned.',
      'Can wait until higher priorities are complete.',
      'Part of the regular workload.',
      'Needs attention soon.',
      'Needs immediate attention.',
    ])
      expect(within(list).getByText(description)).toBeVisible();
    expect(
      screen.getByRole('radio', { name: 'Use Medium as default' }),
    ).toBeChecked();
    expect(
      screen.getByRole('textbox', { name: 'Property description' }),
    ).toHaveAttribute('readonly');
    expect(
      screen.queryByRole('button', {
        name: /add|edit|delete|archive|reorder/i,
      }),
    ).toBeNull();
    const defaultControl = screen.getByRole('radio', {
      name: 'Use Critical as default',
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 100)));
    await waitFor(() =>
      expect(defaultControl.closest('[aria-disabled="true"]')).toBeNull(),
    );
    await user.click(
      screen.getByRole('radio', { name: 'Use Critical as default' }),
    );
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(requests[0]).toEqual({ default_priority: 'critical' }),
    );
  });

  it.each(['start-date', 'due-date'])(
    'saves and clears the %s shared Date editor',
    async (key) => {
      const user = userEvent.setup();
      const requests = captureWrites();
      render(editor(key));
      await user.click(screen.getByRole('button', { name: 'Fixed' }));
      expect(
        screen.getByRole('button', { name: 'Save changes' }),
      ).toBeDisabled();
      fireEvent.change(screen.getByLabelText('Fixed date'), {
        target: { value: '2026-10-15' },
      });
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      const field =
        key === 'start-date' ? 'default_start_date' : 'default_due_date';
      await waitFor(() =>
        expect(requests[0]).toEqual({
          [field]: { mode: 'fixed', date: '2026-10-15' },
        }),
      );
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Save changes' }),
        ).toBeEnabled(),
      );
      await user.click(screen.getByRole('button', { name: 'None' }));
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() => expect(requests[1]).toEqual({ [field]: null }));
    },
  );

  it.each(['state', 'priority', 'start-date', 'due-date'])(
    'allows members to inspect %s with disabled defaults and reachable Type tooltip',
    async (key) => {
      render(editor(key, 'member'));
      for (const control of [
        ...screen.queryAllByRole('radio'),
        ...screen.queryAllByRole('combobox'),
        ...screen.queryAllByRole('spinbutton'),
      ])
        expect(control).toBeDisabled();
      if (key === 'start-date' || key === 'due-date') {
        const modes = screen.getByRole('group', { name: 'Default value' });
        for (const button of within(modes).getAllByRole('button'))
          expect(button).toBeDisabled();
      }
      expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
      screen.getByRole('textbox', { name: 'Property type' }).focus();
      expect(await screen.findByRole('tooltip')).toHaveTextContent(
        'Type cannot be changed after creation.',
      );
    },
  );

  it('keeps drafts during configuration refetch and retries a failed refresh from the saved baseline', async () => {
    const user = userEvent.setup();
    const requests = captureWrites();
    let refreshes = 0;
    const onChanged = async () => {
      refreshes++;
      if (refreshes === 1) throw new Error('Refresh failed');
    };
    const { rerender } = render(editor('priority', 'owner', onChanged));
    await user.click(
      screen.getByRole('radio', { name: 'Use High as default' }),
    );
    rerender(
      editor('priority', 'owner', onChanged, {
        ...configuration,
        default_priority: 'low',
      }),
    );
    expect(
      screen.getByRole('radio', { name: 'Use High as default' }),
    ).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Refresh failed',
    );
    expect(
      screen.getByRole('radio', { name: 'Use High as default' }),
    ).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(requests).toEqual([{ default_priority: 'high' }]);
  });

  it('keeps a Date draft after a rejected write for a corrected retry', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        attempts++;
        return attempts === 1
          ? new Response(
              JSON.stringify({
                error: { code: 'validation', message: 'Invalid schedule' },
              }),
              { status: 422, headers: { 'content-type': 'application/json' } },
            )
          : new Response(JSON.stringify(configuration), {
              headers: { 'content-type': 'application/json' },
            });
      }),
    );
    render(editor('due-date'));
    fireEvent.change(
      screen.getByRole('spinbutton', { name: 'Offset amount' }),
      { target: { value: '2' } },
    );
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(
      screen.getByRole('spinbutton', { name: 'Offset amount' }),
    ).toHaveValue(2);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(attempts).toBe(2);
  });
});
