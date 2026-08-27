import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useEffect, useState, type FormEvent } from 'react';
import { Wordmark } from '../../components/ui/Wordmark';
import type { AccountSettingsSection } from '../account/AccountSettings';
import { applyTheme } from '../account/theme';
import { ProjectOverview } from '../project/ProjectOverview';
import { ProjectSettings } from '../project/ProjectSettings';
import { SettingsDialog } from '../settings/SettingsDialog';
import {
  AccountSettingsShell,
  WorkspaceSettingsShell,
} from '../settings/SettingsShell';
import { TaskDetailPane } from '../task/TaskDetailPane';
import { TaskListPane } from '../task/TaskListPane';
import { getTaskConfiguration } from '../task-config/api';
import type { User } from '../../lib/api/types';
import {
  activateWorkspace,
  addTaskRelation,
  archiveTask,
  bulkUpdateTasks,
  createProject,
  createTask,
  createWorkspace,
  deleteTask,
  getTask,
  joinProject,
  listProjectMembers,
  listProjects,
  listTasks,
  listWorkspaceMembers,
  listWorkspaces,
  removeTaskRelation,
  renameWorkspace,
  updateTask,
} from './api';
import type {
  Collection,
  Project,
  Task,
  TaskBulkPatch,
  TaskPatch,
  TaskRelationType,
} from './types';
import {
  WorkspaceNavigation,
  type WorkspaceSurface,
} from './WorkspaceNavigation';
import type { WorkspaceSettingsSection } from './WorkspaceSettings';
import { WorkspaceTopBar } from './WorkspaceTopBar';

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
  const [collection, setCollection] = useState<Collection>({ kind: 'my-work' });
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [surface, setSurface] = useState<WorkspaceSurface>('tasks');
  const [settingsModal, setSettingsModal] = useState<
    'account' | 'workspace' | 'project' | null
  >(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [joiningProject, setJoiningProject] = useState(false);
  const [accountSettingsSection, setAccountSettingsSection] =
    useState<AccountSettingsSection>('profile');
  const [workspaceSettingsSection, setWorkspaceSettingsSection] =
    useState<WorkspaceSettingsSection>('general');
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
    enabled: Boolean(workspaceId),
  });
  const activeProject = projects.data?.find(({ id }) => id === activeProjectId);
  const hasCollectionAccess =
    collection.kind === 'project'
      ? Boolean(
          projects.data?.find(({ id }) => id === collection.projectId)
            ?.effective_role,
        )
      : hasContentAccess;
  const collectionKey =
    collection.kind === 'project'
      ? `${collection.kind}:${collection.projectId}`
      : collection.kind;
  const tasks = useQuery({
    queryKey: ['tasks', workspaceId, collectionKey, deferredSearch],
    queryFn: () => listTasks(context, workspaceId!, collection, deferredSearch),
    enabled: Boolean(workspaceId && hasCollectionAccess && surface === 'tasks'),
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
      workspaceId &&
      selectedTaskId &&
      hasCollectionAccess &&
      surface === 'tasks',
    ),
  });
  const selectedProjectId =
    task.data?.project_id ??
    tasks.data?.find(({ id }) => id === selectedTaskId)?.project_id ??
    null;
  const workspaceMembers = useQuery({
    queryKey: ['workspace-members', workspaceId],
    queryFn: () => listWorkspaceMembers(context, workspaceId!),
    enabled: Boolean(workspaceId && hasContentAccess),
  });
  const selectedProjectMembers = useQuery({
    queryKey: ['project-members', workspaceId, selectedProjectId],
    queryFn: () =>
      listProjectMembers(context, workspaceId!, selectedProjectId!),
    enabled: Boolean(workspaceId && selectedProjectId),
  });

  async function switchWorkspace(nextWorkspaceId: string) {
    if (nextWorkspaceId === workspaceId) return;
    setActionError(null);
    try {
      await activateWorkspace(context, nextWorkspaceId);
      setActiveWorkspaceId(nextWorkspaceId);
      setCollection({ kind: 'my-work' });
      setSelectedTaskId(null);
      setActiveProjectId(null);
      setSearch('');
      setSettingsModal(null);
      setWorkspaceSettingsSection('general');
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
      setCollection({ kind: 'my-work' });
      setSelectedTaskId(null);
      setActiveProjectId(null);
      setSurface('tasks');
      setSettingsModal(null);
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
      setActiveProjectId(project.id);
      setSelectedTaskId(null);
      setSurface('project-overview');
      setSettingsModal(null);
    } catch (caught) {
      setActionError(errorMessage(caught));
      throw caught;
    }
  }

  async function addTask(title: string) {
    if (!workspaceId) return;
    const created = await createTask(
      context,
      workspaceId,
      title,
      collection,
      collection.kind === 'my-work' ? [user.id] : undefined,
    );
    setSelectedTaskId(created.id);
    queryClient.setQueryData(['task', workspaceId, created.id], created);
    await queryClient.invalidateQueries({ queryKey: ['tasks', workspaceId] });
  }

  async function patchTask(taskId: string, patch: TaskPatch) {
    if (!workspaceId) return;
    const updated = await updateTask(context, workspaceId, taskId, patch);
    queryClient.setQueryData(['task', workspaceId, taskId], updated);
    await refreshTaskCaches();
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
      await refreshTaskCaches();
    } catch (caught) {
      setActionError(errorMessage(caught));
    }
  }

  async function permanentlyDeleteTask(reference: string) {
    if (!workspaceId || !selectedTaskId) return;
    await deleteTask(context, workspaceId, selectedTaskId, reference);
    queryClient.removeQueries({
      queryKey: ['task', workspaceId, selectedTaskId],
    });
    setSelectedTaskId(null);
    await refreshTaskCaches();
  }

  async function patchTasks(patch: TaskBulkPatch) {
    if (!workspaceId) return;
    const updated = await bulkUpdateTasks(context, workspaceId, patch);
    for (const task of updated) {
      queryClient.setQueryData(['task', workspaceId, task.id], task);
    }
    await refreshTaskCaches();
  }

  async function addRelation(
    relatedTaskId: string,
    relationType: TaskRelationType,
  ) {
    if (!workspaceId || !selectedTaskId) return;
    const updated = await addTaskRelation(
      context,
      workspaceId,
      selectedTaskId,
      relatedTaskId,
      relationType,
    );
    queryClient.setQueryData(['task', workspaceId, selectedTaskId], updated);
    await queryClient.invalidateQueries({
      queryKey: ['task', workspaceId, relatedTaskId],
      refetchType: 'none',
    });
  }

  async function removeRelation(relatedTaskId: string) {
    if (!workspaceId || !selectedTaskId) return;
    await removeTaskRelation(
      context,
      workspaceId,
      selectedTaskId,
      relatedTaskId,
    );
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['task', workspaceId, selectedTaskId],
      }),
      queryClient.invalidateQueries({
        queryKey: ['task', workspaceId, relatedTaskId],
        refetchType: 'none',
      }),
    ]);
  }

  async function refreshTaskCaches() {
    if (!workspaceId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['tasks', workspaceId] }),
      queryClient.invalidateQueries({
        queryKey: ['task', workspaceId],
        refetchType: 'none',
      }),
    ]);
  }

  function selectCollection(nextCollection: Collection) {
    setSurface('tasks');
    setCollection(nextCollection);
    setActiveProjectId(
      nextCollection.kind === 'project' ? nextCollection.projectId : null,
    );
    setSelectedTaskId(null);
    setSearch('');
  }

  function openAccountSettings(section: AccountSettingsSection) {
    setAccountSettingsSection(section);
    setSettingsModal('account');
    setActionError(null);
  }

  function openWorkspaceSettings(section: WorkspaceSettingsSection) {
    setWorkspaceSettingsSection(section);
    setSettingsModal('workspace');
    setActionError(null);
  }

  function openProjectOverview(projectId: string) {
    setActiveProjectId(projectId);
    setSelectedTaskId(null);
    setSurface('project-overview');
    setActionError(null);
  }

  function openProjectSettings(projectId: string) {
    setActiveProjectId(projectId);
    setSelectedTaskId(null);
    setSurface('project-overview');
    setSettingsModal('project');
    setActionError(null);
  }

  async function joinActiveProject() {
    if (!workspaceId || !activeProject) return;
    setJoiningProject(true);
    setActionError(null);
    try {
      await joinProject(context, workspaceId, activeProject.id);
      await queryClient.invalidateQueries({
        queryKey: ['projects', workspaceId],
      });
      setCollection({ kind: 'project', projectId: activeProject.id });
      setSurface('tasks');
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setJoiningProject(false);
    }
  }

  async function refreshProject(updated: Project) {
    queryClient.setQueryData<Project[]>(['projects', workspaceId], (current) =>
      current?.map((project) =>
        project.id === updated.id ? updated : project,
      ),
    );
    await queryClient.invalidateQueries({
      queryKey: ['projects', workspaceId],
    });
  }

  async function refreshAfterProjectRemoval() {
    setCollection(hasContentAccess ? { kind: 'inbox' } : { kind: 'my-work' });
    setActiveProjectId(null);
    setSelectedTaskId(null);
    setSurface('tasks');
    setSettingsModal(null);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['projects', workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ['tasks', workspaceId] }),
    ]);
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
    setCollection({ kind: 'my-work' });
    setSelectedTaskId(null);
    setActiveProjectId(null);
    setSearch('');
    setSurface('tasks');
    setSettingsModal(null);
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
  const editableProjects = (projects.data ?? []).filter(
    ({ effective_role }) =>
      effective_role === 'admin' || effective_role === 'contributor',
  );

  function canEditTask(currentTask: Task) {
    if (!currentTask.project_id) return hasContentAccess;
    const project = projects.data?.find(
      ({ id }) => id === currentTask.project_id,
    );
    return (
      project?.effective_role === 'admin' ||
      project?.effective_role === 'contributor'
    );
  }

  const canCreateTask =
    collection.kind !== 'project'
      ? hasContentAccess
      : activeProject?.effective_role === 'admin' ||
        activeProject?.effective_role === 'contributor';

  return (
    <main className="workspace-shell">
      <WorkspaceTopBar
        workspaces={workspaces.data ?? []}
        workspaceId={workspaceId}
        onSwitchWorkspace={switchWorkspace}
        onCreateWorkspace={addWorkspace}
        onRenameWorkspace={updateWorkspaceName}
        onOpenWorkspaceSettings={openWorkspaceSettings}
      />
      <WorkspaceNavigation
        email={user.email}
        displayName={user.display_name}
        workspace={activeWorkspace}
        projects={projects.data ?? []}
        collection={collection}
        surface={surface}
        activeProjectId={activeProjectId}
        onCreateProject={addProject}
        onSelectCollection={selectCollection}
        onOpenProjectOverview={openProjectOverview}
        onOpenAccountSettings={openAccountSettings}
        onSignOut={onSignOut}
      />
      {surface === 'project-overview' && activeProject ? (
        <ProjectOverview
          project={activeProject}
          joining={joiningProject}
          onJoin={joinActiveProject}
          onOpenWorkItems={() =>
            selectCollection({ kind: 'project', projectId: activeProject.id })
          }
          onOpenSettings={() => openProjectSettings(activeProject.id)}
        />
      ) : !hasCollectionAccess ? (
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
              onClick={() => openWorkspaceSettings('members')}
            >
              View Workspace members
            </button>
          </div>
        </section>
      ) : (
        <>
          <TaskListPane
            key={collectionKey}
            collection={collection}
            projects={projects.data ?? []}
            states={taskConfiguration.data?.states ?? []}
            tasks={visibleTasks}
            selectedTaskId={selectedTaskId}
            query={search}
            loading={tasks.isPending || tasks.isFetching}
            error={tasks.error ? errorMessage(tasks.error) : null}
            canCreate={canCreateTask}
            canEditTask={canEditTask}
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
            onBulkUpdate={patchTasks}
            onRetry={() => void tasks.refetch()}
            onClearSelection={() => setSelectedTaskId(null)}
          />
          <TaskDetailPane
            serverUrl={serverUrl}
            token={token}
            workspaceId={workspaceId}
            task={selectedTask}
            projects={editableProjects}
            states={taskConfiguration.data?.states ?? []}
            taskTypes={taskConfiguration.data?.task_types ?? []}
            labels={taskConfiguration.data?.labels ?? []}
            assigneeCandidates={
              selectedProjectId
                ? (selectedProjectMembers.data ?? [])
                : (workspaceMembers.data ?? []).filter(
                    ({ role }) => role !== 'guest',
                  )
            }
            taskCandidates={visibleTasks}
            loading={Boolean(selectedTaskId) && task.isPending}
            error={task.error ? errorMessage(task.error) : null}
            canEdit={selectedTask ? canEditTask(selectedTask) : false}
            onPatch={(patch) => patchTask(selectedTaskId!, patch)}
            onArchive={removeTask}
            onDelete={permanentlyDeleteTask}
            onAddRelation={addRelation}
            onRemoveRelation={removeRelation}
            onOpenTask={setSelectedTaskId}
            onClose={() => setSelectedTaskId(null)}
            onRetry={() => void task.refetch()}
          />
        </>
      )}
      {settingsModal === 'account' && (
        <SettingsDialog
          label="Account settings"
          onClose={() => setSettingsModal(null)}
        >
          <AccountSettingsShell
            context={context}
            user={user}
            section={accountSettingsSection}
            onSectionChange={setAccountSettingsSection}
            onClose={() => setSettingsModal(null)}
          />
        </SettingsDialog>
      )}
      {settingsModal === 'workspace' && (
        <SettingsDialog
          label={`${activeWorkspace.name} Workspace settings`}
          onClose={() => setSettingsModal(null)}
        >
          <WorkspaceSettingsShell
            context={context}
            user={user}
            workspace={activeWorkspace}
            workspaceCount={workspaces.data?.length ?? 0}
            section={workspaceSettingsSection}
            onSectionChange={setWorkspaceSettingsSection}
            onClose={() => setSettingsModal(null)}
            onWorkspaceUpdated={refreshWorkspace}
            onConfigurationUpdated={refreshTaskConfiguration}
            onWorkspaceRemoved={refreshAfterWorkspaceRemoval}
          />
        </SettingsDialog>
      )}
      {settingsModal === 'project' && activeProject && (
        <SettingsDialog
          label={`${activeProject.name} Project settings`}
          onClose={() => setSettingsModal(null)}
        >
          <ProjectSettings
            context={context}
            workspace={activeWorkspace}
            project={activeProject}
            userId={user.id}
            configuration={
              taskConfiguration.data ?? {
                states: [],
                labels: [],
                task_types: [],
                default_state_id: activeProject.default_state_id,
                default_task_type_id: activeProject.default_task_type_id,
              }
            }
            onClose={() => setSettingsModal(null)}
            onUpdated={refreshProject}
            onRemoved={refreshAfterProjectRemoval}
          />
        </SettingsDialog>
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
