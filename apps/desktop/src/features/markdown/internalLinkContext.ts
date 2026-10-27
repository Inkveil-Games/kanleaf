import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useMemo } from 'react';
import { listDocuments } from '../document/api';
import { queryTasks } from '../view/api';
import { createTaskQuery } from '../view/types';
import {
  createInternalLinkIndex,
  type InternalLinkEntry,
  type InternalLinkIndex,
} from './internalLinks';

export interface InternalLinkNavigation {
  open: (entry: InternalLinkEntry) => void;
}

// Provided by the Workspace shell so documents can follow links through the
// typed location model instead of assembling routes themselves.
export const InternalLinkNavigationContext =
  createContext<InternalLinkNavigation | null>(null);

export function useInternalLinkNavigation() {
  return useContext(InternalLinkNavigationContext);
}

const allTasksQuery = createTaskQuery({ kind: 'all' });

export function useInternalLinkIndex(context: {
  serverUrl: string;
  token: string;
  workspaceId: string;
}): InternalLinkIndex | null {
  const { serverUrl, token, workspaceId } = context;
  const api = useMemo(() => ({ serverUrl, token }), [serverUrl, token]);
  const documents = useQuery({
    queryKey: ['documents', workspaceId, 'all'],
    queryFn: () => listDocuments(api, workspaceId),
    staleTime: 30_000,
  });
  const tasks = useQuery({
    queryKey: ['tasks', workspaceId, 'internal-links'],
    queryFn: () => queryTasks(api, workspaceId, allTasksQuery),
    staleTime: 30_000,
  });

  return useMemo(() => {
    // A failed or unexpected response must never take the editor down.
    const pages = Array.isArray(documents.data) ? documents.data : null;
    const taskList = Array.isArray(tasks.data) ? tasks.data : null;
    if (!pages && !taskList) return null;
    const entries: InternalLinkEntry[] = [
      ...(pages ?? [])
        .filter(({ archived_at }) => !archived_at)
        .map((document) => {
          const path = document.library_path.replace(/\.md$/i, '');
          const folders = path.split('/').slice(0, -1);
          return {
            kind: 'page' as const,
            id: document.id,
            title: document.title,
            path,
            hint:
              folders.at(-1) === 'library' ? 'Library' : (folders.at(-1) ?? ''),
            projectId: document.project_id,
          };
        }),
      ...(taskList ?? [])
        .filter(({ archived_at }) => !archived_at)
        .map((task) => ({
          kind: 'task' as const,
          id: task.id,
          title: task.title,
          path: `tasks/${task.task_number}`,
          hint: task.reference,
          projectId: task.project_id,
        })),
    ];
    return createInternalLinkIndex(entries);
  }, [documents.data, tasks.data]);
}
