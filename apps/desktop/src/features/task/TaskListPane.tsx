import { Plus, Search, X } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { Collection, Project, Task, TaskStatus } from '../workspace/types';

interface TaskListPaneProps {
  collection: Collection;
  projects: Project[];
  tasks: Task[];
  selectedTaskId: string | null;
  query: string;
  loading: boolean;
  error: string | null;
  onQueryChange: (query: string) => void;
  onSelectTask: (taskId: string) => void;
  onCreateTask: (title: string) => Promise<void>;
  onUpdateStatus: (task: Task, status: TaskStatus) => Promise<void>;
  onRetry: () => void;
  onClearSelection: () => void;
}

export function TaskListPane({
  collection,
  projects,
  tasks,
  selectedTaskId,
  query,
  loading,
  error,
  onQueryChange,
  onSelectTask,
  onCreateTask,
  onUpdateStatus,
  onRetry,
  onClearSelection,
}: TaskListPaneProps) {
  const [composing, setComposing] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const title = collectionTitle(collection, projects);

  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isEditing =
        target?.matches('input, textarea, select, [contenteditable="true"]') ??
        false;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (!isEditing && !event.metaKey && !event.ctrlKey && event.key === 'n') {
        event.preventDefault();
        setComposing(true);
      }
      if (!isEditing && event.key === 'Escape') onClearSelection();
    }
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, [onClearSelection]);

  function moveSelection(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const currentIndex = tasks.findIndex(({ id }) => id === selectedTaskId);
    const offset = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = Math.min(
      tasks.length - 1,
      Math.max(0, currentIndex < 0 ? 0 : currentIndex + offset),
    );
    const nextTask = tasks[nextIndex];
    if (nextTask) onSelectTask(nextTask.id);
  }

  return (
    <section className="collection-pane" aria-labelledby="collection-title">
      <header className="collection-header">
        <div>
          <p className="pane-eyebrow">Collection</p>
          <h1 id="collection-title">{title}</h1>
        </div>
        <button
          className="icon-button strong-icon-button"
          type="button"
          aria-label="New task"
          onClick={() => setComposing(true)}
        >
          <Plus aria-hidden="true" size={17} />
        </button>
      </header>

      <div className="task-search">
        <Search aria-hidden="true" size={15} />
        <label className="sr-only" htmlFor="task-search-input">
          Search tasks
        </label>
        <input
          id="task-search-input"
          ref={searchRef}
          type="search"
          value={query}
          placeholder="Search tasks"
          onChange={(event) => onQueryChange(event.target.value)}
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onQueryChange('')}
          >
            <X aria-hidden="true" size={14} />
          </button>
        )}
        <kbd>⌘K</kbd>
      </div>

      <div
        className="task-list"
        role="listbox"
        aria-label={`${title} tasks`}
        tabIndex={0}
        onKeyDown={moveSelection}
      >
        {composing && (
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
            <p>{query ? 'No matching tasks.' : 'Nothing here yet.'}</p>
            {!query && (
              <button type="button" onClick={() => setComposing(true)}>
                Create a task <kbd>N</kbd>
              </button>
            )}
          </div>
        )}
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            selected={task.id === selectedTaskId}
            onSelect={() => onSelectTask(task.id)}
            onUpdateStatus={(status) => onUpdateStatus(task, status)}
          />
        ))}
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
  selected: boolean;
  onSelect: () => void;
  onUpdateStatus: (status: TaskStatus) => Promise<void>;
}

function TaskRow({ task, selected, onSelect, onUpdateStatus }: TaskRowProps) {
  return (
    <div
      className="task-row"
      role="option"
      aria-selected={selected}
      data-status={task.status}
    >
      <button
        className="task-status-button"
        type="button"
        aria-label={`Mark ${task.title} ${nextStatusLabel(task.status)}`}
        onClick={() => void onUpdateStatus(nextStatus(task.status))}
      >
        <span aria-hidden="true" />
      </button>
      <button className="task-row-main" type="button" onClick={onSelect}>
        <span className="task-row-title">{task.title}</span>
        <span className="task-row-metadata">
          {task.priority !== 'none' && (
            <span className={`priority-mark priority-${task.priority}`}>
              {task.priority}
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
  if (collection.kind === 'all') return 'My tasks';
  return (
    projects.find(({ id }) => id === collection.projectId)?.name ?? 'Project'
  );
}

function nextStatus(status: TaskStatus): TaskStatus {
  if (status === 'todo') return 'in_progress';
  if (status === 'in_progress') return 'done';
  return 'todo';
}

function nextStatusLabel(status: TaskStatus) {
  if (status === 'todo') return 'in progress';
  if (status === 'in_progress') return 'done';
  return 'todo';
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
