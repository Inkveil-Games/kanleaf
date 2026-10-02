import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listDocuments } from '../document/api';
import type { WorkspaceDocument } from '../document/types';
import { queryTasks } from '../view/api';
import type { Task } from '../workspace/types';
import { summarizeHomeTasks, useHomeData } from './useHomeData';
vi.mock('../document/api', () => ({ listDocuments: vi.fn() }));
vi.mock('../view/api', () => ({ queryTasks: vi.fn() }));
const context = { serverUrl: 'http://localhost', token: 'session' };
function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    workspace_id: 'w1',
    project_id: 'p1',
    task_number: 1,
    reference: '#1',
    title: 'Design API',
    state: { id: 's1', name: 'Todo', color: '#888888', system_role: 'todo' },
    priority: 'high',
    start_date: null,
    due_date: '2026-10-02',
    estimate: null,
    position: 0,
    parent: null,
    assignees: [
      { user_id: 'u1', email: 'test@example.com', display_name: 'Quang' },
    ],
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
    ...overrides,
  };
}
function page(id: string, updated_at: string): WorkspaceDocument {
  return {
    id,
    title: id,
    updated_at,
    document_number: Number(id),
    workspace_id: 'w1',
    project_id: null,
    parent_id: null,
    storage_name: id,
    library_path: '',
    position: 0,
    can_edit: true,
    archived_at: null,
    created_at: updated_at,
  };
}
beforeEach(() => {
  vi.mocked(queryTasks).mockReset().mockResolvedValue([task()]);
  vi.mocked(listDocuments).mockReset().mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());
describe('Home data', () => {
  it('counts only active tasks, personal deadlines, open Inbox tasks and project totals', () => {
    const result = summarizeHomeTasks(
      [
        task(),
        task({ id: 'late', due_date: '2026-10-01' }),
        task({ id: 'other', assignees: [] }),
        task({ id: 'future', due_date: '2026-10-03' }),
        task({ id: 'inbox', project_id: null, due_date: null, assignees: [] }),
        task({ id: 'done', state: { ...task().state, system_role: 'done' } }),
        task({
          id: 'cancelled',
          state: { ...task().state, system_role: 'cancelled' },
        }),
        task({ id: 'archived', archived_at: '2026-10-01' }),
      ],
      'u1',
      '2026-10-02',
    );
    expect(result.todayTasks.map((t) => t.id)).toEqual(['t1']);
    expect(result.overdue).toBe(1);
    expect(result.inbox).toBe(1);
    expect(result.openByProject.get('p1')).toBe(4);
  });
  it('shows the five earliest due personal tasks, sorting equal dates by priority', () => {
    const result = summarizeHomeTasks(
      [
        task({ id: 'future', due_date: '2026-10-05', priority: 'critical' }),
        task({ id: 'today-low', priority: 'low' }),
        task({ id: 'today-none', priority: 'none' }),
        task({ id: 'today-high', priority: 'high' }),
        task({ id: 'today-critical', priority: 'critical' }),
        task({ id: 'today-medium', priority: 'medium' }),
        task({ id: 'overdue', due_date: '2026-10-01', priority: 'none' }),
        task({ id: 'no-date', due_date: null }),
        task({ id: 'other-user', due_date: '2026-01-01', assignees: [] }),
        task({
          id: 'done',
          due_date: '2026-01-01',
          state: { ...task().state, system_role: 'done' },
        }),
        task({
          id: 'cancelled',
          due_date: '2026-01-01',
          state: { ...task().state, system_role: 'cancelled' },
        }),
        task({
          id: 'archived',
          due_date: '2026-01-01',
          archived_at: '2026-01-01',
        }),
      ],
      'u1',
      '2026-10-02',
    );
    expect(result.upcomingTasks.map((task) => task.id)).toEqual([
      'overdue',
      'today-critical',
      'today-high',
      'today-medium',
      'today-low',
    ]);
    expect(result.todayTasks).toHaveLength(5);
  });
  it('waits for access, sorts the five recent pages and hides stale results on failure', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    vi.mocked(listDocuments).mockResolvedValue(
      Array.from({ length: 7 }, (_, i) =>
        page(String(i + 1), `2026-10-0${i + 1}T00:00:00Z`),
      ),
    );
    const { result, rerender } = renderHook(
      ({ enabled }) => useHomeData(context, 'w1', 'u1', enabled, true),
      { initialProps: { enabled: false }, wrapper },
    );
    expect(queryTasks).not.toHaveBeenCalled();
    expect(listDocuments).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.tasksReady).toBe(true));
    await waitFor(() =>
      expect(result.current.pages.map((p) => p.id)).toEqual([
        '7',
        '6',
        '5',
        '4',
        '3',
      ]),
    );
    vi.mocked(queryTasks).mockRejectedValue(new Error('Access lost'));
    vi.mocked(listDocuments).mockRejectedValue(new Error('Access lost'));
    await act(async () => {
      await client.invalidateQueries();
    });
    await waitFor(() => expect(result.current.tasksReady).toBe(false));
    expect(result.current.summary.todayTasks).toEqual([]);
    expect(result.current.pages).toEqual([]);
    rerender({ enabled: false });
    expect(result.current.pagesReady).toBe(false);
  });
  it('rolls local Today into overdue when Home regains focus after midnight', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 2, 23, 59, 50));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => useHomeData(context, 'w1', 'u1', true, true),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.summary.todayTasks).toHaveLength(1),
    );
    act(() => {
      vi.setSystemTime(new Date(2026, 9, 3, 0, 0, 50));
      window.dispatchEvent(new Event('focus'));
    });
    expect(result.current.summary.todayTasks).toHaveLength(0);
    expect(result.current.summary.overdue).toBe(1);
  });
  it('hides cached tasks on initial refresh but preserves verified tasks during background refresh', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 2, 12));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const key = ['tasks', 'w1', 'home', context.serverUrl, context.token];
    client.setQueryData(key, [task()]);
    let resolveTasks: ((tasks: Task[]) => void) | undefined;
    vi.mocked(queryTasks).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTasks = resolve;
        }),
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => useHomeData(context, 'w1', 'u1', true, true),
      { wrapper },
    );
    expect(result.current.tasksReady).toBe(false);
    expect(result.current.summary.todayTasks).toHaveLength(0);
    await act(async () => {
      resolveTasks?.([task()]);
    });
    await waitFor(() =>
      expect(result.current.summary.todayTasks).toHaveLength(1),
    );
    act(() => {
      void client.invalidateQueries({ queryKey: key });
    });
    expect(result.current.tasksReady).toBe(true);
    expect(result.current.summary.todayTasks).toHaveLength(1);
    await act(async () => {
      resolveTasks?.([]);
    });
    await waitFor(() =>
      expect(result.current.summary.todayTasks).toHaveLength(0),
    );
  });
  it('excludes unavailable project pages before limiting the recent list', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    vi.mocked(listDocuments).mockResolvedValue([
      {
        ...page('disabled', '2026-10-09T00:00:00Z'),
        project_id: 'disabled-project',
      },
      {
        ...page('archived', '2026-10-08T00:00:00Z'),
        archived_at: '2026-10-09',
      },
      ...Array.from({ length: 5 }, (_, i) =>
        page(String(i + 1), `2026-10-0${i + 1}T00:00:00Z`),
      ),
    ]);
    const { result } = renderHook(
      () => useHomeData(context, 'w1', 'u1', true, true),
      { wrapper },
    );
    await waitFor(() => expect(result.current.pagesReady).toBe(true));
    expect(result.current.pages.map((page) => page.id)).toEqual([
      '5',
      '4',
      '3',
      '2',
      '1',
    ]);
  });
  it('does not request workspace tasks for guests', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => useHomeData(context, 'w1', 'u1', true, false),
      { wrapper },
    );
    await waitFor(() => expect(result.current.pagesReady).toBe(true));
    expect(queryTasks).not.toHaveBeenCalled();
    expect(result.current.tasksReady).toBe(false);
  });
});
