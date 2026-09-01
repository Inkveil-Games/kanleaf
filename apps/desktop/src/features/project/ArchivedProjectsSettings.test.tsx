import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project, Workspace } from '../workspace/types';
import { ArchivedProjectsSettings } from './ArchivedProjectsSettings';

const mocks = vi.hoisted(() => ({
  deleteProject: vi.fn(),
  listArchivedProjects: vi.fn(),
  restoreProject: vi.fn(),
}));

vi.mock('../workspace/api', () => ({
  deleteProject: mocks.deleteProject,
  listArchivedProjects: mocks.listArchivedProjects,
  restoreProject: mocks.restoreProject,
}));

const workspace: Workspace = {
  id: 'workspace-1',
  identifier: 'kanleaf-core',
  name: 'Kanleaf Core',
  accent: 'sage',
  role: 'owner',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

const project: Project = {
  id: 'project-1',
  workspace_id: workspace.id,
  name: 'Mobile Client',
  identifier: 'mobile-client',
  description: '',
  icon: 'rocket',
  lead_user_id: null,
  visibility: 'private',
  default_assignee_id: null,
  default_state_id: 'state-1',
  default_task_type_id: 'type-1',
  cycles_enabled: true,
  modules_enabled: true,
  pages_enabled: true,
  views_enabled: true,
  enabled_task_type_ids: ['type-1'],
  effective_role: 'admin',
  can_join: false,
  archived_at: '2026-09-02T00:00:00Z',
  created_at: workspace.created_at,
  updated_at: workspace.updated_at,
};

beforeEach(() => {
  mocks.deleteProject.mockReset().mockResolvedValue(undefined);
  mocks.listArchivedProjects.mockReset().mockResolvedValue([project]);
  mocks.restoreProject.mockReset().mockResolvedValue(undefined);
});

describe('ArchivedProjectsSettings', () => {
  it('restores an archived Project and refreshes both Project lists', async () => {
    const onProjectsChanged = vi.fn().mockResolvedValue(undefined);
    renderSettings(onProjectsChanged);

    fireEvent.click(await screen.findByRole('button', { name: /Restore/ }));

    await waitFor(() =>
      expect(mocks.restoreProject).toHaveBeenCalledWith(
        { serverUrl: 'https://kanleaf.example.com', token: 'token' },
        workspace.id,
        project.id,
      ),
    );
    expect(onProjectsChanged).toHaveBeenCalledOnce();
    expect(mocks.listArchivedProjects).toHaveBeenCalledTimes(2);
  });

  it('requires a separate delete action and the exact Project ID', async () => {
    const onProjectsChanged = vi.fn().mockResolvedValue(undefined);
    renderSettings(onProjectsChanged);

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Permanently delete Mobile Client',
      }),
    );
    expect(
      screen.getByRole('heading', {
        name: 'Delete Mobile Client permanently?',
      }),
    ).toBeVisible();
    expect(screen.getByText(/Every Task, document, view/)).toBeVisible();

    const deleteButton = screen.getByRole('button', {
      name: 'Delete Project permanently',
    });
    expect(deleteButton).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: project.identifier },
    });
    fireEvent.click(deleteButton);

    await waitFor(() =>
      expect(mocks.deleteProject).toHaveBeenCalledWith(
        { serverUrl: 'https://kanleaf.example.com', token: 'token' },
        workspace.id,
        project.id,
        project.identifier,
      ),
    );
    expect(onProjectsChanged).toHaveBeenCalledOnce();
  });
});

function renderSettings(onProjectsChanged: () => Promise<void>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ArchivedProjectsSettings
        context={{ serverUrl: 'https://kanleaf.example.com', token: 'token' }}
        workspace={workspace}
        onProjectsChanged={onProjectsChanged}
      />
    </QueryClientProvider>,
  );
}
