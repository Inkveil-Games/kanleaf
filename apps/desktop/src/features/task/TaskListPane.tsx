import {
  CalendarDays,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuItem,
} from '../../components/ui/DropdownMenu';
import { IconButton } from '../../components/ui/IconButton';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Tooltip } from '../../components/ui/Tooltip';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type {
  Collection,
  Project,
  Task,
  TaskBulkPatch,
  TaskLabel,
  TaskPatch,
  TaskPlanningLink,
  TaskState,
} from '../workspace/types';
import { TaskLayouts } from '../view/TaskLayouts';
import { buildTaskGroupTree } from '../view/grouping';
import { TaskViewToolbar } from '../view/TaskViewToolbar';
import type {
  SavedView,
  SavedViewVisibility,
  TaskLayout,
  TaskQuery,
} from '../view/types';
import { TASK_PRIORITY_OPTIONS } from './taskPropertyModel';
import { PriorityBadge, PriorityIcon, StateIcon } from './TaskValueIcon';

interface TaskListPaneProps {
  collection: Collection;
  projects: Project[];
  states: TaskState[];
  labels: TaskLabel[];
  cycles: TaskPlanningLink[];
  modules: TaskPlanningLink[];
  members: { user_id: string; display_name: string }[];
  tasks: Task[];
  selectedTaskId: string | null;
  query: TaskQuery;
  layout: TaskLayout;
  activeView: SavedView | null;
  loading: boolean;
  error: string | null;
  canCreate: boolean;
  canShareView: boolean;
  canManageActiveView: boolean;
  canChangeActiveViewVisibility: boolean;
  canEditTask: (task: Task) => boolean;
  onQueryChange: (query: TaskQuery) => void;
  onLayoutChange: (layout: TaskLayout) => void;
  onSelectTask: (taskId: string) => void;
  onCreateTask: (title: string) => Promise<void>;
  onUpdateState: (task: Task, stateId: string) => Promise<void>;
  onPatchTask: (taskId: string, patch: TaskPatch) => Promise<void>;
  onBulkUpdate: (patch: TaskBulkPatch) => Promise<void>;
  onCreateView: (
    name: string,
    visibility: SavedViewVisibility,
  ) => Promise<void>;
  onUpdateView: (
    patch: Partial<Pick<SavedView, 'name' | 'visibility'>>,
  ) => Promise<void>;
  onSaveViewConfiguration: () => Promise<void>;
  onDuplicateView: (
    name: string,
    visibility: SavedViewVisibility,
  ) => Promise<void>;
  onDeleteView: () => Promise<void>;
  onViewActionError: (message: string) => void;
  onRetry: () => void;
  onClearSelection: () => void;
}

export function TaskListPane({
  collection,
  projects,
  states,
  labels,
  cycles,
  modules,
  members,
  tasks,
  selectedTaskId,
  query,
  layout,
  activeView,
  loading,
  error,
  canCreate,
  canShareView,
  canManageActiveView,
  canChangeActiveViewVisibility,
  canEditTask,
  onQueryChange,
  onLayoutChange,
  onSelectTask,
  onCreateTask,
  onUpdateState,
  onPatchTask,
  onBulkUpdate,
  onCreateView,
  onUpdateView,
  onSaveViewConfiguration,
  onDuplicateView,
  onDeleteView,
  onViewActionError,
  onRetry,
  onClearSelection,
}: TaskListPaneProps) {
  const [composing, setComposing] = useState(false);
  const [checkedTaskIds, setCheckedTaskIds] = useState<Set<string>>(new Set());
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const title = activeView?.name ?? collectionTitle(collection, projects);
  const visibleFields = {
    priority: query.display.includes('priority'),
    assignees: query.display.includes('assignees'),
    labels: layout === 'list' || query.display.includes('labels'),
    dueDate: query.display.includes('due_date'),
    updated: query.display.includes('updated_at'),
  };
  const checkedVisibleIds = tasks
    .filter(({ id }) => checkedTaskIds.has(id))
    .map(({ id }) => id);
  const groupedTasks = query.grouping.primary
    ? buildTaskGroupTree(
        query.grouping.primary,
        query.grouping.secondary,
        tasks,
        projects,
        states,
      )
    : [];
  const navigationTasks = groupedTasks.length
    ? uniqueGroupedTasks(groupedTasks)
    : tasks;

  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      const isEditing =
        target?.matches('input, textarea, select, [contenteditable="true"]') ??
        false;
      const isTransientSurface = Boolean(
        target?.closest('[role="menu"], [role="dialog"]'),
      );
      if (
        !isEditing &&
        !isTransientSurface &&
        !event.metaKey &&
        !event.ctrlKey &&
        event.key === '/'
      ) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (
        canCreate &&
        !isEditing &&
        !event.metaKey &&
        !event.ctrlKey &&
        (event.key.toLocaleLowerCase() === 'c' ||
          event.key.toLocaleLowerCase() === 'n')
      ) {
        event.preventDefault();
        setComposing(true);
      }
      if (!isEditing && !isTransientSurface && event.key === 'Escape') {
        onClearSelection();
      }
    }
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, [canCreate, onClearSelection]);

  function moveSelection(event: ReactKeyboardEvent<HTMLDivElement>) {
    const key = event.key.toLocaleLowerCase();
    if (!['arrowdown', 'arrowup', 'j', 'k'].includes(key)) return;
    event.preventDefault();
    const currentIndex = navigationTasks.findIndex(
      ({ id }) => id === selectedTaskId,
    );
    const offset = key === 'arrowdown' || key === 'j' ? 1 : -1;
    const nextIndex = Math.min(
      navigationTasks.length - 1,
      Math.max(0, currentIndex < 0 ? 0 : currentIndex + offset),
    );
    const nextTask = navigationTasks[nextIndex];
    if (nextTask) onSelectTask(nextTask.id);
  }

  function toggleChecked(taskId: string) {
    setCheckedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  async function applyBulk(patch: Omit<TaskBulkPatch, 'task_ids'>) {
    if (checkedVisibleIds.length === 0) return;
    setBulkUpdating(true);
    setBulkError(null);
    try {
      await onBulkUpdate({ task_ids: checkedVisibleIds, ...patch });
    } catch (caught) {
      setBulkError(
        caught instanceof Error ? caught.message : 'Bulk update failed',
      );
    } finally {
      setBulkUpdating(false);
    }
  }

  function renderTaskRows(rows: Task[]) {
    return rows.map((task) => (
      <TaskRow
        key={task.id}
        task={task}
        projects={projects}
        states={states}
        canEdit={canEditTask(task)}
        selected={task.id === selectedTaskId}
        visibleFields={visibleFields}
        onSelect={() => onSelectTask(task.id)}
        onUpdateState={(stateId) => onUpdateState(task, stateId)}
      />
    ));
  }

  return (
    <section className="collection-pane" aria-label={title}>
      <div className="collection-controls">
        <div className="task-search">
          <div className="task-search-field">
            <Search aria-hidden="true" size={15} />
            <label className="sr-only" htmlFor="task-search-input">
              Search tasks
            </label>
            <Input
              id="task-search-input"
              ref={searchRef}
              type="search"
              aria-keyshortcuts="/"
              value={query.search ?? ''}
              placeholder="Search tasks"
              onChange={(event) =>
                onQueryChange({
                  ...query,
                  search: event.target.value || null,
                })
              }
            />
            {query.search && (
              <IconButton
                variant="ghost"
                size="sm"
                type="button"
                aria-label="Clear search"
                onClick={() => onQueryChange({ ...query, search: null })}
              >
                <X aria-hidden="true" size={14} />
              </IconButton>
            )}
            <kbd aria-hidden="true">/</kbd>
          </div>
          {canCreate && (
            <Tooltip
              label="New task"
              trigger={
                <Button
                  className="task-new-button"
                  variant="primary"
                  size="sm"
                  type="button"
                  aria-label="New task"
                  onClick={() => setComposing(true)}
                >
                  <Plus aria-hidden="true" size={15} />
                  <span className="task-new-label">New task</span>
                </Button>
              }
            />
          )}
        </div>
        <TaskViewToolbar
          query={query}
          layout={layout}
          states={states}
          labels={labels}
          projects={projects}
          cycles={cycles}
          modules={modules}
          members={members}
          activeView={activeView}
          canShare={canShareView}
          canManageActiveView={canManageActiveView}
          canChangeActiveViewVisibility={canChangeActiveViewVisibility}
          onQueryChange={onQueryChange}
          onLayoutChange={onLayoutChange}
          onCreateView={onCreateView}
          onUpdateView={onUpdateView}
          onSaveViewConfiguration={onSaveViewConfiguration}
          onDuplicateView={onDuplicateView}
          onDeleteView={onDeleteView}
          onActionError={onViewActionError}
        />
        {checkedVisibleIds.length > 0 && (
          <div className="bulk-toolbar" aria-label="Bulk task actions">
            <strong>{checkedVisibleIds.length} selected</strong>
            <label>
              <span className="sr-only">Set state</span>
              <Select
                ariaLabel="Set state"
                value=""
                disabled={bulkUpdating}
                options={[
                  { value: '', label: 'State…' },
                  ...states
                    .filter(({ archived_at }) => !archived_at)
                    .map((state) => ({
                      value: state.id,
                      label: state.name,
                      icon: <StateIcon role={state.system_role} size={18} />,
                    })),
                ]}
                onValueChange={(value) => {
                  if (value) void applyBulk({ state_id: value });
                }}
              />
            </label>
            <label>
              <span className="sr-only">Set priority</span>
              <Select
                ariaLabel="Set priority"
                value=""
                disabled={bulkUpdating}
                options={[
                  { value: '', label: 'Priority…' },
                  ...TASK_PRIORITY_OPTIONS.map((option) => ({
                    ...option,
                    icon: <PriorityIcon priority={option.value} size={16} />,
                  })),
                ]}
                onValueChange={(value) => {
                  if (value) {
                    void applyBulk({ priority: value as Task['priority'] });
                  }
                }}
              />
            </label>
            <Button
              variant="text"
              size="sm"
              type="button"
              disabled={bulkUpdating}
              onClick={() => setCheckedTaskIds(new Set())}
            >
              Clear
            </Button>
            {bulkError && <span role="alert">{bulkError}</span>}
          </div>
        )}
      </div>

      <div className={`task-layout-surface task-layout-${layout}`}>
        {canCreate && composing && (
          <QuickTaskForm
            onCancel={() => setComposing(false)}
            onCreate={async (taskTitle) => {
              await onCreateTask(taskTitle);
              setComposing(false);
            }}
          />
        )}
        {loading && tasks.length === 0 && <TaskListSkeleton />}
        {error && tasks.length === 0 && (
          <div className="pane-state" role="alert">
            <p>{error}</p>
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={onRetry}
            >
              Try again
            </Button>
          </div>
        )}
        {!loading && !error && tasks.length === 0 && (
          <div className="pane-state empty-state">
            <p>{query.search ? 'No matching tasks.' : 'Nothing here yet.'}</p>
            {!query.search && canCreate && (
              <Button
                variant="text"
                size="sm"
                type="button"
                onClick={() => setComposing(true)}
              >
                Create a task <kbd>C</kbd>
              </Button>
            )}
          </div>
        )}
        {tasks.length > 0 && layout === 'list' && (
          <div
            className="task-list"
            role="listbox"
            aria-label={`${title} tasks`}
            tabIndex={0}
            onKeyDown={moveSelection}
          >
            <div className="task-list-column-header" aria-hidden="true">
              <span className="task-list-column-task">Task</span>
              {visibleFields.priority && (
                <span className="task-list-column-priority">Priority</span>
              )}
              <span className="task-list-column-progress">Progress</span>
              {visibleFields.assignees && (
                <span className="task-list-column-assignees">Assignee</span>
              )}
              {visibleFields.dueDate && (
                <span className="task-list-column-due-date">Due date</span>
              )}
              <span className="task-list-column-comments" title="Comments">
                <MessageSquare size={13} />
              </span>
            </div>
            {groupedTasks.length > 0
              ? groupedTasks.map((branch) => {
                  const groupState =
                    query.grouping.primary === 'state'
                      ? stateForGroup(branch.group.id, states)
                      : undefined;
                  return (
                    <section
                      className="task-list-group"
                      role="group"
                      aria-label={branch.group.label}
                      data-state-role={groupState?.system_role}
                      key={branch.group.id}
                    >
                      <header>
                        {groupState && (
                          <StateIcon
                            className="task-list-group-icon"
                            role={groupState.system_role}
                            size={18}
                          />
                        )}
                        <strong>{branch.group.label}</strong>
                        <span>{branch.tasks.length}</span>
                      </header>
                      {branch.secondary.length > 0
                        ? branch.secondary.map((secondary) => (
                            <div
                              className="task-list-subgroup"
                              key={secondary.group.id}
                            >
                              <h3
                                aria-label={`${secondary.group.label}, ${taskCountLabel(secondary.tasks.length)}`}
                              >
                                <span>{secondary.group.label}</span>
                                <span>{secondary.tasks.length}</span>
                              </h3>
                              {renderTaskRows(secondary.tasks)}
                            </div>
                          ))
                        : renderTaskRows(branch.tasks)}
                    </section>
                  );
                })
              : renderTaskRows(tasks)}
          </div>
        )}
        {tasks.length > 0 && layout !== 'list' && (
          <TaskLayouts
            layout={layout}
            query={query}
            tasks={tasks}
            projects={projects}
            states={states}
            members={members}
            selectedTaskId={selectedTaskId}
            checkedTaskIds={checkedTaskIds}
            canEditTask={canEditTask}
            onSelectTask={onSelectTask}
            onToggleChecked={toggleChecked}
            onPatchTask={onPatchTask}
          />
        )}
      </div>
      <footer className="collection-footer">
        <span>{tasks.length} visible</span>
        <span>↑↓ navigate</span>
      </footer>
    </section>
  );
}

function uniqueGroupedTasks(
  branches: ReturnType<typeof buildTaskGroupTree>,
): Task[] {
  const seen = new Set<string>();
  const ordered: Task[] = [];
  for (const branch of branches) {
    const rows = branch.secondary.length
      ? branch.secondary.flatMap(({ tasks }) => tasks)
      : branch.tasks;
    for (const task of rows) {
      if (seen.has(task.id)) continue;
      seen.add(task.id);
      ordered.push(task);
    }
  }
  return ordered;
}

interface TaskRowProps {
  task: Task;
  projects: Project[];
  states: TaskState[];
  selected: boolean;
  visibleFields: {
    priority: boolean;
    assignees: boolean;
    labels: boolean;
    dueDate: boolean;
    updated: boolean;
  };
  canEdit: boolean;
  onSelect: () => void;
  onUpdateState: (stateId: string) => Promise<void>;
}

function TaskRow({
  task,
  projects,
  states,
  selected,
  visibleFields,
  canEdit,
  onSelect,
  onUpdateState,
}: TaskRowProps) {
  const next = nextState(task, states);
  const projectName =
    projects.find(({ id }) => id === task.project_id)?.name ?? 'Inbox';
  const progress = task.subtask_progress.total
    ? Math.round(
        (task.subtask_progress.completed / task.subtask_progress.total) * 100,
      )
    : null;
  const dueDate =
    visibleFields.dueDate && task.due_date ? taskDueDate(task.due_date) : null;
  const visibleAssignees = task.assignees.slice(0, 2);
  const visibleLabels = task.labels.slice(0, 3);
  return (
    <div
      className="task-row"
      role="option"
      aria-selected={selected}
      data-state-role={task.state.system_role ?? undefined}
    >
      {canEdit ? (
        <button
          className="task-status-button"
          type="button"
          aria-label={`Move ${task.title} to ${next.name}`}
          title={`Move to ${next.name}`}
          onClick={() => void onUpdateState(next.id)}
        >
          <StateIcon role={task.state.system_role} size={27} />
        </button>
      ) : (
        <span
          className="task-status-button task-status-readonly"
          aria-hidden="true"
        >
          <StateIcon role={task.state.system_role} size={27} />
        </span>
      )}
      <button className="task-row-main" type="button" onClick={onSelect}>
        <span className="task-row-title">{task.title}</span>
        <span className="task-row-metadata">
          <span className="task-row-reference">{task.reference}</span>
          <span aria-hidden="true">·</span>
          <span className="task-row-project">{projectName}</span>
          {visibleFields.labels && (
            <>
              <span aria-hidden="true">·</span>
              <span className="task-row-labels">
                {visibleLabels.map((label) => (
                  <span
                    className="task-row-label"
                    key={label.id}
                    style={
                      { '--task-label-color': label.color } as CSSProperties
                    }
                  >
                    {label.name}
                  </span>
                ))}
                {task.labels.length === 0 && (
                  <span className="task-row-label is-empty">No label</span>
                )}
                {task.labels.length > visibleLabels.length && (
                  <span className="task-row-label is-overflow">…</span>
                )}
              </span>
            </>
          )}
          {visibleFields.updated && (
            <span className="task-row-updated">
              · Updated {formatUpdatedAt(task.updated_at)}
            </span>
          )}
        </span>
      </button>
      <span className="task-row-priority">
        {visibleFields.priority && <PriorityBadge priority={task.priority} />}
      </span>
      <span className="task-row-progress">
        {progress !== null && (
          <span
            className="task-progress"
            role="progressbar"
            aria-label={`${task.subtask_progress.completed} of ${task.subtask_progress.total} subtasks complete`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <span className="task-progress-track" aria-hidden="true">
              <span
                className="task-progress-fill"
                style={{ '--task-progress': `${progress}%` } as CSSProperties}
              />
            </span>
            <span>{progress}%</span>
          </span>
        )}
      </span>
      <span className="task-row-assignees">
        {visibleFields.assignees && task.assignees.length > 0 && (
          <span
            className="task-assignee-stack"
            aria-label={`${task.assignees.length} assignees`}
          >
            {visibleAssignees.map(({ user_id, display_name }) => (
              <span
                aria-hidden="true"
                className="task-assignee-avatar"
                key={user_id}
                title={display_name}
              >
                {initials(display_name)}
              </span>
            ))}
            {task.assignees.length > visibleAssignees.length && (
              <span
                aria-hidden="true"
                className="task-assignee-avatar is-overflow"
              >
                …
              </span>
            )}
          </span>
        )}
      </span>
      <span
        className="task-row-due-date"
        data-urgent={dueDate?.urgent || undefined}
      >
        {dueDate && (
          <>
            <CalendarDays aria-hidden="true" size={15} />
            <time dateTime={dueDate.value}>{dueDate.label}</time>
          </>
        )}
      </span>
      <span className="task-row-comments">
        {task.comment_count > 0 && (
          <span aria-label={`${task.comment_count} comments`}>
            <MessageSquare aria-hidden="true" size={16} />
            {task.comment_count}
          </span>
        )}
      </span>
      <span className="task-row-actions">
        {canEdit && (
          <DropdownMenu
            label={`Task actions for ${task.title}`}
            className="task-row-menu"
          >
            <DropdownMenuItem onClick={onSelect}>
              <Pencil aria-hidden="true" size={14} /> Edit
            </DropdownMenuItem>
          </DropdownMenu>
        )}
      </span>
    </div>
  );
}

interface QuickTaskFormProps {
  onCreate: (title: string) => Promise<void>;
  onCancel: () => void;
}

function QuickTaskForm({ onCreate, onCancel }: QuickTaskFormProps) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onCreate(title);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Task creation failed',
      );
      setSubmitting(false);
    }
  }

  return (
    <form className="quick-task-form" onSubmit={(event) => void submit(event)}>
      <span className="status-glyph status-todo" aria-hidden="true" />
      <label>
        <span className="sr-only">Task title</span>
        <Input
          autoFocus
          required
          maxLength={300}
          value={title}
          placeholder="Task title"
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onCancel();
          }}
        />
      </label>
      <Button
        variant="primary"
        size="sm"
        type="submit"
        loading={submitting}
        loadingLabel="Adding Task"
      >
        Add
      </Button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

function TaskListSkeleton() {
  return (
    <div className="task-list-skeleton" aria-label="Loading tasks">
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}

function collectionTitle(collection: Collection, projects: Project[]) {
  if (collection.kind === 'inbox') return 'Inbox';
  if (collection.kind === 'my-work') return 'My Work';
  if (collection.kind === 'all') return 'All tasks';
  return (
    projects.find(({ id }) => id === collection.projectId)?.name ?? 'Project'
  );
}

function taskDueDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  const today = new Date();
  const dayDifference = Math.round(
    (Date.UTC(year!, month! - 1, day!) -
      Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) /
      86_400_000,
  );
  const label =
    dayDifference === 0
      ? 'Today'
      : dayDifference === 1
        ? 'Tomorrow'
        : new Intl.DateTimeFormat(undefined, {
            month: 'short',
            day: 'numeric',
          }).format(new Date(`${value}T00:00:00`));
  return { value, label, urgent: dayDifference < 3 };
}

function initials(displayName: string) {
  return displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase())
    .join('');
}

function stateForGroup(groupId: string, states: TaskState[]) {
  return states.find(({ id }) => id === groupId);
}

function nextState(task: Task, states: TaskState[]) {
  const active = states.filter(({ archived_at }) => !archived_at);
  const targetRole =
    task.state.system_role === 'todo'
      ? 'in_progress'
      : task.state.system_role === 'in_progress'
        ? 'done'
        : task.state.system_role === 'done'
          ? 'todo'
          : null;
  const semanticNext = targetRole
    ? active.find(({ system_role }) => system_role === targetRole)
    : undefined;
  if (semanticNext) return semanticNext;
  const currentIndex = active.findIndex(({ id }) => id === task.state.id);
  return (
    active[(currentIndex + 1) % active.length] ?? {
      id: task.state.id,
      name: task.state.name,
    }
  );
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function taskCountLabel(count: number) {
  return `${count} ${count === 1 ? 'task' : 'tasks'}`;
}
