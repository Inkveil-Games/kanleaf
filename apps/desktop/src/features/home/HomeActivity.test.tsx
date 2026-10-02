import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { HomeRecentPages, HomeUpcoming } from './HomeActivity';

type Props = ComponentProps<typeof HomeUpcoming>;
const task = {
  id: 't1',
  workspace_id: 'w1',
  project_id: null,
  task_number: 42,
  reference: '#42',
  title: 'Review API',
  state: {
    id: 's1',
    name: 'In progress',
    color: '#888888',
    system_role: 'in_progress' as const,
  },
  priority: 'high' as const,
  start_date: null,
  due_date: '2026-10-02',
  estimate: null,
  position: 0,
  parent: null,
  assignees: [],
  labels: [],
  cycle: null,
  modules: [],
  subtasks: [],
  subtask_progress: { completed: 0, total: 0 },
  relations: [],
  comment_count: 0,
  archived_at: null,
  created_at: '',
  updated_at: '',
};
const props: Props = {
  workspace: {
    id: 'w1',
    identifier: 'team',
    name: 'Team',
    role: 'owner',
    accent: 'sage',
    created_at: '',
    updated_at: '',
  },
  projects: [],
  navigate: vi.fn(),
  data: {
    now: new Date('2026-10-02T12:00:00Z'),
    tasksReady: true,
    pagesReady: true,
    summary: {
      todayTasks: [task],
      upcomingTasks: [task],
      overdue: 1,
      inbox: 1,
      openByProject: new Map(),
    },
    pages: [],
    tasksError: null,
    pagesError: null,
    retryTasks: vi.fn(),
    retryPages: vi.fn(),
  },
};
describe('Home activity', () => {
  it('opens My work from See all through the navigation coordinator', () => {
    render(<HomeUpcoming {...props} />);
    const link = screen.getByRole('link', { name: 'See all' });
    expect(link).toHaveAttribute('href', '/w/team/my-work');
    fireEvent.click(link);
    expect(props.navigate).toHaveBeenCalledWith(expect.anything(), {
      kind: 'my-work',
      workspaceId: 'w1',
      taskId: null,
    });
  });
  it('opens Upcoming tasks through typed My work navigation, with state, priority and stable task number', () => {
    render(<HomeUpcoming {...props} />);
    const link = screen.getByRole('link', { name: /Review API/ });
    expect(link).toHaveAttribute('href', '/w/team/my-work?task=42');
    expect(within(link).getByLabelText('Priority: High')).toBeVisible();
    expect(within(link).getByLabelText('State: In progress')).toBeVisible();
    expect(within(link).getByLabelText(/^Due:/)).toHaveAttribute(
      'datetime',
      '2026-10-02',
    );
    fireEvent.click(link);
    expect(props.navigate).toHaveBeenCalledWith(expect.anything(), {
      kind: 'my-work',
      workspaceId: 'w1',
      taskId: 't1',
    });
  });
  it('shows the actual due date and marks overdue tasks', () => {
    render(
      <HomeUpcoming
        {...props}
        data={{ ...props.data, now: new Date(2026, 9, 3, 12) }}
      />,
    );
    const date = screen.getByLabelText(/^Overdue:/);
    expect(date).toHaveAttribute('datetime', '2026-10-02');
    expect(date).toHaveClass('is-overdue');
    expect(date).toHaveTextContent('Oct 2');
  });
  it('has distinct loading, empty and retry states for Upcoming', () => {
    const { rerender } = render(
      <HomeUpcoming {...props} data={{ ...props.data, tasksReady: false }} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading tasks');
    rerender(
      <HomeUpcoming
        {...props}
        data={{
          ...props.data,
          summary: { ...props.data.summary, upcomingTasks: [] },
        }}
      />,
    );
    expect(
      screen.getByText('No upcoming tasks with a due date.'),
    ).toBeVisible();
    rerender(
      <HomeUpcoming
        {...props}
        data={{ ...props.data, tasksError: new Error('Tasks unavailable') }}
      />,
    );
    expect(screen.queryByText('Review API')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry tasks' }));
    expect(props.data.retryTasks).toHaveBeenCalledOnce();
  });
  it('opens recent Workspace and Project pages by their stable page numbers', () => {
    const page = {
      id: 'd1',
      document_number: 12,
      workspace_id: 'w1',
      project_id: null,
      parent_id: null,
      title: 'API Design',
      storage_name: 'api',
      library_path: '',
      position: 0,
      can_edit: true,
      archived_at: null,
      created_at: '',
      updated_at: '2026-10-02T12:00:00Z',
    };
    const project = {
      id: 'p1',
      workspace_id: 'w1',
      name: 'Core',
      identifier: 'core',
      description: '',
      icon: 'folder',
      visibility: 'private' as const,
      lead_user_id: null,
      default_assignee_id: null,
      default_state_id: 's1',
      cycles_enabled: false,
      modules_enabled: false,
      pages_enabled: true,
      views_enabled: false,
      effective_role: 'admin' as const,
      can_join: false,
      archived_at: null,
      created_at: '',
      updated_at: '',
    };
    render(
      <HomeRecentPages
        {...props}
        projects={[project]}
        data={{
          ...props.data,
          pages: [
            page,
            {
              ...page,
              id: 'd2',
              document_number: 13,
              project_id: 'p1',
              title: 'Release notes',
            },
          ],
        }}
      />,
    );
    expect(screen.getByRole('link', { name: /API Design/ })).toHaveAttribute(
      'href',
      '/w/team/library?page=12',
    );
    const link = screen.getByRole('link', { name: /Release notes/ });
    expect(screen.queryByText('Workspace Library')).not.toBeInTheDocument();
    expect(within(link).getByText('Core')).toBeVisible();
    expect(link).toHaveAttribute('href', '/w/team/p/core/library?page=13');
    fireEvent.click(link);
    expect(props.navigate).toHaveBeenCalledWith(expect.anything(), {
      kind: 'project-library',
      workspaceId: 'w1',
      projectId: 'p1',
      documentId: 'd2',
    });
  });
  it('shows page loading, empty and failure states without stale page links', () => {
    const { rerender } = render(
      <HomeRecentPages
        {...props}
        data={{ ...props.data, pagesReady: false }}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Loading recent pages',
    );
    rerender(<HomeRecentPages {...props} />);
    expect(screen.getByText('No pages in this Workspace yet.')).toBeVisible();
    rerender(
      <HomeRecentPages
        {...props}
        data={{ ...props.data, pagesError: new Error('Pages unavailable') }}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Pages unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry recent pages' }));
    expect(props.data.retryPages).toHaveBeenCalledOnce();
  });
});
