import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Wordmark } from '../../components/ui/Wordmark';
import { ApiError } from '../../lib/api/client';
import { AccountSwitcher } from '../account/AccountSwitcher';
import { WorkspaceSetupStep } from '../onboarding/WorkspaceSetupStep';
import {
  accountSettingsSections,
  isAccountSettingsSection,
  type AccountSettingsSection,
} from '../account/settingsSections';
import type { AccountSession } from '../auth/accountSessionStore';
import { CommandPalette } from '../command/CommandPalette';
import type { WorkspaceDocument } from '../document/types';
import { ProjectOverview } from '../project/ProjectOverview';
import { ProjectPlanningPane } from '../project/ProjectPlanningPane';
import { ProjectSettings } from '../project/ProjectSettings';
import {
  isProjectSettingsSection,
  projectSettingsSections,
  type ProjectSettingsSection,
} from '../project/settingsSections';
import { SettingsDialog } from '../settings/SettingsDialog';
import { DocumentWorkspace } from '../document/DocumentWorkspace';
import {
  AccountSettingsShell,
  WorkspaceSettingsShell,
} from '../settings/SettingsShell';
import { TaskDetailPane } from '../task/TaskDetailPane';
import { TaskListPane } from '../task/TaskListPane';
import { getTaskConfiguration } from '../task-config/api';
import {
  clearTaskPropertyValue,
  listProperties,
  listTaskUndefinedProperties,
  setTaskPropertyValue,
} from '../custom-properties/api';
import type { SessionResponse, User } from '../../lib/api/types';
import {
  createSavedView,
  deleteSavedView,
  getSavedView,
  listSavedViews,
  queryTasks,
  updateSavedView,
} from '../view/api';
import {
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
  ProjectCreateInput,
  Task,
  TaskBulkPatch,
  TaskPatch,
  TaskRelationType,
  TaskCustomPropertyValue,
  Workspace,
} from './types';
import {
  WorkspaceNavigation,
  type WorkspaceSurface,
} from './WorkspaceNavigation';
import {
  isWorkspaceSettingsSection,
  workspaceSettingsSections,
  type WorkspaceSettingsSection,
} from './settingsSections';
import { PaneResizeHandle } from './PaneResizeHandle';
import { PANE_LIMITS, useWorkspacePaneLayout } from './workspacePaneLayout';
import { WorkspaceTopBar } from './WorkspaceTopBar';
import { WorkspaceControl } from './WorkspaceControl';
import { WorkspaceImportDialog } from './WorkspaceImportDialog';
import type { WorkspaceIdentity } from './WorkspaceIdentityForm';
import type { WorkspaceImportOperation } from './portabilityApi';
import {
  reconcileWorkspaceLocation,
  settingsReturnTarget,
  workspaceLocationIdentity,
  type Resolution,
  type TaskCollectionLocation,
  type WorkspaceContentLocation,
  type WorkspaceLocation,
  type WorkspaceLocationAccess,
  type WorkspaceReplacementLocation,
  type WorkspaceSettingsLocation,
} from './workspaceLocation';
import { deriveWorkspacePresentation } from './workspacePresentation';

export interface WorkspaceShellProps {
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
  location: WorkspaceLocation | null;
  workspaceAccessVerified: boolean;
  onNavigate: (
    location: WorkspaceReplacementLocation,
    options?: { replace?: boolean },
  ) => void;
  flushDocumentSaves: () => Promise<void>;
}

interface TaskViewDraft {
  identity: string;
  query: ReturnType<typeof createTaskQuery>;
  layout: TaskLayout;
}

interface WorkspaceIntentResult<T> {
  latest: boolean;
  value: T | undefined;
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
  location,
  workspaceAccessVerified,
  onNavigate,
  flushDocumentSaves,
}: WorkspaceShellProps) {
  const queryClient = useQueryClient();
  const context = useMemo(() => ({ serverUrl, token }), [serverUrl, token]);
  const syncActiveWorkspace = useCallback(
    (workspaceId: string | null) => {
      queryClient.setQueryData<SessionResponse>(
        ['session', serverUrl, token],
        (current) =>
          current
            ? {
                ...current,
                user: { ...current.user, active_workspace_id: workspaceId },
              }
            : current,
      );
    },
    [queryClient, serverUrl, token],
  );
  const [taskDraft, setTaskDraft] = useState<TaskViewDraft | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [joiningProject, setJoiningProject] = useState(false);
  const activationAttempt = useRef<string | null>(null);
  const activationGeneration = useRef(0);
  const activationQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingWorkspaceIntents = useRef(0);
  const workspaceIntentOrigin = useRef<string | null>(null);
  const [activationRetry, setActivationRetry] = useState(0);
  const [directActivationError, setDirectActivationError] = useState<{
    attempt: string;
    message: string;
  } | null>(null);
  const canonicalReplacement = useRef<string | null>(null);
  const paneLayout = useWorkspacePaneLayout();
  const closeNavigationDrawer = paneLayout.closeNavigationDrawer;

  const enqueueWorkspaceIntent = useCallback(
    <T,>(generation: number, operation: () => Promise<T>) => {
      pendingWorkspaceIntents.current += 1;
      const result = activationQueue.current.then(
        async (): Promise<WorkspaceIntentResult<T>> => {
          if (activationGeneration.current !== generation) {
            return { latest: false, value: undefined };
          }
          const value = await operation();
          return {
            latest: activationGeneration.current === generation,
            value,
          };
        },
      );
      activationQueue.current = result.then(
        () => {
          pendingWorkspaceIntents.current -= 1;
        },
        () => {
          pendingWorkspaceIntents.current -= 1;
        },
      );
      return result;
    },
    [],
  );

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
  const workspaceId =
    location?.workspaceId ??
    user.active_workspace_id ??
    workspaces.data?.[0]?.id ??
    null;
  const activeWorkspace = workspaces.data?.find(({ id }) => id === workspaceId);
  const knownActiveWorkspaceId =
    queryClient.getQueryData<SessionResponse>(['session', serverUrl, token])
      ?.user.active_workspace_id ?? user.active_workspace_id;
  const hasContentAccess = Boolean(
    activeWorkspace && activeWorkspace.role !== 'guest',
  );
  const hasSettledWorkspaceAccess = Boolean(
    activeWorkspace &&
    (workspaceAccessVerified || workspaces.isFetchedAfterMount) &&
    !workspaces.error,
  );
  const hasSettledContentAccess = Boolean(
    hasSettledWorkspaceAccess && activeWorkspace?.role !== 'guest',
  );
  const routeContent = useMemo(
    () =>
      location ? deriveWorkspacePresentation(location, null).content : null,
    [location],
  );
  const routedProjectId =
    routeContent && 'projectId' in routeContent ? routeContent.projectId : null;
  const routedViewId =
    routeContent?.kind === 'workspace-view' ||
    routeContent?.kind === 'project-view'
      ? routeContent.viewId
      : null;
  const projects = useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: () => listProjects(context, workspaceId!),
    enabled: hasSettledWorkspaceAccess,
    staleTime: 15_000,
  });
  const routedProject = projects.data?.find(({ id }) => id === routedProjectId);
  const projectAccessSettled = Boolean(
    hasSettledWorkspaceAccess &&
    (workspaceAccessVerified || projects.isFetchedAfterMount) &&
    projects.data !== undefined &&
    !projects.error,
  );
  const canResolveRoutedView =
    routeContent?.kind === 'workspace-view'
      ? hasSettledContentAccess
      : routeContent?.kind === 'project-view'
        ? Boolean(routedProject?.effective_role && projectAccessSettled)
        : false;
  const savedView = useQuery({
    queryKey: ['saved-view', workspaceId, routedViewId],
    queryFn: () => getSavedView(context, workspaceId!, routedViewId!),
    enabled: Boolean(routedViewId && canResolveRoutedView),
    retry: false,
  });
  const presentation = useMemo(
    () =>
      location
        ? deriveWorkspacePresentation(location, savedView.data ?? null)
        : null,
    [location, savedView.data],
  );
  const collection = useMemo<Collection>(
    () => presentation?.collection ?? { kind: 'my-work' },
    [presentation?.collection],
  );
  const visibleSurface: WorkspaceSurface = presentation?.surface ?? 'tasks';
  const activeProjectId = presentation?.activeProjectId ?? null;
  const activeProject = projects.data?.find(({ id }) => id === activeProjectId);
  const activeView = savedView.data ?? null;
  const selectedTaskId = presentation?.selectedTaskId ?? null;
  const selectedDocumentId = presentation?.selectedDocumentId ?? null;
  const routeIdentity = location ? workspaceLocationIdentity(location) : null;
  const canonicalTaskDraft = useMemo<TaskViewDraft | null>(() => {
    if (!routeIdentity || visibleSurface !== 'tasks') return null;
    if (presentation?.activeViewId && !activeView) return null;
    return {
      identity: routeIdentity,
      query: activeView?.query ?? createTaskQuery(collection),
      layout: activeView?.layout ?? 'list',
    };
  }, [
    activeView,
    collection,
    presentation?.activeViewId,
    routeIdentity,
    visibleSurface,
  ]);

  const currentTaskDraft =
    taskDraft?.identity === routeIdentity ? taskDraft : canonicalTaskDraft;
  const taskQuery = useMemo(
    () => currentTaskDraft?.query ?? createTaskQuery(collection),
    [collection, currentTaskDraft?.query],
  );
  const taskLayout = currentTaskDraft?.layout ?? 'list';
  const taskDraftReady =
    visibleSurface !== 'tasks' || currentTaskDraft !== null;
  const taskRequest = useMemo(
    () => ({ workspaceId, query: taskQuery }),
    [taskQuery, workspaceId],
  );
  const deferredTaskRequest = useDeferredValue(taskRequest);
  const queryProjectId =
    activeView?.project_id ?? scopeProjectId(taskQuery.scope);
  const hasCollectionAccess = queryProjectId
    ? Boolean(
        projects.data?.find(({ id }) => id === queryProjectId)?.effective_role,
      )
    : hasContentAccess;
  const hasSettledCollectionAccess = queryProjectId
    ? Boolean(
        projectAccessSettled &&
        projects.data?.find(({ id }) => id === queryProjectId)?.effective_role,
      )
    : hasSettledContentAccess;
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
      taskDraftReady &&
      hasSettledCollectionAccess &&
      visibleSurface === 'tasks',
    ),
  });
  const taskConfiguration = useQuery({
    queryKey: ['task-configuration', workspaceId],
    queryFn: () => getTaskConfiguration(context, workspaceId!),
    enabled: hasSettledWorkspaceAccess,
  });
  const customProperties = useQuery({
    queryKey: ['custom-properties', workspaceId],
    queryFn: () => listProperties(context, workspaceId!),
    enabled: hasSettledWorkspaceAccess,
  });
  const workspaceViews = useQuery({
    queryKey: ['saved-views', workspaceId, null],
    queryFn: () => listSavedViews(context, workspaceId!, null),
    enabled: hasSettledContentAccess,
  });
  const projectViews = useQuery({
    queryKey: ['saved-views', workspaceId, activeProjectId],
    queryFn: () => listSavedViews(context, workspaceId!, activeProjectId),
    enabled: Boolean(
      workspaceId &&
      activeProjectId &&
      projectAccessSettled &&
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
      taskDraftReady &&
      hasSettledCollectionAccess &&
      visibleSurface === 'tasks',
    ),
    retry: false,
  });
  const undefinedTaskProperties = useQuery({
    queryKey: ['task-undefined-properties', workspaceId, selectedTaskId],
    queryFn: () =>
      listTaskUndefinedProperties(context, workspaceId!, selectedTaskId!),
    enabled: Boolean(
      workspaceId &&
      selectedTaskId &&
      task.data &&
      hasSettledCollectionAccess &&
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
    enabled: Boolean(
      workspaceId &&
      hasSettledContentAccess &&
      visibleSurface === 'tasks' &&
      !queryProjectId,
    ),
  });
  const selectedProjectMembers = useQuery({
    queryKey: ['project-members', workspaceId, selectedProjectId],
    queryFn: () =>
      listProjectMembers(context, workspaceId!, selectedProjectId!),
    enabled: Boolean(
      workspaceId &&
      selectedTaskId &&
      selectedProjectId &&
      visibleSurface === 'tasks' &&
      projectAccessSettled &&
      projects.data?.find(({ id }) => id === selectedProjectId)?.effective_role,
    ),
  });
  const planningProjectId = selectedProjectId ?? queryProjectId;
  const selectedProject = projects.data?.find(
    ({ id }) => id === planningProjectId,
  );
  const selectedProjectCycles = useQuery({
    queryKey: ['cycles', workspaceId, planningProjectId],
    queryFn: () => listProjectCycles(context, workspaceId!, planningProjectId!),
    enabled: Boolean(
      workspaceId &&
      planningProjectId &&
      visibleSurface === 'tasks' &&
      projectAccessSettled &&
      selectedProject?.effective_role &&
      selectedProject.cycles_enabled,
    ),
  });
  const selectedProjectModules = useQuery({
    queryKey: ['modules', workspaceId, planningProjectId],
    queryFn: () =>
      listProjectModules(context, workspaceId!, planningProjectId!),
    enabled: Boolean(
      workspaceId &&
      planningProjectId &&
      visibleSurface === 'tasks' &&
      projectAccessSettled &&
      selectedProject?.effective_role &&
      selectedProject.modules_enabled,
    ),
  });
  const activeProjectMembers = useQuery({
    queryKey: ['project-members', workspaceId, activeProjectId],
    queryFn: () => listProjectMembers(context, workspaceId!, activeProjectId!),
    enabled: Boolean(
      workspaceId &&
      activeProjectId &&
      projectAccessSettled &&
      activeProject?.effective_role &&
      (visibleSurface === 'cycles' ||
        visibleSurface === 'modules' ||
        (visibleSurface === 'tasks' && collection.kind === 'project')),
    ),
  });

  const access = useMemo<WorkspaceLocationAccess>(
    () => ({
      activeWorkspaceId: user.active_workspace_id,
      workspaces: queryResolution(workspaces),
      ...(routedProjectId
        ? { project: listItemResolution(projects, routedProject) }
        : {}),
      ...(routedViewId
        ? {
            savedView: queryResolution(savedView),
          }
        : {}),
      ...(selectedTaskId ? { task: queryResolution(task) } : {}),
      ...(location && isSettingsLocation(location)
        ? {
            settingsSections: settingsSectionResolution(
              location,
              activeWorkspace?.role,
            ),
          }
        : {}),
    }),
    [
      activeWorkspace?.role,
      location,
      projects,
      routedProject,
      routedProjectId,
      routedViewId,
      savedView,
      selectedTaskId,
      task,
      user.active_workspace_id,
      workspaces,
    ],
  );
  const reconciliation = useMemo(
    () => (location ? reconcileWorkspaceLocation(location, access) : null),
    [access, location],
  );
  const replacementKey =
    reconciliation?.status === 'replace'
      ? JSON.stringify({ from: location, ...reconciliation })
      : null;

  useEffect(() => {
    if (pendingWorkspaceIntents.current > 0) return;

    if (!location) {
      if (workspaces.isFetching || workspaces.error) return;
      const target =
        workspaces.data?.find(({ id }) => id === user.active_workspace_id) ??
        workspaces.data?.[0];
      if (target) {
        onNavigate(
          { kind: 'my-work', workspaceId: target.id, taskId: null },
          { replace: true },
        );
      }
      return;
    }

    if (reconciliation?.status !== 'replace' || !replacementKey) {
      canonicalReplacement.current = null;
      return;
    }
    if (canonicalReplacement.current === replacementKey) return;

    canonicalReplacement.current = replacementKey;
    if (reconciliation.notice === 'task-unavailable') {
      window.setTimeout(() => {
        setActionError(
          'That Task is unavailable or you no longer have access.',
        );
      });
    }
    onNavigate(reconciliation.location, { replace: true });
  }, [
    location,
    onNavigate,
    reconciliation,
    replacementKey,
    user.active_workspace_id,
    workspaces.data,
    workspaces.error,
    workspaces.isFetching,
  ]);

  useEffect(() => {
    if (
      !location ||
      !activeWorkspace ||
      workspaces.isFetching ||
      workspaces.error
    ) {
      return;
    }

    const attempt = `${user.id}:${activeWorkspace.id}`;
    if (activationAttempt.current === attempt) return;
    if (workspaceIntentOrigin.current === activeWorkspace.id) return;
    activationAttempt.current = attempt;
    const generation = ++activationGeneration.current;
    setDirectActivationError(null);
    const needsActivation =
      knownActiveWorkspaceId !== activeWorkspace.id ||
      pendingWorkspaceIntents.current > 0;
    if (!needsActivation) return;

    void enqueueWorkspaceIntent(generation, () =>
      activateWorkspace(context, activeWorkspace.id),
    )
      .then((result) => {
        if (result.latest) syncActiveWorkspace(activeWorkspace.id);
      })
      .catch((caught) => {
        if (activationGeneration.current !== generation) return;
        setDirectActivationError({
          attempt,
          message: errorMessage(caught),
        });
      });
  }, [
    activationRetry,
    activeWorkspace,
    context,
    enqueueWorkspaceIntent,
    location,
    knownActiveWorkspaceId,
    syncActiveWorkspace,
    user.active_workspace_id,
    user.id,
    workspaces.error,
    workspaces.isFetching,
  ]);

  const prepareDocumentMutation = useCallback(async () => {
    setActionError(null);
    try {
      await flushDocumentSaves();
      return true;
    } catch (caught) {
      setActionError(errorMessage(caught));
      return false;
    }
  }, [flushDocumentSaves]);

  const navigateSafely = useCallback(
    async (
      nextLocation: WorkspaceReplacementLocation,
      options?: { replace?: boolean },
    ) => {
      if (!(await prepareDocumentMutation())) return false;
      onNavigate(nextLocation, options);
      return true;
    },
    [onNavigate, prepareDocumentMutation],
  );

  const navigateTask = useCallback(
    (taskId: string | null, replace = false) => {
      if (!presentation || !hasTaskSelection(presentation.content)) return;
      void navigateSafely(
        { ...presentation.content, taskId },
        replace ? { replace: true } : undefined,
      );
    },
    [navigateSafely, presentation],
  );

  async function switchWorkspace(nextWorkspaceId: string) {
    const repairsPendingIntent = pendingWorkspaceIntents.current > 0;
    const generation = ++activationGeneration.current;
    setActionError(null);
    setDirectActivationError(null);
    if (nextWorkspaceId === workspaceId && !repairsPendingIntent) return;
    workspaceIntentOrigin.current = workspaceId;
    try {
      const result = await enqueueWorkspaceIntent(generation, async () => {
        await flushDocumentSaves();
        await activateWorkspace(context, nextWorkspaceId);
      });
      if (!result.latest) return;
      activationAttempt.current = `${user.id}:${nextWorkspaceId}`;
      syncActiveWorkspace(nextWorkspaceId);
      if (nextWorkspaceId !== workspaceId) {
        onNavigate({
          kind: 'my-work',
          workspaceId: nextWorkspaceId,
          taskId: null,
        });
      }
      clearWorkspaceIntentOrigin(workspaceId);
    } catch (caught) {
      if (activationGeneration.current !== generation) return;
      workspaceIntentOrigin.current = null;
      setActionError(errorMessage(caught));
    }
  }

  async function addWorkspace(
    identity: WorkspaceIdentity,
    invalidateMemberships = true,
  ) {
    const generation = ++activationGeneration.current;
    setActionError(null);
    setDirectActivationError(null);
    workspaceIntentOrigin.current = workspaceId;
    try {
      const result = await enqueueWorkspaceIntent(generation, async () => {
        await flushDocumentSaves();
        const workspace = await createWorkspace(
          context,
          identity.name,
          identity.identifier,
        );
        if (invalidateMemberships) {
          await queryClient.invalidateQueries({ queryKey: ['workspaces'] });
        }
        return workspace;
      });
      if (!result.latest || !result.value) {
        throw new Error('A newer Workspace change took precedence');
      }
      return result.value;
    } catch (caught) {
      if (activationGeneration.current === generation) {
        workspaceIntentOrigin.current = null;
        setActionError(errorMessage(caught));
      }
      throw caught;
    }
  }

  function finishWorkspaceCreation(workspace: Workspace) {
    activationAttempt.current = `${user.id}:${workspace.id}`;
    syncActiveWorkspace(workspace.id);
    onNavigate({
      kind: 'my-work',
      workspaceId: workspace.id,
      taskId: null,
    });
    clearWorkspaceIntentOrigin(workspaceId);
  }

  async function finishRecoveryWorkspace(workspace: Workspace) {
    await queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    finishWorkspaceCreation(workspace);
  }

  async function finishWorkspaceJoin(joinedWorkspace: Workspace) {
    await switchWorkspace(joinedWorkspace.id);
  }

  async function applyWorkspaceImportIntent(
    apply: () => Promise<WorkspaceImportOperation>,
  ): Promise<WorkspaceImportOperation | null> {
    const generation = ++activationGeneration.current;
    setActionError(null);
    setDirectActivationError(null);
    workspaceIntentOrigin.current = workspaceId;
    try {
      const result = await enqueueWorkspaceIntent(generation, async () => {
        await flushDocumentSaves();
        const applied = await apply();
        if (applied.state !== 'completed' || !applied.workspace_id) {
          return applied;
        }
        await queryClient.invalidateQueries({ queryKey: ['workspaces'] });
        if (activationGeneration.current === generation) {
          await activateWorkspace(context, applied.workspace_id);
        }
        return applied;
      });
      if (!result.latest || !result.value) return null;
      const importedWorkspaceId = result.value.workspace_id;
      if (result.value.state !== 'completed' || !importedWorkspaceId) {
        return result.value;
      }
      activationAttempt.current = `${user.id}:${importedWorkspaceId}`;
      syncActiveWorkspace(importedWorkspaceId);
      onNavigate({
        kind: 'my-work',
        workspaceId: importedWorkspaceId,
        taskId: null,
      });
      clearWorkspaceIntentOrigin(workspaceId);
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      return result.value;
    } catch (caught) {
      if (activationGeneration.current !== generation) return null;
      workspaceIntentOrigin.current = null;
      setActionError(errorMessage(caught));
      throw caught;
    }
  }

  async function addProject(input: ProjectCreateInput): Promise<Project> {
    if (!workspaceId) throw new Error('Choose a Workspace first.');
    setActionError(null);
    try {
      await flushDocumentSaves();
      const project = await createProject(context, workspaceId, input);
      await queryClient.invalidateQueries({
        queryKey: ['projects', workspaceId],
      });
      onNavigate({
        kind: 'project-overview',
        workspaceId,
        projectId: project.id,
      });
      return project;
    } catch (caught) {
      setActionError(errorMessage(caught));
      throw caught;
    }
  }

  async function addTask(title: string) {
    const taskLocation = presentation?.content;
    if (
      !workspaceId ||
      !taskLocation ||
      !hasTaskSelection(taskLocation) ||
      !(await prepareDocumentMutation())
    ) {
      return;
    }
    const created = await createTask(
      context,
      workspaceId,
      title,
      collection,
      collection.kind === 'my-work' ? [user.id] : undefined,
    );
    queryClient.setQueryData(['task', workspaceId, created.id], created);
    await queryClient.invalidateQueries({ queryKey: ['tasks', workspaceId] });
    onNavigate({ ...taskLocation, taskId: created.id });
  }

  async function patchTask(taskId: string, patch: TaskPatch) {
    if (!workspaceId) return;
    const updated = await updateTask(context, workspaceId, taskId, patch);
    queryClient.setQueryData(['task', workspaceId, taskId], updated);
    await refreshTaskCaches();
  }

  async function changeTaskProperty(
    taskId: string,
    propertyId: string,
    value?: TaskCustomPropertyValue['value'],
  ) {
    if (!workspaceId) return;
    if (value === undefined) {
      await clearTaskPropertyValue(context, workspaceId, taskId, propertyId);
    } else {
      await setTaskPropertyValue(
        context,
        workspaceId,
        taskId,
        propertyId,
        value,
      );
    }
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['task', workspaceId, taskId],
      }),
      queryClient.invalidateQueries({ queryKey: ['tasks', workspaceId] }),
    ]);
  }

  async function removeTask() {
    const taskLocation = presentation?.content;
    if (
      !workspaceId ||
      !selectedTaskId ||
      !taskLocation ||
      !hasTaskSelection(taskLocation)
    ) {
      return;
    }
    setActionError(null);
    try {
      await flushDocumentSaves();
      await archiveTask(context, workspaceId, selectedTaskId);
      queryClient.removeQueries({
        queryKey: ['task', workspaceId, selectedTaskId],
      });
      onNavigate({ ...taskLocation, taskId: null }, { replace: true });
      await refreshTaskCaches();
    } catch (caught) {
      setActionError(errorMessage(caught));
    }
  }

  async function permanentlyDeleteTask(reference: string) {
    const taskLocation = presentation?.content;
    if (
      !workspaceId ||
      !selectedTaskId ||
      !taskLocation ||
      !hasTaskSelection(taskLocation)
    ) {
      return;
    }
    await flushDocumentSaves();
    await deleteTask(context, workspaceId, selectedTaskId, reference);
    queryClient.removeQueries({
      queryKey: ['task', workspaceId, selectedTaskId],
    });
    onNavigate({ ...taskLocation, taskId: null }, { replace: true });
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
    if (!workspaceId) return;
    void navigateSafely(collectionLocation(workspaceId, nextCollection));
  }

  function openSavedView(view: SavedView) {
    queryClient.setQueryData(['saved-view', view.workspace_id, view.id], view);
    void navigateSafely(savedViewLocation(view));
  }

  function changeTaskQuery(nextQuery: ReturnType<typeof createTaskQuery>) {
    if (!routeIdentity || !currentTaskDraft) return;
    setTaskDraft({
      ...currentTaskDraft,
      identity: routeIdentity,
      query: nextQuery,
    });
  }

  function changeTaskLayout(nextLayout: TaskLayout) {
    if (!routeIdentity || !currentTaskDraft) return;
    let nextQuery = currentTaskDraft.query;
    if (nextLayout === 'board' && !taskQuery.grouping.primary) {
      nextQuery = {
        ...taskQuery,
        grouping: { primary: 'state_group', secondary: null },
      };
    }
    setTaskDraft({
      ...currentTaskDraft,
      identity: routeIdentity,
      query: nextQuery,
      layout: nextLayout,
    });
  }

  async function addSavedView(name: string, visibility: SavedViewVisibility) {
    if (!workspaceId || !(await prepareDocumentMutation())) return;
    const created = await createSavedView(context, workspaceId, {
      name,
      visibility,
      project_id: activeView?.project_id ?? scopeProjectId(taskQuery.scope),
      query: taskQuery,
      layout: taskLayout,
    });
    queryClient.setQueryData(['saved-view', workspaceId, created.id], created);
    await refreshSavedViewCache(created.project_id);
    onNavigate(savedViewLocation(created));
  }

  async function addProjectSavedView(
    name: string,
    visibility: SavedViewVisibility,
  ) {
    if (
      !workspaceId ||
      !activeProjectId ||
      !(await prepareDocumentMutation())
    ) {
      return;
    }
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
    queryClient.setQueryData(['saved-view', workspaceId, created.id], created);
    onNavigate(savedViewLocation(created));
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
    queryClient.setQueryData(['saved-view', workspaceId, updated.id], updated);
    await refreshSavedViewCache(updated.project_id);
  }

  async function saveViewConfiguration() {
    if (!workspaceId || !activeView) return;
    const updated = await updateSavedView(context, workspaceId, activeView.id, {
      query: taskQuery,
      layout: taskLayout,
    });
    queryClient.setQueryData(['saved-view', workspaceId, updated.id], updated);
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
    await flushDocumentSaves();
    await deleteSavedView(context, workspaceId, activeView.id);
    queryClient.removeQueries({
      queryKey: ['saved-view', workspaceId, activeView.id],
    });
    onNavigate(
      projectId
        ? { kind: 'project-views', workspaceId, projectId }
        : { kind: 'all-tasks', workspaceId, taskId: null },
      { replace: true },
    );
    await refreshSavedViewCache(projectId);
  }

  async function refreshSavedViewCache(projectId: string | null) {
    await queryClient.invalidateQueries({
      queryKey: ['saved-views', workspaceId, projectId],
    });
  }

  function openAccountSettings(section: AccountSettingsSection) {
    if (!workspaceId) return;
    void navigateSafely({
      kind: 'account-settings',
      workspaceId,
      section,
      returnTo: presentation?.content ?? null,
    });
  }

  async function openNotificationTask(
    notificationWorkspaceId: string,
    taskId: string,
  ) {
    const repairsPendingIntent = pendingWorkspaceIntents.current > 0;
    const generation = ++activationGeneration.current;
    setActionError(null);
    setDirectActivationError(null);
    workspaceIntentOrigin.current = workspaceId;
    try {
      const changesWorkspace = notificationWorkspaceId !== workspaceId;
      const result = await enqueueWorkspaceIntent(generation, async () => {
        const notificationTask = await getTask(
          context,
          notificationWorkspaceId,
          taskId,
        );
        await flushDocumentSaves();
        if (changesWorkspace || repairsPendingIntent) {
          await activateWorkspace(context, notificationWorkspaceId);
        }
        return notificationTask;
      });
      if (!result.latest || !result.value) return;
      if (changesWorkspace || repairsPendingIntent) {
        activationAttempt.current = `${user.id}:${notificationWorkspaceId}`;
        syncActiveWorkspace(notificationWorkspaceId);
      }
      onNavigate(
        result.value.project_id
          ? {
              kind: 'project-work-items',
              workspaceId: notificationWorkspaceId,
              projectId: result.value.project_id,
              taskId,
            }
          : {
              kind: 'all-tasks',
              workspaceId: notificationWorkspaceId,
              taskId,
            },
      );
      clearWorkspaceIntentOrigin(workspaceId);
    } catch (caught) {
      if (activationGeneration.current !== generation) return;
      workspaceIntentOrigin.current = null;
      setActionError(errorMessage(caught));
    }
  }

  function openWorkspaceSettings(section: WorkspaceSettingsSection) {
    if (!workspaceId) return;
    void navigateSafely({
      kind: 'workspace-settings',
      workspaceId,
      section,
      returnTo: presentation?.content ?? null,
    });
  }

  function openProjectOverview(projectId: string) {
    if (!workspaceId) return;
    void navigateSafely({ kind: 'project-overview', workspaceId, projectId });
  }

  function openProjectSettings(projectId: string) {
    if (!workspaceId) return;
    const projectOverview: WorkspaceContentLocation = {
      kind: 'project-overview',
      workspaceId,
      projectId,
    };
    void navigateSafely({
      kind: 'project-settings',
      workspaceId,
      projectId,
      section: 'general',
      returnTo:
        presentation?.activeProjectId === projectId
          ? presentation.content
          : projectOverview,
    });
  }

  function openPlanning(projectId: string, kind: 'cycles' | 'modules') {
    if (!workspaceId) return;
    void navigateSafely(
      kind === 'cycles'
        ? { kind: 'project-cycles', workspaceId, projectId, cycleId: null }
        : { kind: 'project-modules', workspaceId, projectId, moduleId: null },
    );
  }

  function openDocuments(
    projectId: string | null,
    documentId: string | null = null,
  ) {
    if (!workspaceId) return;
    void navigateSafely(
      projectId
        ? {
            kind: 'project-library',
            workspaceId,
            projectId,
            documentId,
          }
        : { kind: 'workspace-library', workspaceId, documentId },
    );
  }

  function openProjectViews(projectId: string) {
    if (!workspaceId) return;
    void navigateSafely({ kind: 'project-views', workspaceId, projectId });
  }

  function openPlanningTask(taskId: string) {
    if (!workspaceId || !activeProject) return;
    void navigateSafely({
      kind: 'project-work-items',
      workspaceId,
      projectId: activeProject.id,
      taskId,
    });
  }

  function openCommandTask(currentTask: Task) {
    if (!workspaceId) return;
    void navigateSafely(
      currentTask.project_id
        ? {
            kind: 'project-work-items',
            workspaceId,
            projectId: currentTask.project_id,
            taskId: currentTask.id,
          }
        : { kind: 'all-tasks', workspaceId, taskId: currentTask.id },
    );
  }

  function openCommandDocument(document: WorkspaceDocument) {
    openDocuments(document.project_id, document.id);
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
      await navigateSafely({
        kind: 'project-work-items',
        workspaceId,
        projectId: activeProject.id,
        taskId: null,
      });
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
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['projects', workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ['tasks', workspaceId] }),
    ]);
    if (workspaceId) {
      onNavigate(
        { kind: 'my-work', workspaceId, taskId: null },
        { replace: true },
      );
    }
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

  async function removeWorkspaceIntent(remove: () => Promise<void>) {
    const generation = ++activationGeneration.current;
    setActionError(null);
    setDirectActivationError(null);
    workspaceIntentOrigin.current = workspaceId;
    const result = await enqueueWorkspaceIntent(generation, async () => {
      await flushDocumentSaves();
      await remove();
      const refreshed = await workspaces.refetch();
      const nextWorkspace = refreshed.data?.find(
        ({ id }) => id !== workspaceId,
      );
      if (nextWorkspace && activationGeneration.current === generation) {
        await activateWorkspace(context, nextWorkspace.id);
      }
      return nextWorkspace ?? null;
    });
    if (!result.latest) return;
    const nextWorkspace = result.value;
    if (nextWorkspace) {
      activationAttempt.current = `${user.id}:${nextWorkspace.id}`;
    }
    syncActiveWorkspace(nextWorkspace?.id ?? null);
    onNavigate(
      nextWorkspace
        ? { kind: 'my-work', workspaceId: nextWorkspace.id, taskId: null }
        : { kind: 'root' },
      { replace: true },
    );
    clearWorkspaceIntentOrigin(workspaceId);
    await queryClient.invalidateQueries({ queryKey: ['session'] });
  }

  function clearWorkspaceIntentOrigin(origin: string | null) {
    window.setTimeout(() => {
      if (workspaceIntentOrigin.current === origin) {
        workspaceIntentOrigin.current = null;
      }
    });
  }

  const selectDocument = useCallback(
    (document: WorkspaceDocument | null, options?: { replace?: boolean }) => {
      if (!workspaceId) return Promise.resolve(false);
      const documentProjectId =
        document === null ? activeProjectId : document.project_id;
      const nextLocation: WorkspaceContentLocation = documentProjectId
        ? {
            kind: 'project-library',
            workspaceId,
            projectId: documentProjectId,
            documentId: document?.id ?? null,
          }
        : {
            kind: 'workspace-library',
            workspaceId,
            documentId: document?.id ?? null,
          };
      return navigateSafely(
        preserveSettingsLocation(location, nextLocation),
        options,
      );
    },
    [activeProjectId, location, navigateSafely, workspaceId],
  );
  const rejectDocumentSelection = useCallback(() => {
    if (!workspaceId) return;
    const nextLocation: WorkspaceContentLocation = activeProjectId
      ? {
          kind: 'project-library',
          workspaceId,
          projectId: activeProjectId,
          documentId: null,
        }
      : { kind: 'workspace-library', workspaceId, documentId: null };
    onNavigate(preserveSettingsLocation(location, nextLocation), {
      replace: true,
    });
  }, [activeProjectId, location, onNavigate, workspaceId]);
  const selectPlanningItem = useCallback(
    (selectedId: string | null, options?: { replace?: boolean }) => {
      if (!workspaceId || !activeProjectId) return;
      const nextLocation: WorkspaceContentLocation =
        visibleSurface === 'cycles'
          ? {
              kind: 'project-cycles',
              workspaceId,
              projectId: activeProjectId,
              cycleId: selectedId,
            }
          : {
              kind: 'project-modules',
              workspaceId,
              projectId: activeProjectId,
              moduleId: selectedId,
            };
      void navigateSafely(
        preserveSettingsLocation(location, nextLocation),
        options,
      );
    },
    [activeProjectId, location, navigateSafely, visibleSurface, workspaceId],
  );

  function closeSettings() {
    if (!location || !isSettingsLocation(location)) return;
    void navigateSafely(settingsReturnTarget(location), { replace: true });
  }

  function changeAccountSettingsSection(section: AccountSettingsSection) {
    if (!location || location.kind !== 'account-settings') return;
    void navigateSafely({ ...location, section }, { replace: true });
  }

  function changeWorkspaceSettingsSection(section: WorkspaceSettingsSection) {
    if (!location || location.kind !== 'workspace-settings') return;
    void navigateSafely(
      { ...location, section, definePropertyName: undefined },
      { replace: true },
    );
  }

  function changeProjectSettingsSection(section: ProjectSettingsSection) {
    if (!location || location.kind !== 'project-settings') return;
    void navigateSafely({ ...location, section }, { replace: true });
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
  if (!location && (workspaces.data?.length ?? 0) > 0) {
    return <WorkspaceOpening />;
  }
  if (!workspaceId || !activeWorkspace) {
    if ((workspaces.data?.length ?? 0) > 0) {
      return <WorkspaceOpening />;
    }
    return (
      <main className="workspace-recovery-shell">
        <aside className="workspace-recovery-rail">
          <Wordmark />
          <div>
            <p className="eyebrow">A durable home for your work</p>
            <p className="workspace-recovery-title">
              Keep structured planning and Markdown together.
            </p>
            <p>
              Create a Workspace you own, or join a team that has invited you.
            </p>
          </div>
          <small>You can belong to more than one Workspace.</small>
        </aside>
        <section className="workspace-recovery-content">
          <WorkspaceSetupStep
            context={context}
            isHost={Boolean(onOpenHostConsole)}
            inviteAfterCreate
            invalidateAfterCreate={false}
            createWorkspaceAction={(identity) => addWorkspace(identity, false)}
            onWorkspaceCreated={finishRecoveryWorkspace}
            onJoined={finishWorkspaceJoin}
            onHostContinue={() => onOpenHostConsole?.()}
            onSignOut={onSignOut}
          />
        </section>
      </main>
    );
  }
  const directActivationAttempt = `${user.id}:${activeWorkspace.id}`;
  if (
    directActivationError?.attempt === directActivationAttempt &&
    user.active_workspace_id !== activeWorkspace.id
  ) {
    return (
      <WorkspaceRouteFailure
        message={directActivationError.message}
        onRetry={() => {
          activationAttempt.current = null;
          setDirectActivationError(null);
          setActivationRetry((current) => current + 1);
        }}
      />
    );
  }
  if (routedProjectId && projects.isPending) {
    return <WorkspaceOpening />;
  }
  if (routedProjectId && projects.error) {
    return (
      <WorkspaceRouteFailure
        message={errorMessage(projects.error)}
        onRetry={() => void projects.refetch()}
      />
    );
  }
  if (routedProjectId && projects.data && !routedProject) {
    return <WorkspaceOpening />;
  }
  if (routedViewId && savedView.isPending) {
    return <WorkspaceOpening />;
  }
  if (
    routedViewId &&
    savedView.error &&
    !isAuthoritativeAbsence(savedView.error)
  ) {
    return (
      <WorkspaceRouteFailure
        message={errorMessage(savedView.error)}
        onRetry={() => void savedView.refetch()}
      />
    );
  }
  if (reconciliation?.status === 'replace') {
    return <WorkspaceOpening />;
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
        context={context}
        userEmail={user.email}
        workspaces={workspaces.data ?? []}
        workspaceId={workspaceId}
        navigationVisible={paneLayout.navigationVisible}
        onSwitchWorkspace={switchWorkspace}
        onCreateWorkspace={addWorkspace}
        onFinishWorkspace={finishWorkspaceCreation}
        onOpenWorkspaceSettings={openWorkspaceSettings}
        onOpenInvitations={() => openAccountSettings('invitations')}
        onImportWorkspace={() => {
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
        context={context}
        accountSwitcher={
          <AccountSwitcher
            accounts={accountSessions}
            activeUserId={user.id}
            transitioning={accountTransitioning}
            error={accountError}
            onSwitchAccount={onSwitchAccount}
            onAddAccount={onAddAccount}
            onOpenAccountSettings={() => openAccountSettings('profile')}
            onOpenHostConsole={
              onOpenHostConsole
                ? () => {
                    void flushDocumentSaves()
                      .then(onOpenHostConsole)
                      .catch((caught) => setActionError(errorMessage(caught)));
                  }
                : undefined
            }
            onSignOutCurrent={onSignOut}
            onDismissError={onDismissAccountError}
          />
        }
        workspace={activeWorkspace}
        currentUser={{ id: user.id, displayName: user.display_name }}
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
          accessSettled={
            activeProjectId
              ? Boolean(projectAccessSettled && activeProject?.effective_role)
              : hasSettledContentAccess
          }
          canCreateWorkspaceDocuments={hasContentAccess}
          selectedDocumentId={selectedDocumentId}
          onSelectDocument={selectDocument}
          onPrepareDocumentMutation={prepareDocumentMutation}
          onInvalidSelection={rejectDocumentSelection}
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
          accessSettled={Boolean(
            projectAccessSettled && activeProject.effective_role,
          )}
          members={activeProjectMembers.data ?? []}
          kind={visibleSurface}
          selectedId={presentation?.planningSelectedId ?? null}
          onSelectId={selectPlanningItem}
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
            onQueryChange={changeTaskQuery}
            onLayoutChange={changeTaskLayout}
            onSelectTask={(taskId) => navigateTask(taskId)}
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
            onClearSelection={() => navigateTask(null, true)}
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
            canManageProperties={
              activeWorkspace.role === 'owner' ||
              activeWorkspace.role === 'admin'
            }
            customProperties={customProperties.data ?? []}
            customPropertiesLoading={customProperties.isPending}
            customPropertiesError={
              customProperties.error
                ? errorMessage(customProperties.error)
                : null
            }
            onRetryCustomProperties={() => void customProperties.refetch()}
            undefinedProperties={undefinedTaskProperties.data ?? []}
            undefinedPropertiesLoading={undefinedTaskProperties.isPending}
            undefinedPropertiesError={
              undefinedTaskProperties.error
                ? errorMessage(undefinedTaskProperties.error)
                : null
            }
            onRetryUndefinedProperties={() =>
              void undefinedTaskProperties.refetch()
            }
            currentUserId={user.id}
            canComment={selectedTask ? canCommentTask(selectedTask) : false}
            canModerate={selectedTask ? canModerateTask(selectedTask) : false}
            onPatch={(patch) => patchTask(selectedTaskId!, patch)}
            onCustomPropertyChange={(propertyId, value) =>
              changeTaskProperty(selectedTaskId!, propertyId, value)
            }
            onDefineProperty={async (name) => {
              if (!workspaceId) return;
              setActionError(null);
              try {
                await flushDocumentSaves();
                onNavigate({
                  kind: 'workspace-settings',
                  workspaceId,
                  section: 'properties',
                  definePropertyName: name,
                  returnTo: presentation?.content ?? null,
                });
              } catch (caught) {
                setActionError(errorMessage(caught));
              }
            }}
            onArchive={removeTask}
            onDelete={permanentlyDeleteTask}
            onAddRelation={addRelation}
            onRemoveRelation={removeRelation}
            onOpenTask={(taskId) => navigateTask(taskId)}
            onClose={() => navigateTask(null, true)}
            onRetry={() => void task.refetch()}
          />
        </>
      )}
      {location?.kind === 'account-settings' &&
        isAccountSettingsSection(location.section) && (
          <SettingsDialog label="Account settings" onClose={closeSettings}>
            <AccountSettingsShell
              context={context}
              user={user}
              section={location.section}
              onSectionChange={changeAccountSettingsSection}
              onWorkspaceJoined={finishWorkspaceJoin}
              onClose={closeSettings}
            />
          </SettingsDialog>
        )}
      {importDialogOpen && (
        <WorkspaceImportDialog
          context={context}
          onApplyImport={applyWorkspaceImportIntent}
          onClose={() => setImportDialogOpen(false)}
        />
      )}
      {hasSettledWorkspaceAccess &&
        location?.kind === 'workspace-settings' &&
        isWorkspaceSettingsSection(location.section) && (
          <SettingsDialog
            label={`${activeWorkspace.name} Workspace settings`}
            onClose={closeSettings}
          >
            <WorkspaceSettingsShell
              context={context}
              user={user}
              workspace={activeWorkspace}
              workspaceCount={workspaces.data?.length ?? 0}
              section={location.section}
              definePropertyName={location.definePropertyName}
              onSectionChange={changeWorkspaceSettingsSection}
              onClose={closeSettings}
              onWorkspaceUpdated={refreshWorkspace}
              onConfigurationUpdated={refreshTaskConfiguration}
              onProjectsChanged={async () => {
                await queryClient.invalidateQueries({
                  queryKey: ['projects', workspaceId],
                });
              }}
              onRemoveWorkspace={removeWorkspaceIntent}
            />
          </SettingsDialog>
        )}
      {location?.kind === 'project-settings' &&
        isProjectSettingsSection(location.section) &&
        activeProject && (
          <SettingsDialog
            label={`${activeProject.name} Project settings`}
            onClose={closeSettings}
          >
            <ProjectSettings
              context={context}
              workspace={activeWorkspace}
              project={activeProject}
              userId={user.id}
              accessSettled={Boolean(
                projectAccessSettled && activeProject.effective_role,
              )}
              configuration={
                taskConfiguration.data ?? {
                  states: [],
                  labels: [],
                  task_types: [],
                  default_state_id: activeProject.default_state_id,
                  default_task_type_id: activeProject.default_task_type_id,
                }
              }
              section={location.section}
              onSectionChange={changeProjectSettingsSection}
              onClose={closeSettings}
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

function queryResolution<T>(query: {
  data: T | undefined;
  isPending: boolean;
  isFetching: boolean;
  error: unknown;
}): Resolution<T> {
  if (query.error instanceof ApiError && query.error.status === 403) {
    return { status: 'forbidden' };
  }
  if (
    query.error instanceof ApiError &&
    (query.error.status === 404 || query.error.status === 422)
  ) {
    return { status: 'absent' };
  }
  if (query.error) return { status: 'transient-error' };
  if (query.isFetching) return { status: 'pending' };
  if (query.data !== undefined) {
    return { status: 'resolved', value: query.data };
  }
  if (query.isPending) return { status: 'pending' };
  return { status: 'pending' };
}

function listItemResolution<T>(
  query: {
    data: readonly unknown[] | undefined;
    error: unknown;
    isFetching: boolean;
  },
  item: T | undefined,
): Resolution<T> {
  if (query.error) return { status: 'transient-error' };
  if (query.isFetching) return { status: 'pending' };
  if (query.data !== undefined) {
    return item === undefined
      ? { status: 'absent' }
      : { status: 'resolved', value: item };
  }
  return { status: 'pending' };
}

function settingsSectionResolution(
  location: WorkspaceSettingsLocation,
  workspaceRole: string | undefined,
): Resolution<readonly string[]> {
  if (location.kind === 'account-settings') {
    return { status: 'resolved', value: accountSettingsSections };
  }
  if (location.kind === 'project-settings') {
    return { status: 'resolved', value: projectSettingsSections };
  }

  const canManage = workspaceRole === 'owner' || workspaceRole === 'admin';
  return {
    status: 'resolved',
    value: canManage
      ? workspaceSettingsSections
      : workspaceSettingsSections.filter(
          (section) =>
            section !== 'storage' &&
            (workspaceRole !== 'guest' || section !== 'projects'),
        ),
  };
}

function isSettingsLocation(
  location: WorkspaceLocation,
): location is WorkspaceSettingsLocation {
  return location.kind.endsWith('-settings');
}

function preserveSettingsLocation(
  current: WorkspaceLocation | null,
  content: WorkspaceContentLocation,
): WorkspaceLocation {
  return current && isSettingsLocation(current)
    ? { ...current, returnTo: content }
    : content;
}

function hasTaskSelection(
  location: WorkspaceContentLocation,
): location is TaskCollectionLocation {
  return 'taskId' in location;
}

function collectionLocation(
  workspaceId: string,
  collection: Collection,
): TaskCollectionLocation {
  switch (collection.kind) {
    case 'my-work':
      return { kind: 'my-work', workspaceId, taskId: null };
    case 'inbox':
      return { kind: 'inbox', workspaceId, taskId: null };
    case 'all':
      return { kind: 'all-tasks', workspaceId, taskId: null };
    case 'project':
      return {
        kind: 'project-work-items',
        workspaceId,
        projectId: collection.projectId,
        taskId: null,
      };
  }
}

function savedViewLocation(view: SavedView): TaskCollectionLocation {
  return view.project_id
    ? {
        kind: 'project-view',
        workspaceId: view.workspace_id,
        projectId: view.project_id,
        viewId: view.id,
        taskId: null,
      }
    : {
        kind: 'workspace-view',
        workspaceId: view.workspace_id,
        viewId: view.id,
        taskId: null,
      };
}

function isAuthoritativeAbsence(error: unknown) {
  return (
    error instanceof ApiError &&
    (error.status === 403 || error.status === 404 || error.status === 422)
  );
}

function WorkspaceOpening() {
  return (
    <main className="status-page" aria-live="polite">
      <Wordmark quiet />
      <p>Opening your workspace…</p>
    </main>
  );
}

function WorkspaceRouteFailure({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <main className="status-page">
      <Wordmark quiet />
      <div className="form-heading" role="alert">
        <h1>Workspace view unavailable</h1>
        <p>{message}</p>
      </div>
      <button className="primary-button" type="button" onClick={onRetry}>
        Try again
      </button>
    </main>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Request failed';
}
