import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { listDocuments } from '../document/api';
import { queryTasks } from '../view/api';
import { createTaskQuery } from '../view/types';
import type { ApiContext } from '../workspace/api';
import type { Task } from '../workspace/types';

const homeTaskQuery = {
  ...createTaskQuery({ kind: 'all' }),
  include_completed: false,
};

export function summarizeHomeTasks(
  tasks: Task[],
  userId: string,
  today: string,
) {
  const open = tasks.filter(
    (task) =>
      !task.archived_at &&
      task.state.system_role !== 'done' &&
      task.state.system_role !== 'cancelled',
  );
  const mine = open.filter((task) =>
    task.assignees.some((assignee) => assignee.user_id === userId),
  );
  const openByProject = new Map<string, number>();
  for (const task of open) {
    if (task.project_id)
      openByProject.set(
        task.project_id,
        (openByProject.get(task.project_id) ?? 0) + 1,
      );
  }
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3, none: 4 };
  return {
    upcomingTasks: mine
      .filter(
        (task): task is Task & { due_date: string } => task.due_date !== null,
      )
      .sort(
        (a, b) =>
          a.due_date.localeCompare(b.due_date) ||
          priorityOrder[a.priority] - priorityOrder[b.priority] ||
          a.position - b.position ||
          a.task_number - b.task_number,
      )
      .slice(0, 5),
    todayTasks: mine
      .filter((task) => task.due_date === today)
      .sort(
        (a, b) =>
          priorityOrder[a.priority] - priorityOrder[b.priority] ||
          a.position - b.position ||
          a.task_number - b.task_number,
      ),
    overdue: mine.filter((task) => task.due_date && task.due_date < today)
      .length,
    inbox: open.filter((task) => !task.project_id).length,
    openByProject,
  };
}

export function useHomeData(
  context: ApiContext,
  workspaceId: string,
  userId: string,
  accessSettled: boolean,
  canReadTasks: boolean,
  pageProjectIds: ReadonlySet<string> = new Set(),
) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const update = () => setNow(new Date());
    const interval = window.setInterval(update, 60_000);
    window.addEventListener('focus', update);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', update);
    };
  }, []);
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const tasks = useQuery({
    queryKey: ['tasks', workspaceId, 'home', context.serverUrl, context.token],
    queryFn: () => queryTasks(context, workspaceId, homeTaskQuery),
    enabled: accessSettled && canReadTasks,
    retry: false,
    staleTime: 0,
    refetchInterval: 60_000,
  });
  const documents = useQuery({
    queryKey: [
      'documents',
      workspaceId,
      'home',
      context.serverUrl,
      context.token,
    ],
    queryFn: () => listDocuments(context, workspaceId),
    enabled: accessSettled,
    retry: false,
    staleTime: 0,
    refetchInterval: 60_000,
  });
  const tasksReady =
    accessSettled && canReadTasks && tasks.isFetchedAfterMount && !tasks.error;
  const pagesReady =
    accessSettled && documents.isFetchedAfterMount && !documents.error;
  return {
    now,
    tasksReady,
    pagesReady,
    summary: summarizeHomeTasks(
      tasksReady ? (tasks.data ?? []) : [],
      userId,
      today,
    ),
    pages: pagesReady
      ? (documents.data ?? [])
          .filter(
            (page) =>
              !page.archived_at &&
              (!page.project_id || pageProjectIds.has(page.project_id)),
          )
          .sort(
            (a, b) =>
              b.updated_at.localeCompare(a.updated_at) ||
              a.title.localeCompare(b.title),
          )
          .slice(0, 5)
      : [],
    tasksError: accessSettled && canReadTasks ? tasks.error : null,
    pagesError: accessSettled ? documents.error : null,
    retryTasks: () => {
      void tasks.refetch();
    },
    retryPages: () => {
      void documents.refetch();
    },
  };
}
