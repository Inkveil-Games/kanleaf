import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseSelectOption } from '../../test/select';
import type { Project, TaskConfiguration, Workspace } from '../workspace/types';
import {
  ProjectSettings,
  type ProjectSettingsSection,
} from './ProjectSettings';

const workspace: Workspace = {
  id: 'workspace-1',
  identifier: 'acme',
  name: 'Acme',
  accent: 'sage',
  role: 'owner',
  created_at: '2026-08-28T00:00:00Z',
  updated_at: '2026-08-28T00:00:00Z',
};

const project: Project = {
  id: 'project-1',
  workspace_id: workspace.id,
  name: 'Kanleaf Core',
  identifier: 'KAN',
  icon: 'folder',
  description: '',
  lead_user_id: null,
  visibility: 'private',
  default_assignee_id: null,
  default_state_id: 'state-todo',
  default_task_type_id: 'type-task',
  cycles_enabled: false,
  modules_enabled: false,
  pages_enabled: false,
  views_enabled: false,
  enabled_task_type_ids: ['type-task'],
  effective_role: 'admin',
  can_join: false,
  archived_at: null,
  created_at: '2026-08-28T00:00:00Z',
  updated_at: '2026-08-28T00:00:00Z',
};

const configuration: TaskConfiguration = {
  states: [],
  labels: [],
  task_types: [],
  default_state_id: 'state-todo',
  default_task_type_id: 'type-task',
};

function renderSettings(
  fetchMock: ReturnType<typeof vi.fn>,
  section: ProjectSettingsSection = 'general',
  accessSettled = true,
) {
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onUpdated = vi.fn().mockResolvedValue(undefined);
  const onSectionChange = vi.fn();
  const settings = (settled: boolean) => (
    <QueryClientProvider client={client}>
      <ProjectSettings
        context={{ serverUrl: 'https://kanleaf.example.com', token: 'token' }}
        workspace={workspace}
        project={project}
        userId="owner-1"
        accessSettled={settled}
        configuration={configuration}
        section={section}
        onSectionChange={onSectionChange}
        onClose={vi.fn()}
        onUpdated={onUpdated}
        onRemoved={vi.fn().mockResolvedValue(undefined)}
      />
    </QueryClientProvider>
  );
  const rendered = render(settings(accessSettled));
  return {
    onSectionChange,
    onUpdated,
    rerenderWithAccessSettled: (settled: boolean) =>
      rendered.rerender(settings(settled)),
  };
}

function response(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('ProjectSettings', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('waits for access to settle before loading member administration data', async () => {
    const fetchMock = vi.fn(() => response([]));
    const { rerenderWithAccessSettled } = renderSettings(
      fetchMock,
      'members',
      false,
    );

    expect(fetchMock).not.toHaveBeenCalled();

    rerenderWithAccessSettled(true);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenCalledWith(
      'https://kanleaf.example.com/api/workspaces/workspace-1/projects/project-1/members',
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://kanleaf.example.com/api/workspaces/workspace-1/members',
      expect.anything(),
    );
  });

  it('requests a section change without replacing the controlled section', () => {
    const { onSectionChange } = renderSettings(vi.fn(() => response([])));

    fireEvent.click(screen.getByRole('button', { name: 'Members' }));

    expect(onSectionChange).toHaveBeenCalledWith('members');
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'General' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('saves identity and visibility through the Project API', async () => {
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (options?.method === 'PATCH') {
        return response({
          ...project,
          description: 'Focused Core delivery.',
          visibility: 'public',
        });
      }
      if (url.endsWith('/projects/project-1/members')) {
        return response([
          {
            user_id: 'owner-1',
            email: 'owner@example.com',
            display_name: 'Owner',
            role: 'admin',
            implicit: true,
            joined_at: project.created_at,
            updated_at: project.updated_at,
          },
        ]);
      }
      return response([]);
    });
    const { onUpdated } = renderSettings(fetchMock);

    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Focused Core delivery.' },
    });
    await chooseSelectOption(
      'Visibility',
      'Public — Workspace Members can discover and join',
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Save general settings' }),
    );

    await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      'https://kanleaf.example.com/api/workspaces/workspace-1/projects/project-1',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.stringContaining('Focused Core delivery.'),
      }),
    );
    expect(
      await screen.findByText('Project details saved.'),
    ).toBeInTheDocument();
  });

  it('adds an existing Workspace Guest without offering Project Admin', async () => {
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        return response(
          {
            user_id: 'guest-1',
            email: 'guest@example.com',
            display_name: 'Guest User',
            role: 'contributor',
            implicit: false,
            joined_at: project.created_at,
            updated_at: project.updated_at,
          },
          201,
        );
      }
      if (url.endsWith('/projects/project-1/members')) return response([]);
      if (url.endsWith('/workspaces/workspace-1/members')) {
        return response([
          {
            user_id: 'guest-1',
            email: 'guest@example.com',
            display_name: 'Guest User',
            role: 'guest',
            joined_at: project.created_at,
            updated_at: project.updated_at,
          },
        ]);
      }
      return response([]);
    });
    renderSettings(fetchMock, 'members');

    const candidate = await screen.findByLabelText('Workspace member');
    await waitFor(() =>
      expect(candidate).toHaveAttribute('data-value', 'guest-1'),
    );
    fireEvent.click(screen.getByRole('combobox', { name: 'New Project role' }));
    expect(
      screen.queryByRole('option', { name: 'Admin' }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'https://kanleaf.example.com/api/workspaces/workspace-1/projects/project-1/members',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ user_id: 'guest-1', role: 'contributor' }),
        }),
      ),
    );
  });
});
