import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Project } from '../workspace/types';
import { ProjectOverview } from './ProjectOverview';

const project: Project = {
  id: 'project-1',
  workspace_id: 'workspace-1',
  name: 'Kanleaf Core',
  identifier: 'KAN',
  icon: 'folder',
  description: 'Build the focused project workflow.',
  lead_user_id: null,
  visibility: 'public',
  default_assignee_id: null,
  default_state_id: 'state-todo',
  default_task_type_id: 'type-task',
  cycles_enabled: true,
  modules_enabled: false,
  pages_enabled: true,
  views_enabled: true,
  enabled_task_type_ids: ['type-task'],
  effective_role: 'admin',
  can_join: false,
  archived_at: null,
  created_at: '2026-08-28T00:00:00Z',
  updated_at: '2026-08-28T00:00:00Z',
};

describe('ProjectOverview', () => {
  it('opens Project work and settings for an Admin', () => {
    const openWorkItems = vi.fn();
    const openSettings = vi.fn();
    const openCycles = vi.fn();
    const openPages = vi.fn();
    const openViews = vi.fn();
    render(
      <ProjectOverview
        project={project}
        joining={false}
        onJoin={vi.fn()}
        onOpenWorkItems={openWorkItems}
        onOpenCycles={openCycles}
        onOpenModules={vi.fn()}
        onOpenPages={openPages}
        onOpenViews={openViews}
        onOpenSettings={openSettings}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Kanleaf Core' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Open Markdown Library')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /Work items/ })[0]);
    fireEvent.click(screen.getByRole('button', { name: /Cycles/ }));
    fireEvent.click(screen.getByRole('button', { name: /Library/ }));
    fireEvent.click(screen.getByRole('button', { name: /Views/ }));
    fireEvent.click(screen.getByRole('button', { name: /Settings/ }));
    expect(openWorkItems).toHaveBeenCalledOnce();
    expect(openCycles).toHaveBeenCalledOnce();
    expect(openPages).toHaveBeenCalledOnce();
    expect(openViews).toHaveBeenCalledOnce();
    expect(openSettings).toHaveBeenCalledOnce();
  });

  it('offers discovery without exposing Project controls before joining', () => {
    const join = vi.fn().mockResolvedValue(undefined);
    render(
      <ProjectOverview
        project={{ ...project, effective_role: null, can_join: true }}
        joining={false}
        onJoin={join}
        onOpenWorkItems={vi.fn()}
        onOpenCycles={vi.fn()}
        onOpenModules={vi.fn()}
        onOpenPages={vi.fn()}
        onOpenViews={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Join Project/ }));
    expect(join).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole('button', { name: /Settings/ }),
    ).not.toBeInTheDocument();
  });
});
