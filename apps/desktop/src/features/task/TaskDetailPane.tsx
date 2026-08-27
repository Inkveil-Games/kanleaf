import { Archive, FileText, MoreHorizontal, X } from 'lucide-react';
import {
  lazy,
  Suspense,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type {
  Project,
  Task,
  TaskPatch,
  TaskPriority,
  TaskState,
  TaskType,
} from '../workspace/types';

const MarkdownDocument = lazy(() =>
  import('../markdown/MarkdownDocument').then((module) => ({
    default: module.MarkdownDocument,
  })),
);

interface TaskDetailPaneProps {
  serverUrl: string;
  token: string;
  workspaceId: string;
  task: Task | null;
  projects: Project[];
  states: TaskState[];
  taskTypes: TaskType[];
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
  states,
  taskTypes,
  onPatch,
  onArchive,
  onClose,
  serverUrl,
  token,
  workspaceId,
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
          <Property label="State">
            <select
              aria-label="State"
              value={task.state.id}
              onChange={(event) => void patch({ state_id: event.target.value })}
            >
              {selectableStates(states, task).map((state) => (
                <option key={state.id} value={state.id}>
                  {state.name}
                </option>
              ))}
            </select>
          </Property>
          <Property label="Type">
            <select
              aria-label="Task type"
              value={task.task_type.id}
              onChange={(event) =>
                void patch({ task_type_id: event.target.value })
              }
            >
              {selectableTypes(taskTypes, task).map((taskType) => (
                <option key={taskType.id} value={taskType.id}>
                  {taskType.name}
                </option>
              ))}
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
              <option value="urgent">Urgent</option>
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

        <Suspense
          fallback={
            <section className="task-document">
              <div className="document-state">Loading editor…</div>
            </section>
          }
        >
          <MarkdownDocument
            serverUrl={serverUrl}
            token={token}
            workspaceId={workspaceId}
            taskId={task.id}
          />
        </Suspense>
      </div>
    </section>
  );
}

function selectableStates(states: TaskState[], task: Task) {
  const active = states.filter(({ archived_at }) => !archived_at);
  if (active.some(({ id }) => id === task.state.id)) return active;
  return [
    {
      ...task.state,
      workspace_id: task.workspace_id,
      position: -1,
      archived_at: task.updated_at,
      created_at: task.created_at,
      updated_at: task.updated_at,
    },
    ...active,
  ];
}

function selectableTypes(taskTypes: TaskType[], task: Task) {
  const active = taskTypes.filter(({ archived_at }) => !archived_at);
  if (active.some(({ id }) => id === task.task_type.id)) return active;
  return [
    {
      ...task.task_type,
      workspace_id: task.workspace_id,
      description: '',
      position: -1,
      is_protected: false,
      archived_at: task.updated_at,
      created_at: task.created_at,
      updated_at: task.updated_at,
    },
    ...active,
  ];
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
