import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { Wordmark } from '../../components/ui/Wordmark';
import { AccountSwitcher } from '../account/AccountSwitcher';
import type { AccountSettingsSection } from '../account/AccountSettings';
import type { AccountSession } from '../auth/accountSessionStore';
import { CommandPalette } from '../command/CommandPalette';
import type { WorkspaceDocument } from '../document/types';
import { ProjectOverview } from '../project/ProjectOverview';
import { ProjectPlanningPane } from '../project/ProjectPlanningPane';
import { ProjectSettings } from '../project/ProjectSettings';
import { SettingsDialog } from '../settings/SettingsDialog';
import { DocumentWorkspace } from '../document/DocumentWorkspace';
import {
  AccountSettingsShell,
  WorkspaceSettingsShell,
} from '../settings/SettingsShell';
import { TaskDetailPane } from '../task/TaskDetailPane';
import { TaskListPane } from '../task/TaskListPane';
import { getTaskConfiguration } from '../task-config/api';
import type { User } from '../../lib/api/types';
import {
  createSavedView,
  deleteSavedView,
  listSavedViews,
  queryTasks,
  updateSavedView,
} from '../view/api';
import {
  collectionFromScope,
  createTaskQuery,
  scopeProjectId,
  type SavedView,
  type SavedViewVisibility,
  type TaskLayout,
} from '../view/types';
import { ProjectViewsPane } from '../view/ProjectViewsPane';
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
  listProjectCycles,
  listProjectModules,
  listProjects,
  listWorkspaceMembers,
  listWorkspaces,
  removeTaskRelation,
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
import { PaneResizeHandle } from './PaneResizeHandle';
import { PANE_LIMITS, useWorkspacePaneLayout } from './workspacePaneLayout';
import { WorkspaceTopBar } from './WorkspaceTopBar';
import { WorkspaceControl } from './WorkspaceControl';
import { WorkspaceImportDialog } from './WorkspaceImportDialog';

interface WorkspaceShellProps {
  serverUrl: string;
  token: string;
  user: User;
  accountSessions: AccountSession[];
  accountTransitioning: boolean;
  accountError: string | null;
  onSwitchAccount: (userId: string) => void;
  onAddAccount: () => void;
  onOpenHostConsole?: () => void;
  onDismissAccountError: () => void;
  onSignOut: () => void;
}

export function WorkspaceShell({
  serverUrl,
  token,
  user,
  accountSessions,
  accountTransitioning,
  accountError,
  onSwitchAccount,
  onAddAccount,
  onOpenHostConsole,
  onDismissAccountError,
  onSignOut,
}: WorkspaceShellProps) {
  const queryClient = useQueryClient();
  const context = { serverUrl, token };
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(
    user.active_workspace_id,
  );
  const [collection, setCollection] = useState<Collection>({ kind: 'my-work' });
  const [taskQuery, setTaskQuery] = useState(() =>
    createTaskQuery({ kind: 'my-work' }),
  );
  const [taskLayout, setTaskLayout] = useState<TaskLayout>('list');
  const [activeView, setActiveView] = useState<SavedView | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [surface, setSurface] = useState<WorkspaceSurface>('tasks');
  const [settingsModal, setSettingsModal] = useState<
    'account' | 'workspace' | 'project' | null
  >(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
    null,
  );
  const [joiningProject, setJoiningProject] = useState(false);
  const [accountSettingsSection, setAccountSettingsSection] =
    useState<AccountSettingsSection>('profile');
  const [workspaceSettingsSection, setWorkspaceSettingsSection] =
    useState<WorkspaceSettingsSection>('general');
  const paneLayout = useWorkspacePaneLayout();
  const closeNavigationDrawer = paneLayout.closeNavigationDrawer;

  useEffect(() => {
    function openCommands(event: KeyboardEvent) {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.key.toLocaleLowerCase() === 'k'
      ) {
        event.preventDefault();
        setCommandPaletteOpen((current) => !current);
      }
    }
    window.addEventListener('keydown', openCommands, true);
    return () => window.removeEventListener('keydown', openCommands, true);
  }, []);

  const workspaces = useQuery({
    queryKey: ['workspaces', serverUrl, token],
    queryFn: () => listWorkspaces(context),
  });
  const workspaceId = activeWorkspaceId ?? workspaces.data?.[0]?.id ?? null;
  const taskRequest = useMemo(
    () => ({ workspaceId, query: taskQuery }),
    [taskQuery, workspaceId],
  );
  const deferredTaskRequest = useDeferredValue(taskRequest);
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
  const visibleSurface: WorkspaceSurface =
    activeProject &&
    ((surface === 'cycles' && !activeProject.cycles_enabled) ||
      (surface === 'modules' && !activeProject.modules_enabled) ||
      (surface === 'documents' && !activeProject.pages_enabled) ||
      (surface === 'views' && !activeProject.views_enabled))
      ? 'project-overview'
      : surface;
  const queryProjectId =
    activeView?.project_id ?? scopeProjectId(taskQuery.scope);
  const hasCollectionAccess = queryProjectId
    ? Boolean(
        projects.data?.find(({ id }) => id === queryProjectId)?.effective_role,
      )
    : hasContentAccess;
  const collectionKey =
    activeView?.id ??
    (collection.kind === 'project'
      ? `${collection.kind}:${collection.projectId}`
      : collection.kind);

  useEffect(() => {
    closeNavigationDrawer();
  }, [
    activeProjectId,
    activeView?.id,
    collectionKey,
    closeNavigationDrawer,
    visibleSurface,
  ]);
  const tasks = useQuery({
    queryKey: ['tasks', workspaceId, deferredTaskRequest.query],
    queryFn: () => queryTasks(context, workspaceId!, deferredTaskRequest.query),
    enabled: Boolean(
      workspaceId &&
      deferredTaskRequest.workspaceId === workspaceId &&
      hasCollectionAccess &&
      visibleSurface === 'tasks',
    ),
  });
  const taskConfiguration = useQuery({
    queryKey: ['task-configuration', workspaceId],
    queryFn: () => getTaskConfiguration(context, workspaceId!),
    enabled: Boolean(workspaceId),
  });
  const workspaceViews = useQuery({
    queryKey: ['saved-views', workspaceId, null],
    queryFn: () => listSavedViews(context, workspaceId!, null),
    enabled: Boolean(workspaceId && hasContentAccess),
  });
  const projectViews = useQuery({
    queryKey: ['saved-views', workspaceId, activeProjectId],
    queryFn: () => listSavedViews(context, workspaceId!, activeProjectId),
    enabled: Boolean(
      workspaceId &&
      activeProjectId &&
      activeProject?.effective_role &&
      activeProject.views_enabled,
    ),
  });
  const task = useQuery({
    queryKey: ['task', workspaceId, selectedTaskId],
    queryFn: () => getTask(context, workspaceId!, selectedTaskId!),
    enabled: Boolean(
      workspaceId &&
      selectedTaskId &&
      hasCollectionAccess &&
      visibleSurface === 'tasks',
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
  const planningProjectId = selectedProjectId ?? queryProjectId;
  const selectedProject = projects.data?.find(
    ({ id }) => id === planningProjectId,
  );
  const selectedProjectCycles = useQuery({
    queryKey: ['cycles', workspaceId, planningProjectId],
    queryFn: () => listProjectCycles(context, workspaceId!, planningProjectId!),
    enabled: Boolean(
      workspaceId && planningProjectId && selectedProject?.cycles_enabled,
    ),
  });
  const selectedProjectModules = useQuery({
    queryKey: ['modules', workspaceId, planningProjectId],
    queryFn: () =>
      listProjectModules(context, workspaceId!, planningProjectId!),
    enabled: Boolean(
      workspaceId && planningProjectId && selectedProject?.modules_enabled,
    ),
  });
  const activeProjectMembers = useQuery({
    queryKey: ['project-members', workspaceId, activeProjectId],
    queryFn: () => listProjectMembers(context, workspaceId!, activeProjectId!),
    enabled: Boolean(
      workspaceId &&
      activeProjectId &&
      (visibleSurface === 'cycles' ||
        visibleSurface === 'modules' ||
        (visibleSurface === 'tasks' && collection.kind === 'project')),
    ),
  });

  function resetTaskView(nextCollection: Collection) {
    setCollection(nextCollection);
    setTaskQuery(createTaskQuery(nextCollection));
    setTaskLayout('list');
    setActiveView(null);
  }

  async function switchWorkspace(nextWorkspaceId: string) {
    if (nextWorkspaceId === workspaceId) return;
    setActionError(null);
    try {
      await activateWorkspace(context, nextWorkspaceId);
      setActiveWorkspaceId(nextWorkspaceId);
      resetTaskView({ kind: 'my-work' });
      setSelectedTaskId(null);
      setSelectedDocumentId(null);
      setActiveProjectId(null);
      setSurface('tasks');
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
      resetTaskView({ kind: 'my-work' });
      setSelectedTaskId(null);
      setSelectedDocumentId(null);
      setActiveProjectId(null);
      setSurface('tasks');
      setSettingsModal(null);
    } catch (caught) {
      setActionError(errorMessage(caught));
      throw caught;
    }
  }

  async function openImportedWorkspace(importedWorkspaceId: string) {
    await queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    await queryClient.invalidateQueries({ queryKey: ['session'] });
    setActiveWorkspaceId(importedWorkspaceId);
    resetTaskView({ kind: 'my-work' });
    setSelectedTaskId(null);
    setSelectedDocumentId(null);
    setActiveProjectId(null);
    setSurface('tasks');
    setSettingsModal(null);
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
      setSelectedDocumentId(null);
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
    resetTaskView(nextCollection);
    setActiveProjectId(
      nextCollection.kind === 'project' ? nextCollection.projectId : null,
    );
    setSelectedTaskId(null);
    setSelectedDocumentId(null);
  }

  function openSavedView(view: SavedView) {
    const nextCollection = collectionFromScope(view.query.scope);
    setCollection(nextCollection);
    setTaskQuery(view.query);
    setTaskLayout(view.layout);
    setActiveView(view);
    setActiveProjectId(view.project_id);
    setSelectedTaskId(null);
    setSelectedDocumentId(null);
    setSurface('tasks');
    setActionError(null);
  }

  function changeTaskLayout(nextLayout: TaskLayout) {
    setTaskLayout(nextLayout);
    if (nextLayout === 'board' && !taskQuery.grouping.primary) {
      setTaskQuery({
        ...taskQuery,
        grouping: { primary: 'state_group', secondary: null },
      });
    }
  }

  async function addSavedView(name: string, visibility: SavedViewVisibility) {
    if (!workspaceId) return;
    const created = await createSavedView(context, workspaceId, {
      name,
      visibility,
      project_id: activeView?.project_id ?? scopeProjectId(taskQuery.scope),
      query: taskQuery,
      layout: taskLayout,
    });
    setActiveView(created);
    await refreshSavedViewCache(created.project_id);
  }

  async function addProjectSavedView(
    name: string,
    visibility: SavedViewVisibility,
  ) {
    if (!workspaceId || !activeProjectId) return;
    const query = createTaskQuery({
      kind: 'project',
      projectId: activeProjectId,
    });
    const created = await createSavedView(context, workspaceId, {
      name,
      visibility,
      project_id: activeProjectId,
      query,
      layout: 'list',
    });
    await refreshSavedViewCache(activeProjectId);
    openSavedView(created);
  }

  async function patchSavedView(
    patch: Partial<Pick<SavedView, 'name' | 'visibility'>>,
  ) {
    if (!workspaceId || !activeView) return;
    const updated = await updateSavedView(
      context,
      workspaceId,
      activeView.id,
      patch,
    );
    setActiveView(updated);
    await refreshSavedViewCache(updated.project_id);
  }

  async function saveViewConfiguration() {
    if (!workspaceId || !activeView) return;
    const updated = await updateSavedView(context, workspaceId, activeView.id, {
      query: taskQuery,
      layout: taskLayout,
    });
    setActiveView(updated);
    await refreshSavedViewCache(updated.project_id);
  }

  async function duplicateSavedView(
    name: string,
    visibility: SavedViewVisibility,
  ) {
    await addSavedView(name, visibility);
  }

  async function removeSavedView() {
    if (!workspaceId || !activeView) return;
    if (!window.confirm(`Delete the View “${activeView.name}”?`)) return;
    const projectId = activeView.project_id;
    await deleteSavedView(context, workspaceId, activeView.id);
    setActiveView(null);
    await refreshSavedViewCache(projectId);
  }

  async function refreshSavedViewCache(projectId: string | null) {
    await queryClient.invalidateQueries({
      queryKey: ['saved-views', workspaceId, projectId],
    });
  }

  function openAccountSettings(section: AccountSettingsSection) {
    setAccountSettingsSection(section);
    setSettingsModal('account');
    setActionError(null);
  }

  async function openNotificationTask(
    notificationWorkspaceId: string,
    taskId: string,
  ) {
    setActionError(null);
    try {
      if (notificationWorkspaceId !== workspaceId) {
        await activateWorkspace(context, notificationWorkspaceId);
        setActiveWorkspaceId(notificationWorkspaceId);
      }
      resetTaskView({ kind: 'my-work' });
      setActiveProjectId(null);
      setSettingsModal(null);
      setSurface('tasks');
      setSelectedTaskId(taskId);
    } catch (caught) {
      setActionError(errorMessage(caught));
    }
  }

  function openWorkspaceSettings(section: WorkspaceSettingsSection) {
    setWorkspaceSettingsSection(section);
    setSettingsModal('workspace');
    setActionError(null);
  }

  function openProjectOverview(projectId: string) {
    setActiveView(null);
    setActiveProjectId(projectId);
    setSelectedTaskId(null);
    setSelectedDocumentId(null);
    setSurface('project-overview');
    setActionError(null);
  }

  function openProjectSettings(projectId: string) {
    setActiveProjectId(projectId);
    setSelectedTaskId(null);
    setSelectedDocumentId(null);
    setSurface('project-overview');
    setSettingsModal('project');
    setActionError(null);
  }

  function openPlanning(projectId: string, kind: 'cycles' | 'modules') {
    setActiveView(null);
    setActiveProjectId(projectId);
    setSelectedTaskId(null);
    setSelectedDocumentId(null);
    setSurface(kind);
    setActionError(null);
  }

  function openDocuments(
    projectId: string | null,
    documentId: string | null = null,
  ) {
    setActiveView(null);
    setActiveProjectId(projectId);
    setSelectedTaskId(null);
    setSelectedDocumentId(documentId);
    setTaskLayout('list');
    setSurface('documents');
    setActionError(null);
  }

  function openProjectViews(projectId: string) {
    setActiveView(null);
    setActiveProjectId(projectId);
    setSelectedTaskId(null);
    setSelectedDocumentId(null);
    setSurface('views');
    setActionError(null);
  }

  function openPlanningTask(taskId: string) {
    if (!activeProject) return;
    resetTaskView({ kind: 'project', projectId: activeProject.id });
    setSelectedTaskId(taskId);
    setSurface('tasks');
  }

  function openCommandTask(currentTask: Task) {
    resetTaskView({ kind: 'all' });
    setActiveProjectId(currentTask.project_id);
    setSelectedTaskId(currentTask.id);
    setSelectedDocumentId(null);
    setSettingsModal(null);
    setSurface('tasks');
    setActionError(null);
  }

  function openCommandDocument(document: WorkspaceDocument) {
    openDocuments(document.project_id, document.id);
    setSettingsModal(null);
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
      resetTaskView({ kind: 'project', projectId: activeProject.id });
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
    resetTaskView(hasContentAccess ? { kind: 'inbox' } : { kind: 'my-work' });
    setActiveProjectId(null);
    setSelectedTaskId(null);
    setSelectedDocumentId(null);
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
    resetTaskView({ kind: 'my-work' });
    setSelectedTaskId(null);
    setSelectedDocumentId(null);
    setActiveProjectId(null);
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

  function canCommentTask(currentTask: Task) {
    if (!currentTask.project_id) return hasContentAccess;
    const role = projects.data?.find(
      ({ id }) => id === currentTask.project_id,
    )?.effective_role;
    return Boolean(role && role !== 'viewer');
  }

  function canModerateTask(currentTask: Task) {
    if (
      activeWorkspace?.role === 'owner' ||
      activeWorkspace?.role === 'admin'
    ) {
      return true;
    }
    return Boolean(
      currentTask.project_id &&
      projects.data?.find(({ id }) => id === currentTask.project_id)
        ?.effective_role === 'admin',
    );
  }

  const canCreateTask =
    taskQuery.scope.kind === 'cycle' || taskQuery.scope.kind === 'module'
      ? false
      : queryProjectId
        ? activeProject?.effective_role === 'admin' ||
          activeProject?.effective_role === 'contributor'
        : hasContentAccess;
  const canShareView = queryProjectId
    ? activeProject?.effective_role === 'admin' ||
      activeProject?.effective_role === 'contributor'
    : activeWorkspace.role === 'owner' || activeWorkspace.role === 'admin';
  const canManageActiveView = Boolean(
    activeView &&
    (activeView.owner_id === user.id ||
      (activeView.visibility === 'shared' &&
        (activeView.project_id
          ? activeProject?.effective_role === 'admin'
          : activeWorkspace.role === 'owner' ||
            activeWorkspace.role === 'admin'))),
  );
  const canChangeActiveViewVisibility = Boolean(
    activeView && activeView.owner_id === user.id,
  );
  const viewMembers = queryProjectId
    ? (activeProjectMembers.data ?? [])
    : (workspaceMembers.data ?? []).filter(({ role }) => role !== 'guest');
  const collectionResizable =
    visibleSurface === 'documents' ||
    visibleSurface === 'cycles' ||
    visibleSurface === 'modules' ||
    (visibleSurface === 'tasks' && taskLayout === 'list');
  const detailResizable =
    visibleSurface === 'tasks' &&
    taskLayout !== 'list' &&
    Boolean(selectedTask);
  const shellClassName = [
    'workspace-shell',
    `surface-${visibleSurface}`,
    `view-layout-${taskLayout}`,
    selectedTask ? 'has-task-detail' : '',
    visibleSurface === 'documents' && selectedDocumentId
      ? 'has-document-detail'
      : '',
    paneLayout.narrow ? 'is-narrow-window' : '',
    paneLayout.navigationVisible ? '' : 'navigation-hidden',
    paneLayout.narrow && paneLayout.navigationVisible
      ? 'navigation-drawer-open'
      : '',
  ]
    .filter(Boolean)
    .join(' ');
  const shellStyle = {
    '--navigation-pane-width': `${paneLayout.navigationWidth}px`,
    '--collection-pane-width': `${paneLayout.collectionWidth}px`,
    '--detail-pane-width': `${paneLayout.detailWidth}px`,
  } as CSSProperties;

  return (
    <main className={shellClassName} style={shellStyle}>
      <WorkspaceControl
        userEmail={user.email}
        workspaces={workspaces.data ?? []}
        workspaceId={workspaceId}
        navigationVisible={paneLayout.navigationVisible}
        onSwitchWorkspace={switchWorkspace}
        onCreateWorkspace={addWorkspace}
        onOpenWorkspaceSettings={openWorkspaceSettings}
        onOpenInvitations={() => openAccountSettings('invitations')}
        onImportWorkspace={() => {
          setSettingsModal(null);
          setImportDialogOpen(true);
          setActionError(null);
        }}
        onToggleNavigation={paneLayout.toggleNavigation}
      />
      <WorkspaceTopBar
        context={context}
        onOpenNotificationTask={(notificationWorkspaceId, taskId) =>
          void openNotificationTask(notificationWorkspaceId, taskId)
        }
        onOpenInvitations={() => openAccountSettings('invitations')}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
      />
      {paneLayout.narrow && paneLayout.navigationVisible && (
        <button
          className="navigation-scrim"
          type="button"
          aria-label="Close navigation"
          onClick={paneLayout.closeNavigationDrawer}
        />
      )}
      <WorkspaceNavigation
        accountSwitcher={
          <AccountSwitcher
            accounts={accountSessions}
            activeUserId={user.id}
            transitioning={accountTransitioning}
            error={accountError}
            onSwitchAccount={onSwitchAccount}
            onAddAccount={onAddAccount}
            onOpenAccountSettings={() => openAccountSettings('profile')}
            onOpenHostConsole={onOpenHostConsole}
            onSignOutCurrent={onSignOut}
            onDismissError={onDismissAccountError}
          />
        }
        workspace={activeWorkspace}
        projects={projects.data ?? []}
        workspaceViews={workspaceViews.data ?? []}
        projectViews={projectViews.data ?? []}
        collection={collection}
        surface={visibleSurface}
        activeProjectId={activeProjectId}
        activeViewId={activeView?.id ?? null}
        onCreateProject={addProject}
        onSelectCollection={selectCollection}
        onOpenProjectOverview={openProjectOverview}
        onOpenPlanning={openPlanning}
        onOpenDocuments={openDocuments}
        onOpenViews={openProjectViews}
        onOpenSavedView={openSavedView}
      />
      {!paneLayout.narrow && paneLayout.navigationVisible && (
        <PaneResizeHandle
          className="navigation-resize-handle"
          label="Resize navigation"
          value={paneLayout.navigationWidth}
          limits={PANE_LIMITS.navigation}
          onChange={paneLayout.setNavigationWidth}
        />
      )}
      {!paneLayout.narrow && collectionResizable && (
        <PaneResizeHandle
          className="collection-resize-handle"
          label="Resize collection"
          value={paneLayout.collectionWidth}
          limits={PANE_LIMITS.collection}
          onChange={paneLayout.setCollectionWidth}
        />
      )}
      {!paneLayout.narrow && detailResizable && (
        <PaneResizeHandle
          className="detail-resize-handle"
          label="Resize detail"
          value={paneLayout.detailWidth}
          limits={PANE_LIMITS.detail}
          inverted
          onChange={paneLayout.setDetailWidth}
        />
      )}
      {visibleSurface === 'project-overview' && activeProject ? (
        <ProjectOverview
          project={activeProject}
          joining={joiningProject}
          onJoin={joinActiveProject}
          onOpenWorkItems={() =>
            selectCollection({ kind: 'project', projectId: activeProject.id })
          }
          onOpenCycles={() => openPlanning(activeProject.id, 'cycles')}
          onOpenModules={() => openPlanning(activeProject.id, 'modules')}
          onOpenPages={() => openDocuments(activeProject.id)}
          onOpenViews={() => openProjectViews(activeProject.id)}
          onOpenSettings={() => openProjectSettings(activeProject.id)}
        />
      ) : visibleSurface === 'views' && activeProject ? (
        <ProjectViewsPane
          project={activeProject}
          views={projectViews.data ?? []}
          loading={projectViews.isPending}
          error={projectViews.error ? errorMessage(projectViews.error) : null}
          canShare={
            activeProject.effective_role === 'admin' ||
            activeProject.effective_role === 'contributor'
          }
          onCreate={addProjectSavedView}
          onOpen={openSavedView}
          onRetry={() => void projectViews.refetch()}
        />
      ) : visibleSurface === 'documents' ? (
        <DocumentWorkspace
          key={`${workspaceId}:${activeProjectId ?? 'workspace'}`}
          context={context}
          workspaceId={workspaceId}
          projects={projects.data ?? []}
          projectId={activeProjectId}
          canCreateWorkspaceDocuments={hasContentAccess}
          selectedDocumentId={selectedDocumentId}
          onSelectDocument={setSelectedDocumentId}
        />
      ) : (visibleSurface === 'cycles' || visibleSurface === 'modules') &&
        activeProject &&
        (visibleSurface === 'cycles'
          ? activeProject.cycles_enabled
          : activeProject.modules_enabled) ? (
        <ProjectPlanningPane
          key={`${activeProject.id}:${visibleSurface}`}
          context={context}
          workspaceId={workspaceId}
          project={activeProject}
          members={activeProjectMembers.data ?? []}
          kind={visibleSurface}
          onOpenTask={openPlanningTask}
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
            labels={taskConfiguration.data?.labels ?? []}
            taskTypes={taskConfiguration.data?.task_types ?? []}
            cycles={selectedProjectCycles.data ?? []}
            modules={selectedProjectModules.data ?? []}
            members={viewMembers}
            tasks={visibleTasks}
            selectedTaskId={selectedTaskId}
            query={taskQuery}
            layout={taskLayout}
            activeView={activeView}
            loading={tasks.isPending || tasks.isFetching}
            error={tasks.error ? errorMessage(tasks.error) : null}
            canCreate={canCreateTask}
            canShareView={canShareView}
            canManageActiveView={canManageActiveView}
            canChangeActiveViewVisibility={canChangeActiveViewVisibility}
            canEditTask={canEditTask}
            onQueryChange={setTaskQuery}
            onLayoutChange={changeTaskLayout}
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
            onPatchTask={async (taskId, patch) => {
              setActionError(null);
              try {
                await patchTask(taskId, patch);
              } catch (caught) {
                setActionError(errorMessage(caught));
              }
            }}
            onBulkUpdate={patchTasks}
            onCreateView={addSavedView}
            onUpdateView={patchSavedView}
            onSaveViewConfiguration={saveViewConfiguration}
            onDuplicateView={duplicateSavedView}
            onDeleteView={removeSavedView}
            onViewActionError={setActionError}
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
            cycles={selectedProjectCycles.data ?? []}
            modules={selectedProjectModules.data ?? []}
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
            currentUserId={user.id}
            canComment={selectedTask ? canCommentTask(selectedTask) : false}
            canModerate={selectedTask ? canModerateTask(selectedTask) : false}
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
      {importDialogOpen && (
        <WorkspaceImportDialog
          context={context}
          onImported={openImportedWorkspace}
          onClose={() => setImportDialogOpen(false)}
        />
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
      {commandPaletteOpen && (
        <CommandPalette
          context={context}
          workspaceId={workspaceId}
          projects={projects.data ?? []}
          canUseWorkspaceContent={hasContentAccess}
          onClose={() => setCommandPaletteOpen(false)}
          onOpenCollection={selectCollection}
          onOpenProject={openProjectOverview}
          onOpenTask={openCommandTask}
          onOpenDocument={openCommandDocument}
          onOpenLibrary={() => openDocuments(null)}
          onOpenAccountSettings={() => openAccountSettings('profile')}
          onOpenWorkspaceSettings={() => openWorkspaceSettings('general')}
        />
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
