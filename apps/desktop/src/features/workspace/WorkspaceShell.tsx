import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useEffect, useState, type FormEvent } from 'react';
import { Wordmark } from '../../components/ui/Wordmark';
import { applyTheme } from '../account/theme';
import { SettingsShell, type SettingsSection } from '../settings/SettingsShell';
import { TaskDetailPane } from '../task/TaskDetailPane';
import { TaskListPane } from '../task/TaskListPane';
import { getTaskConfiguration } from '../task-config/api';
import type { User } from '../../lib/api/types';
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
  user: User;
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
  const [surface, setSurface] = useState<'tasks' | 'settings'>('tasks');
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>('workspace:general');
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    applyTheme(user.theme);
    return () => applyTheme('system');
  }, [user.theme]);

  const workspaces = useQuery({
    queryKey: ['workspaces', serverUrl, token],
    queryFn: () => listWorkspaces(context),
  });
  const workspaceId = activeWorkspaceId ?? workspaces.data?.[0]?.id ?? null;
  const activeWorkspace = workspaces.data?.find(({ id }) => id === workspaceId);
  const hasContentAccess = Boolean(
    activeWorkspace && activeWorkspace.role !== 'guest',
  );
  const projects = useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: () => listProjects(context, workspaceId!),
    enabled: Boolean(workspaceId && hasContentAccess && surface === 'tasks'),
  });
  const collectionKey =
    collection.kind === 'project'
      ? `${collection.kind}:${collection.projectId}`
      : collection.kind;
  const tasks = useQuery({
    queryKey: ['tasks', workspaceId, collectionKey, deferredSearch],
    queryFn: () => listTasks(context, workspaceId!, collection, deferredSearch),
    enabled: Boolean(workspaceId && hasContentAccess && surface === 'tasks'),
  });
  const taskConfiguration = useQuery({
    queryKey: ['task-configuration', workspaceId],
    queryFn: () => getTaskConfiguration(context, workspaceId!),
    enabled: Boolean(workspaceId),
  });
  const task = useQuery({
    queryKey: ['task', workspaceId, selectedTaskId],
    queryFn: () => getTask(context, workspaceId!, selectedTaskId!),
    enabled: Boolean(
      workspaceId && selectedTaskId && hasContentAccess && surface === 'tasks',
    ),
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
      if (surface === 'settings' && settingsSection.startsWith('workspace:')) {
        setSettingsSection('workspace:general');
      }
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
      setSurface('tasks');
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
    setSurface('tasks');
    setCollection(nextCollection);
    setSelectedTaskId(null);
    setSearch('');
  }

  function openSettings(section: SettingsSection) {
    setSettingsSection(section);
    setSurface('settings');
    setActionError(null);
  }

  async function refreshWorkspace() {
    await queryClient.invalidateQueries({ queryKey: ['workspaces'] });
  }

  async function refreshTaskConfiguration() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['task-configuration', workspaceId],
      }),
      queryClient.invalidateQueries({ queryKey: ['tasks', workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ['task', workspaceId] }),
    ]);
  }

  async function refreshAfterWorkspaceRemoval() {
    const result = await workspaces.refetch();
    const nextWorkspace = result.data?.find(({ id }) => id !== workspaceId);
    setActiveWorkspaceId(nextWorkspace?.id ?? null);
    setCollection({ kind: 'all' });
    setSelectedTaskId(null);
    setSearch('');
    setSurface('tasks');
    await queryClient.invalidateQueries({ queryKey: ['session'] });
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
  if (workspaces.isPending) {
    return (
      <main className="status-page" aria-live="polite">
        <Wordmark quiet />
        <p>Opening your workspace…</p>
      </main>
    );
  }
  if (!workspaceId || !activeWorkspace) {
    return (
      <EmptyWorkspace
        error={actionError}
        onCreate={addWorkspace}
        onSignOut={onSignOut}
      />
    );
  }

  const visibleTasks = tasks.data ?? [];
  const selectedListTask = visibleTasks.find(({ id }) => id === selectedTaskId);
  const selectedTask = task.data ?? selectedListTask ?? null;

  return (
    <main className="workspace-shell">
      <WorkspaceNavigation
        email={user.email}
        displayName={user.display_name}
        workspaces={workspaces.data ?? []}
        workspaceId={workspaceId}
        projects={projects.data ?? []}
        collection={collection}
        surface={surface}
        onSwitchWorkspace={switchWorkspace}
        onCreateWorkspace={addWorkspace}
        onRenameWorkspace={updateWorkspaceName}
        onCreateProject={addProject}
        onRenameProject={updateProjectName}
        onArchiveProject={removeProject}
        onSelectCollection={selectCollection}
        onOpenSettings={openSettings}
        onSignOut={onSignOut}
      />
      {surface === 'settings' ? (
        <SettingsShell
          context={context}
          user={user}
          workspace={activeWorkspace}
          workspaceCount={workspaces.data?.length ?? 0}
          section={settingsSection}
          onSectionChange={setSettingsSection}
          onClose={() => setSurface('tasks')}
          onWorkspaceUpdated={refreshWorkspace}
          onConfigurationUpdated={refreshTaskConfiguration}
          onWorkspaceRemoved={refreshAfterWorkspaceRemoval}
        />
      ) : !hasContentAccess ? (
        <section className="restricted-workspace">
          <div>
            <p className="pane-eyebrow">Guest access</p>
            <h1>No projects shared yet</h1>
            <p>
              Guests can only open projects explicitly shared with them. Ask a
              Workspace Admin to add you to a project.
            </p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => openSettings('workspace:members')}
            >
              View Workspace members
            </button>
          </div>
        </section>
      ) : (
        <>
          <TaskListPane
            collection={collection}
            projects={projects.data ?? []}
            states={taskConfiguration.data?.states ?? []}
            tasks={visibleTasks}
            selectedTaskId={selectedTaskId}
            query={search}
            loading={tasks.isPending || tasks.isFetching}
            error={tasks.error ? errorMessage(tasks.error) : null}
            onQueryChange={setSearch}
            onSelectTask={setSelectedTaskId}
            onCreateTask={addTask}
            onUpdateState={async (currentTask: Task, stateId) => {
              setActionError(null);
              try {
                await patchTask(currentTask.id, { state_id: stateId });
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
            states={taskConfiguration.data?.states ?? []}
            taskTypes={taskConfiguration.data?.task_types ?? []}
            loading={Boolean(selectedTaskId) && task.isPending}
            error={task.error ? errorMessage(task.error) : null}
            onPatch={(patch) => patchTask(selectedTaskId!, patch)}
            onArchive={removeTask}
            onClose={() => setSelectedTaskId(null)}
            onRetry={() => void task.refetch()}
          />
        </>
      )}
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

function EmptyWorkspace({
  error,
  onCreate,
  onSignOut,
}: {
  error: string | null;
  onCreate: (name: string) => Promise<void>;
  onSignOut: () => void;
}) {
  const [name, setName] = useState('My Workspace');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await onCreate(name);
    } catch {
      // The parent renders the API error while this form restores its controls.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="status-page empty-workspace-page">
      <Wordmark quiet />
      <div className="form-heading">
        <h1>Create a Workspace</h1>
        <p>You need a Workspace for projects, tasks, and Markdown documents.</p>
      </div>
      <form
        className="empty-workspace-form"
        onSubmit={(event) => void submit(event)}
      >
        <label className="settings-field">
          <span>Workspace name</span>
          <input
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button className="primary-button" type="submit" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create Workspace'}
        </button>
      </form>
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
      <button className="text-button" type="button" onClick={onSignOut}>
        Sign out
      </button>
    </main>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Request failed';
}
