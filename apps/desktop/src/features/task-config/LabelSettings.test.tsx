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
  state_property_description: 'The current step of work.',
  label_property_description: 'Shared tags used to organize work.',
};
