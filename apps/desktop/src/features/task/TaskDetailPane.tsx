import { Archive, FileText, MoreHorizontal, X } from 'lucide-react';
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import type {
  Project,
  Task,
  TaskPatch,
  TaskPriority,
  TaskStatus,
} from '../workspace/types';

interface TaskDetailPaneProps {
  task: Task | null;
  projects: Project[];
  loading: boolean;
  error: string | null;
  onPatch: (patch: TaskPatch) => Promise<void>;
  onArchive: () => Promise<void>;
  onClose: () => void;
  onRetry: () => void;
}

export function TaskDetailPane(props: TaskDetailPaneProps) {
  if (props.loading && !props.task) {
    return (
      <section className="detail-pane detail-loading" aria-label="Task detail">
        <span />
        <span />
        <span />
      </section>
    );
  }
  if (props.error && !props.task) {
    return (
      <section className="detail-pane detail-empty" aria-label="Task detail">
        <div role="alert">
          <p>{props.error}</p>
          <button type="button" onClick={props.onRetry}>
            Try again
          </button>
        </div>
      </section>
    );
  }
  if (!props.task) return <EmptyDetail />;
  return (
    <SelectedTaskDetail key={props.task.id} {...props} task={props.task} />
  );
}

function SelectedTaskDetail({
  task,
  projects,
  onPatch,
  onArchive,
  onClose,
}: Omit<TaskDetailPaneProps, 'task'> & { task: Task }) {
  const [title, setTitle] = useState(task.title);
  const [savingTitle, setSavingTitle] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveTitle() {
    const nextTitle = title.trim();
    if (!nextTitle) {
      setTitle(task.title);
      return;
    }
    if (nextTitle === task.title) return;
    setSavingTitle(true);
    setError(null);
    try {
      await onPatch({ title: nextTitle });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Task update failed');
      setTitle(task.title);
    } finally {
      setSavingTitle(false);
    }
  }

  function titleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.blur();
    }
    if (event.key === 'Escape') {
      setTitle(task.title);
      event.currentTarget.blur();
    }
  }

  async function patch(patchValue: TaskPatch) {
    setError(null);
    try {
      await onPatch(patchValue);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Task update failed');
    }
  }

  return (
    <section className="detail-pane" aria-label="Task detail">
      <header className="detail-toolbar">
        <span className="task-reference">Task</span>
        <div>
          <details className="context-menu detail-menu">
            <summary aria-label="Task actions">
              <MoreHorizontal aria-hidden="true" size={17} />
            </summary>
            <div className="context-menu-popover">
              <button
                className="danger-menu-item"
                type="button"
                onClick={() => {
                  if (window.confirm(`Archive ${task.title}?`)) {
                    void onArchive();
                  }
                }}
              >
                <Archive aria-hidden="true" size={14} /> Archive task
              </button>
            </div>
          </details>
          <button
            className="icon-button"
            type="button"
            aria-label="Close task"
            onClick={onClose}
          >
            <X aria-hidden="true" size={17} />
          </button>
        </div>
      </header>

      <div className="detail-scroll">
        <textarea
          className="task-title-input"
          aria-label="Task title"
          rows={2}
          maxLength={300}
          value={title}
          disabled={savingTitle}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => void saveTitle()}
          onKeyDown={titleKeyDown}
        />

        <dl className="task-properties">
          <Property label="Status">
            <select
              aria-label="Status"
              value={task.status}
              onChange={(event) =>
                void patch({ status: event.target.value as TaskStatus })
              }
            >
              <option value="todo">Todo</option>
              <option value="in_progress">In progress</option>
              <option value="done">Done</option>
            </select>
          </Property>
          <Property label="Priority">
            <select
              aria-label="Priority"
              value={task.priority}
              onChange={(event) =>
                void patch({ priority: event.target.value as TaskPriority })
              }
            >
              <option value="none">No priority</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </Property>
          <Property label="Project">
            <select
              aria-label="Project"
              value={task.project_id ?? ''}
              onChange={(event) =>
                void patch({ project_id: event.target.value || null })
              }
            >
              <option value="">Inbox</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </Property>
        </dl>
        {error && (
          <p className="detail-error" role="alert">
            {error}
          </p>
        )}

        <section
          className="document-placeholder"
          aria-labelledby="document-heading"
        >
          <div className="document-heading-row">
            <FileText aria-hidden="true" size={16} />
            <h2 id="document-heading">Markdown document</h2>
          </div>
          <p>The task document is loading into the editor.</p>
        </section>
      </div>
    </section>
  );
}

interface PropertyProps {
  label: string;
  children: ReactNode;
}

function Property({ label, children }: PropertyProps) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function EmptyDetail() {
  return (
    <section className="detail-pane detail-empty" aria-label="Task detail">
      <div>
        <FileText aria-hidden="true" size={22} />
        <h2>Select a task</h2>
        <p>Structured details and its Markdown document will open here.</p>
      </div>
    </section>
  );
}
