import { CalendarDays, Plus, Search, X } from 'lucide-react';
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
  TaskType,
} from '../workspace/types';
import { TaskLayouts } from '../view/TaskLayouts';
import { buildTaskGroups } from '../view/grouping';
import { TaskViewToolbar } from '../view/TaskViewToolbar';
import type {
  SavedView,
  SavedViewVisibility,
  TaskLayout,
  TaskQuery,
} from '../view/types';

interface TaskListPaneProps {
  collection: Collection;
  projects: Project[];
  states: TaskState[];
  labels: TaskLabel[];
  taskTypes: TaskType[];
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
  taskTypes,
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
    labels: query.display.includes('labels'),
    dueDate: query.display.includes('due_date'),
  };
  const checkedVisibleIds = tasks
    .filter(({ id }) => checkedTaskIds.has(id))
    .map(({ id }) => id);
  const groupedTasks = query.grouping.primary
    ? buildTaskGroups(query.grouping.primary, tasks, projects, states).filter(
        ({ taskIds }) => taskIds.size > 0,
      )
    : [];

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
    if (event.key === ' ' && selectedTaskId) {
      event.preventDefault();
      toggleChecked(selectedTaskId);
      return;
    }
    const key = event.key.toLocaleLowerCase();
    if (!['arrowdown', 'arrowup', 'j', 'k'].includes(key)) return;
    event.preventDefault();
    const currentIndex = tasks.findIndex(({ id }) => id === selectedTaskId);
    const offset = key === 'arrowdown' || key === 'j' ? 1 : -1;
    const nextIndex = Math.min(
      tasks.length - 1,
      Math.max(0, currentIndex < 0 ? 0 : currentIndex + offset),
    );
    const nextTask = tasks[nextIndex];
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
        states={states}
        canEdit={canEditTask(task)}
        selected={task.id === selectedTaskId}
        checked={checkedTaskIds.has(task.id)}
        visibleFields={visibleFields}
        onSelect={() => onSelectTask(task.id)}
        onToggleChecked={() => toggleChecked(task.id)}
        onUpdateState={(stateId) => onUpdateState(task, stateId)}
      />
    ));
  }

  return (
    <section className="collection-pane" aria-labelledby="collection-title">
      <header className="collection-header">
        <div>
          <p className="pane-eyebrow">
            {activeView
              ? `${activeView.visibility === 'shared' ? 'Shared' : 'Personal'} View`
              : 'Collection'}
          </p>
          <h1 id="collection-title">{title}</h1>
        </div>
        <div className="collection-actions">
          {canCreate && (
            <button
              className="icon-button strong-icon-button"
              type="button"
              aria-label="New task"
              onClick={() => setComposing(true)}
            >
              <Plus aria-hidden="true" size={17} />
            </button>
          )}
        </div>
      </header>

      <div className="collection-controls">
        <div className="task-search">
          <Search aria-hidden="true" size={15} />
          <label className="sr-only" htmlFor="task-search-input">
            Search tasks
          </label>
          <input
            id="task-search-input"
            ref={searchRef}
            type="search"
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
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onQueryChange({ ...query, search: null })}
            >
              <X aria-hidden="true" size={14} />
            </button>
          )}
          <kbd>/</kbd>
        </div>
        <TaskViewToolbar
          query={query}
          layout={layout}
          states={states}
          labels={labels}
          taskTypes={taskTypes}
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
              <select
                defaultValue=""
                disabled={bulkUpdating}
                onChange={(event) => {
                  if (event.target.value) {
                    void applyBulk({ state_id: event.target.value });
                    event.target.value = '';
                  }
                }}
              >
                <option value="">State…</option>
                {states
                  .filter(({ archived_at }) => !archived_at)
                  .map((state) => (
                    <option key={state.id} value={state.id}>
                      {state.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Set priority</span>
              <select
                defaultValue=""
                disabled={bulkUpdating}
                onChange={(event) => {
                  if (event.target.value) {
                    void applyBulk({
                      priority: event.target.value as Task['priority'],
                    });
                    event.target.value = '';
                  }
                }}
              >
                <option value="">Priority…</option>
                <option value="none">None</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </label>
            <button
              type="button"
              disabled={bulkUpdating}
              onClick={() => setCheckedTaskIds(new Set())}
            >
              Clear
            </button>
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
            <button type="button" onClick={onRetry}>
              Try again
            </button>
          </div>
        )}
        {!loading && !error && tasks.length === 0 && (
          <div className="pane-state empty-state">
            <p>{query.search ? 'No matching tasks.' : 'Nothing here yet.'}</p>
            {!query.search && canCreate && (
              <button type="button" onClick={() => setComposing(true)}>
                Create a task <kbd>C</kbd>
              </button>
            )}
          </div>
        )}
        {tasks.length > 0 && layout === 'list' && (
          <div
            className="task-list"
            role="listbox"
            aria-multiselectable="true"
            aria-label={`${title} tasks`}
            tabIndex={0}
            onKeyDown={moveSelection}
          >
            {groupedTasks.length > 0
              ? groupedTasks.map((group) => {
                  const primaryTasks = tasks.filter((task) =>
                    group.taskIds.has(task.id),
                  );
                  const secondaryGroups = query.grouping.secondary
                    ? buildTaskGroups(
                        query.grouping.secondary,
                        primaryTasks,
                        projects,
                        states,
                      ).filter(({ taskIds }) => taskIds.size > 0)
                    : [];
                  return (
                    <section
                      className="task-list-group"
                      role="group"
                      aria-label={group.label}
                      key={group.id}
                    >
                      <header>
                        <strong>{group.label}</strong>
                        <span>{primaryTasks.length}</span>
                      </header>
                      {secondaryGroups.length > 0
                        ? secondaryGroups.map((secondary) => (
                            <div
                              className="task-list-subgroup"
                              key={secondary.id}
                            >
                              <h3>{secondary.label}</h3>
                              {renderTaskRows(
                                primaryTasks.filter((task) =>
                                  secondary.taskIds.has(task.id),
                                ),
                              )}
                            </div>
                          ))
                        : renderTaskRows(primaryTasks)}
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

interface TaskRowProps {
  task: Task;
  states: TaskState[];
  selected: boolean;
  checked: boolean;
  visibleFields: {
    priority: boolean;
    assignees: boolean;
    labels: boolean;
    dueDate: boolean;
  };
  canEdit: boolean;
  onSelect: () => void;
  onToggleChecked: () => void;
  onUpdateState: (stateId: string) => Promise<void>;
}

function TaskRow({
  task,
  states,
  selected,
  checked,
  visibleFields,
  canEdit,
  onSelect,
  onToggleChecked,
  onUpdateState,
}: TaskRowProps) {
  const next = nextState(task, states);
  return (
    <div
      className="task-row"
      role="option"
      aria-selected={selected}
      data-state-group={task.state.state_group}
    >
      <label className="task-select-control">
        <span className="sr-only">Select {task.title}</span>
        <input type="checkbox" checked={checked} onChange={onToggleChecked} />
      </label>
      {canEdit ? (
        <button
          className="task-status-button"
          type="button"
          aria-label={`Move ${task.title} to ${next.name}`}
          title={`Move to ${next.name}`}
          onClick={() => void onUpdateState(next.id)}
        >
          <span
            aria-hidden="true"
            style={{ '--task-state-color': task.state.color } as CSSProperties}
          />
        </button>
      ) : (
        <span
          className="task-status-button task-status-readonly"
          aria-hidden="true"
        >
          <span
            style={{ '--task-state-color': task.state.color } as CSSProperties}
          />
        </span>
      )}
      <button className="task-row-main" type="button" onClick={onSelect}>
        <span className="task-row-title">{task.title}</span>
        <span className="task-row-metadata">
          <span className="task-row-reference">{task.reference}</span>
          {visibleFields.priority && task.priority !== 'none' && (
            <span className={`priority-mark priority-${task.priority}`}>
              {task.priority}
            </span>
          )}
          {visibleFields.assignees && task.assignees.length > 0 && (
            <span>
              {task.assignees
                .map(({ display_name }) => display_name)
                .join(', ')}
            </span>
          )}
          {visibleFields.labels &&
            task.labels.slice(0, 2).map((label) => (
              <span className="task-row-label" key={label.id}>
                {label.name}
              </span>
            ))}
          {visibleFields.dueDate && task.due_date && (
            <span className="task-row-date">
              <CalendarDays aria-hidden="true" size={11} />
              {formatTaskDate(task.due_date)}
            </span>
          )}
          <span>{formatUpdatedAt(task.updated_at)}</span>
        </span>
      </button>
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
        <input
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
      <button type="submit" disabled={submitting}>
        Add
      </button>
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

function formatTaskDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${value}T00:00:00`));
}

function nextState(task: Task, states: TaskState[]) {
  const active = states.filter(({ archived_at }) => !archived_at);
  const targetGroup =
    task.state.state_group === 'todo'
      ? 'in_progress'
      : task.state.state_group === 'in_progress'
        ? 'done'
        : 'todo';
  const semanticNext = active.find(
    ({ state_group }) => state_group === targetGroup,
  );
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
