import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Project } from '../workspace/types';
import { ProjectViewsPane } from './ProjectViewsPane';
import { createTaskQuery, type SavedView } from './types';

describe('ProjectViewsPane', () => {
  it('lists Personal and Shared Views and opens the selected collection', () => {
    const onOpen = vi.fn();
    render(
      <ProjectViewsPane
        project={project}
        views={views}
        loading={false}
        error={null}
        canShare
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onOpen={onOpen}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Shared' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Personal' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Board layout')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Urgent work/ }));
    expect(onOpen).toHaveBeenCalledWith(views[0]);
  });

  it('creates a role-aware View from the empty state', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <ProjectViewsPane
        project={{ ...project, effective_role: 'viewer' }}
        views={[]}
        loading={false}
        error={null}
        canShare={false}
        onCreate={onCreate}
        onOpen={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Create the first View' }),
    );
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'My focus' },
    });
    expect(screen.getByRole('radio', { name: /Shared/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Create View' }));

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith('My focus', 'personal'),
    );
  });
});

const project: Project = {
  id: 'project-1',
  workspace_id: 'workspace-1',
  name: 'Kanleaf Core',
  identifier: 'KAN',
  icon: 'folder',
  description: '',
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
  archived_at: null,
  created_at: '2026-08-30T00:00:00Z',
  updated_at: '2026-08-30T00:00:00Z',
};

const query = createTaskQuery({ kind: 'project', projectId: project.id });
const views: SavedView[] = [
  {
    id: 'view-shared',
    workspace_id: project.workspace_id,
    project_id: project.id,
    owner_id: 'user-1',
    name: 'Urgent work',
    visibility: 'shared',
    query_version: 1,
    query,
    layout: 'board',
    created_at: '2026-08-30T00:00:00Z',
    updated_at: '2026-08-30T00:00:00Z',
  },
  {
    id: 'view-personal',
    workspace_id: project.workspace_id,
    project_id: project.id,
    owner_id: 'user-1',
    name: 'My focus',
    visibility: 'personal',
    query_version: 1,
    query,
    layout: 'list',
    created_at: '2026-08-30T00:00:00Z',
    updated_at: '2026-08-30T00:00:00Z',
  },
];
