import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Project } from '../workspace/types';
import { ProjectFrames } from './ProjectFrames';
import { projectExecutionGraph } from './graphProjection';
import { graphTask } from './testFixtures';

vi.mock('@xyflow/react', () => ({
  ViewportPortal: ({ children }: { children: ReactNode }) => children,
}));

function project(id: string): Project {
  return {
    id,
    workspace_id: 'workspace',
    name: id,
    identifier: id,
    description: '',
    icon: '',
    lead_user_id: null,
    visibility: 'public',
    default_assignee_id: null,
    default_state_id: 'todo',
    cycles_enabled: false,
    modules_enabled: false,
    pages_enabled: false,
    views_enabled: false,
    effective_role: 'admin',
    can_join: false,
    archived_at: null,
    created_at: '',
    updated_at: '',
  };
}

describe('Graph project frames', () => {
  it('frames only visible positioned project tasks, not Workspace tasks or empty projects', () => {
    const nodes = projectExecutionGraph([
      graphTask('web', { project_id: 'website' }),
      graphTask('mobile', { project_id: 'mobile' }),
      graphTask('inbox'),
      graphTask('pending', { project_id: 'pending' }),
    ]).nodes;
    const props = {
      nodes,
      positions: {
        web: { x: 100, y: 100 },
        mobile: { x: 500, y: 100 },
        inbox: { x: -1000, y: -1000 },
      },
      projects: ['website', 'mobile', 'empty', 'pending'].map(project),
    };
    const { rerender } = render(<ProjectFrames {...props} />);
    expect(screen.getByText('website').parentElement).toHaveStyle({
      transform: 'translate(88px, 52px)',
      width: '276px',
      height: '136px',
    });
    expect(screen.getByText('mobile')).toBeVisible();
    expect(screen.queryByText('empty')).not.toBeInTheDocument();
    expect(screen.queryByText('pending')).not.toBeInTheDocument();
    rerender(
      <ProjectFrames
        {...props}
        nodes={nodes.filter((node) => node.id === 'inbox')}
      />,
    );
    expect(screen.queryByText('website')).not.toBeInTheDocument();
    expect(screen.queryByText('mobile')).not.toBeInTheDocument();
  });
});
