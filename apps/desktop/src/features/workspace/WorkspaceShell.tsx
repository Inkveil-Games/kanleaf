import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import { Wordmark } from '../../components/ui/Wordmark';
import { TaskDetailPane } from '../task/TaskDetailPane';
import { TaskListPane } from '../task/TaskListPane';
import {
  activateWorkspace,
  archiveProject,
  archiveTask,
  createProject,
  createTask,
  createWorkspace,
  getTask,
  listProjects,
  listTasks,
  listWorkspaces,
  renameProject,
  renameWorkspace,
  updateTask,
} from './api';
import type { Collection, Task, TaskPatch } from './types';
import { WorkspaceNavigation } from './WorkspaceNavigation';

interface WorkspaceShellProps {
  serverUrl: string;
  token: string;
  user: {
    email: string;
    active_workspace_id: string | null;
  };
  onSignOut: () => void;
}

export function WorkspaceShell({
  serverUrl,
  token,
  user,
  onSignOut,
}: WorkspaceShellProps) {
  const queryClient = useQueryClient();
  const context = { serverUrl, token };
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(
    user.active_workspace_id,
  );
  const [collection, setCollection] = useState<Collection>({ kind: 'all' });
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);

  const workspaces = useQuery({
    queryKey: ['workspaces', serverUrl, token],
    queryFn: () => listWorkspaces(context),
  });
  const workspaceId = activeWorkspaceId ?? workspaces.data?.[0]?.id ?? null;
  const projects = useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: () => listProjects(context, workspaceId!),
    enabled: Boolean(workspaceId),
  });
  const collectionKey =
    collection.kind === 'project'
      ? `${collection.kind}:${collection.projectId}`
      : collection.kind;
  const tasks = useQuery({
    queryKey: ['tasks', workspaceId, collectionKey, deferredSearch],
    queryFn: () => listTasks(context, workspaceId!, collection, deferredSearch),
    enabled: Boolean(workspaceId),
  });
  const task = useQuery({
    queryKey: ['task', workspaceId, selectedTaskId],
    queryFn: () => getTask(context, workspaceId!, selectedTaskId!),
    enabled: Boolean(workspaceId && selectedTaskId),
  });

  async function switchWorkspace(nextWorkspaceId: string) {
    if (nextWorkspaceId === workspaceId) return;
    setActionError(null);
    try {
      await activateWorkspace(context, nextWorkspaceId);
      setActiveWorkspaceId(nextWorkspaceId);
      setCollection({ kind: 'all' });
      setSelectedTaskId(null);
      setSearch('');
    } catch (caught) {
      setActionError(errorMessage(caught));
    }
  }

  async function addWorkspace(name: string) {
    setActionError(null);
    try {
      const workspace = await createWorkspace(context, name);
      await queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      setActiveWorkspaceId(workspace.id);
      setCollection({ kind: 'all' });
      setSelectedTaskId(null);
    } catch (caught) {
      setActionError(errorMessage(caught));
      throw caught;
    }
  }

  async function updateWorkspaceName(name: string) {
    if (!workspaceId) return;
    setActionError(null);
    try {
      await renameWorkspace(context, workspaceId, name);
      await queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    } catch (caught) {
      setActionError(errorMessage(caught));
      throw caught;
    }
  }

  async function addProject(name: string) {
    if (!workspaceId) return;
    setActionError(null);
    try {
      const project = await createProject(context, workspaceId, name);
      await queryClient.invalidateQueries({
        queryKey: ['projects', workspaceId],
      });
      setCollection({ kind: 'project', projectId: project.id });
      setSelectedTaskId(null);
    } catch (caught) {
      setActionError(errorMessage(caught));
      throw caught;
    }
  }

  async function updateProjectName(projectId: string, name: string) {
    if (!workspaceId) return;
    setActionError(null);
    try {
      await renameProject(context, workspaceId, projectId, name);
      await queryClient.invalidateQueries({
        queryKey: ['projects', workspaceId],
      });
    } catch (caught) {
      setActionError(errorMessage(caught));
      throw caught;
    }
  }

  async function removeProject(projectId: string) {
    if (!workspaceId) return;
    setActionError(null);
    try {
      await archiveProject(context, workspaceId, projectId);
      if (collection.kind === 'project' && collection.projectId === projectId) {
        setCollection({ kind: 'inbox' });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['projects', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['tasks', workspaceId] }),
      ]);
    } catch (caught) {
      setActionError(errorMessage(caught));
    }
  }

  async function addTask(title: string) {
    if (!workspaceId) return;
    const created = await createTask(context, workspaceId, title, collection);
    setSelectedTaskId(created.id);
    queryClient.setQueryData(['task', workspaceId, created.id], created);
    await queryClient.invalidateQueries({ queryKey: ['tasks', workspaceId] });
  }

  async function patchTask(taskId: string, patch: TaskPatch) {
    if (!workspaceId) return;
    const updated = await updateTask(context, workspaceId, taskId, patch);
    queryClient.setQueryData(['task', workspaceId, taskId], updated);
    await queryClient.invalidateQueries({ queryKey: ['tasks', workspaceId] });
  }

  async function removeTask() {
    if (!workspaceId || !selectedTaskId) return;
    setActionError(null);
    try {
      await archiveTask(context, workspaceId, selectedTaskId);
      queryClient.removeQueries({
        queryKey: ['task', workspaceId, selectedTaskId],
      });
      setSelectedTaskId(null);
      await queryClient.invalidateQueries({
        queryKey: ['tasks', workspaceId],
      });
    } catch (caught) {
      setActionError(errorMessage(caught));
    }
  }

  function selectCollection(nextCollection: Collection) {
    setCollection(nextCollection);
    setSelectedTaskId(null);
    setSearch('');
  }

  if (workspaces.error) {
    return (
      <main className="status-page">
        <Wordmark quiet />
        <div className="form-heading" role="alert">
          <h1>Workspace unavailable</h1>
          <p>{errorMessage(workspaces.error)}</p>
        </div>
        <button
          className="primary-button"
          type="button"
          onClick={() => void workspaces.refetch()}
        >
          Try again
        </button>
      </main>
    );
  }
  if (workspaces.isPending || !workspaceId) {
    return (
      <main className="status-page" aria-live="polite">
        <Wordmark quiet />
        <p>Opening your workspace…</p>
      </main>
    );
  }

  const visibleTasks = tasks.data ?? [];
  const selectedListTask = visibleTasks.find(({ id }) => id === selectedTaskId);
  const selectedTask = task.data ?? selectedListTask ?? null;

  return (
    <main className="workspace-shell">
      <WorkspaceNavigation
        email={user.email}
        workspaces={workspaces.data}
        workspaceId={workspaceId}
        projects={projects.data ?? []}
        collection={collection}
        onSwitchWorkspace={switchWorkspace}
        onCreateWorkspace={addWorkspace}
        onRenameWorkspace={updateWorkspaceName}
        onCreateProject={addProject}
        onRenameProject={updateProjectName}
        onArchiveProject={removeProject}
        onSelectCollection={selectCollection}
        onSignOut={onSignOut}
      />
      <TaskListPane
        collection={collection}
        projects={projects.data ?? []}
        tasks={visibleTasks}
        selectedTaskId={selectedTaskId}
        query={search}
        loading={tasks.isPending || tasks.isFetching}
        error={tasks.error ? errorMessage(tasks.error) : null}
        onQueryChange={setSearch}
        onSelectTask={setSelectedTaskId}
        onCreateTask={addTask}
        onUpdateStatus={async (currentTask: Task, status) => {
          setActionError(null);
          try {
            await patchTask(currentTask.id, { status });
          } catch (caught) {
            setActionError(errorMessage(caught));
          }
        }}
        onRetry={() => void tasks.refetch()}
        onClearSelection={() => setSelectedTaskId(null)}
      />
      <TaskDetailPane
        serverUrl={serverUrl}
        token={token}
        workspaceId={workspaceId}
        task={selectedTask}
        projects={projects.data ?? []}
        loading={Boolean(selectedTaskId) && task.isPending}
        error={task.error ? errorMessage(task.error) : null}
        onPatch={(patch) => patchTask(selectedTaskId!, patch)}
        onArchive={removeTask}
        onClose={() => setSelectedTaskId(null)}
        onRetry={() => void task.refetch()}
      />
      {actionError && (
        <div className="toast-error" role="alert">
          <span>{actionError}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => setActionError(null)}
          >
            ×
          </button>
        </div>
      )}
    </main>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Request failed';
}
