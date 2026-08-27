import { Archive, Check, FileText, Link2, Plus, Trash2, X } from 'lucide-react';
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
  TaskAssignee,
  TaskLabel,
  TaskPatch,
  TaskPriority,
  TaskRelationType,
  TaskState,
  TaskType,
} from '../workspace/types';
import { ContextMenu } from '../../components/ui/ContextMenu';

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
  labels: TaskLabel[];
  assigneeCandidates: TaskAssignee[];
  taskCandidates: Task[];
  loading: boolean;
  error: string | null;
  canEdit: boolean;
  onPatch: (patch: TaskPatch) => Promise<void>;
  onArchive: () => Promise<void>;
  onDelete: (reference: string) => Promise<void>;
  onAddRelation: (
    relatedTaskId: string,
    relationType: TaskRelationType,
  ) => Promise<void>;
  onRemoveRelation: (relatedTaskId: string) => Promise<void>;
  onOpenTask: (taskId: string) => void;
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
  labels,
  assigneeCandidates,
  taskCandidates,
  onPatch,
  onArchive,
  onDelete,
  onAddRelation,
  onRemoveRelation,
  onOpenTask,
  onClose,
  serverUrl,
  token,
  workspaceId,
  canEdit,
}: Omit<TaskDetailPaneProps, 'task'> & { task: Task }) {
  const [title, setTitle] = useState(task.title);
  const [savingTitle, setSavingTitle] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [relatedTaskId, setRelatedTaskId] = useState('');
  const [relationType, setRelationType] =
    useState<TaskRelationType>('relates_to');
  const [relationSaving, setRelationSaving] = useState(false);

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
        <span className="task-reference">{task.reference}</span>
        <div>
          {canEdit && (
            <ContextMenu label="Task actions" className="detail-menu">
              <button
                className="danger-menu-item"
                role="menuitem"
                type="button"
                onClick={() => {
                  if (window.confirm(`Archive ${task.title}?`)) {
                    void onArchive();
                  }
                }}
              >
                <Archive aria-hidden="true" size={14} /> Archive task
              </button>
              <button
                className="danger-menu-item"
                role="menuitem"
                type="button"
                onClick={() => {
                  const confirmation = window.prompt(
                    `Enter ${task.reference} to permanently delete this Task`,
                  );
                  if (confirmation === task.reference) {
                    void onDelete(task.reference).catch((caught: unknown) =>
                      setError(errorMessage(caught)),
                    );
                  }
                }}
              >
                <Trash2 aria-hidden="true" size={14} /> Delete permanently
              </button>
            </ContextMenu>
          )}
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
          readOnly={!canEdit}
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
              disabled={!canEdit}
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
              disabled={!canEdit}
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
              disabled={!canEdit}
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
              disabled={!canEdit}
              onChange={(event) => {
                const projectId = event.target.value || null;
                const cleanup = window.confirm(
                  'Move this Task and remove incompatible assignees, type, or hierarchy if needed?',
                );
                if (!cleanup) return;
                void patch({
                  project_id: projectId,
                  cleanup_invalid: true,
                });
              }}
            >
              <option value="">Inbox</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </Property>
          <Property label="Assignees">
            <MultiValuePicker
              label="Edit assignees"
              emptyLabel="Unassigned"
              disabled={!canEdit}
              values={task.assignees.map(({ user_id }) => user_id)}
              options={assigneeCandidates.map((member) => ({
                id: member.user_id,
                label: member.display_name,
              }))}
              onChange={(assigneeIds) => patch({ assignee_ids: assigneeIds })}
            />
          </Property>
          <Property label="Labels">
            <MultiValuePicker
              label="Edit labels"
              emptyLabel="No labels"
              disabled={!canEdit}
              values={task.labels.map(({ id }) => id)}
              options={labels
                .filter(
                  ({ id, archived_at }) =>
                    !archived_at ||
                    task.labels.some((label) => label.id === id),
                )
                .map((label) => ({ id: label.id, label: label.name }))}
              onChange={(labelIds) => patch({ label_ids: labelIds })}
            />
          </Property>
          <Property label="Start date">
            <input
              aria-label="Start date"
              type="date"
              disabled={!canEdit}
              value={task.start_date ?? ''}
              onChange={(event) =>
                void patch({ start_date: event.target.value || null })
              }
            />
          </Property>
          <Property label="Due date">
            <input
              aria-label="Due date"
              type="date"
              disabled={!canEdit}
              value={task.due_date ?? ''}
              onChange={(event) =>
                void patch({ due_date: event.target.value || null })
              }
            />
          </Property>
          <Property label="Estimate">
            <input
              aria-label="Estimate"
              type="number"
              min={0}
              disabled={!canEdit}
              value={task.estimate ?? ''}
              placeholder="No estimate"
              onChange={(event) =>
                void patch({
                  estimate: event.target.value
                    ? Number(event.target.value)
                    : null,
                })
              }
            />
          </Property>
          <Property label="Parent">
            <select
              aria-label="Parent task"
              disabled={!canEdit}
              value={task.parent?.id ?? ''}
              onChange={(event) =>
                void patch({ parent_id: event.target.value || null })
              }
            >
              <option value="">No parent</option>
              {taskCandidates
                .filter(
                  (candidate) =>
                    candidate.id !== task.id &&
                    candidate.project_id === task.project_id,
                )
                .map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.reference} · {candidate.title}
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
            readOnly={!canEdit}
          />
        </Suspense>

        <section
          className="task-secondary-details"
          aria-labelledby="task-links-title"
        >
          <header>
            <div>
              <p className="pane-eyebrow">Structure</p>
              <h2 id="task-links-title">Subtasks and relations</h2>
            </div>
          </header>
          <div className="task-link-section">
            <h3>Subtasks</h3>
            {task.subtasks.length === 0 ? (
              <p>No subtasks.</p>
            ) : (
              task.subtasks.map((subtask) => (
                <button
                  key={subtask.id}
                  type="button"
                  onClick={() => onOpenTask(subtask.id)}
                >
                  <span>{subtask.reference}</span>
                  {subtask.title}
                </button>
              ))
            )}
          </div>
          <div className="task-link-section">
            <h3>Relations</h3>
            {task.relations.map((relation) => (
              <div className="task-relation-row" key={relation.task.id}>
                <button
                  type="button"
                  onClick={() => onOpenTask(relation.task.id)}
                >
                  <span>{relationLabel(relation.relation_type)}</span>
                  {relation.task.reference} · {relation.task.title}
                </button>
                {canEdit && (
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={`Remove relation to ${relation.task.title}`}
                    onClick={() =>
                      void onRemoveRelation(relation.task.id).catch(
                        (caught: unknown) => setError(errorMessage(caught)),
                      )
                    }
                  >
                    <X aria-hidden="true" size={13} />
                  </button>
                )}
              </div>
            ))}
            {task.relations.length === 0 && <p>No relations.</p>}
            {canEdit && (
              <form
                className="relation-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!relatedTaskId) return;
                  setRelationSaving(true);
                  void onAddRelation(relatedTaskId, relationType)
                    .then(() => setRelatedTaskId(''))
                    .catch((caught: unknown) => setError(errorMessage(caught)))
                    .finally(() => setRelationSaving(false));
                }}
              >
                <Link2 aria-hidden="true" size={14} />
                <select
                  aria-label="Relation type"
                  value={relationType}
                  onChange={(event) =>
                    setRelationType(event.target.value as TaskRelationType)
                  }
                >
                  <option value="relates_to">Relates to</option>
                  <option value="blocking">Blocking</option>
                  <option value="blocked_by">Blocked by</option>
                  <option value="duplicate">Duplicate</option>
                </select>
                <select
                  required
                  aria-label="Related task"
                  value={relatedTaskId}
                  onChange={(event) => setRelatedTaskId(event.target.value)}
                >
                  <option value="">Choose a Task…</option>
                  {taskCandidates
                    .filter(
                      (candidate) =>
                        candidate.id !== task.id &&
                        !task.relations.some(
                          (relation) => relation.task.id === candidate.id,
                        ),
                    )
                    .map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.reference} · {candidate.title}
                      </option>
                    ))}
                </select>
                <button
                  type="submit"
                  disabled={relationSaving || !relatedTaskId}
                >
                  <Plus aria-hidden="true" size={14} /> Add
                </button>
              </form>
            )}
          </div>
        </section>
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

interface MultiValuePickerProps {
  label: string;
  emptyLabel: string;
  disabled: boolean;
  values: string[];
  options: { id: string; label: string }[];
  onChange: (values: string[]) => Promise<void>;
}

function MultiValuePicker({
  label,
  emptyLabel,
  disabled,
  values,
  options,
  onChange,
}: MultiValuePickerProps) {
  const [saving, setSaving] = useState(false);
  const selectedLabels = options
    .filter(({ id }) => values.includes(id))
    .map((option) => option.label);
  const summary =
    selectedLabels.length > 0 ? selectedLabels.join(', ') : emptyLabel;
  if (disabled)
    return <span className="property-readonly-value">{summary}</span>;
  return (
    <ContextMenu
      label={label}
      className="property-picker"
      trigger={<span>{summary}</span>}
    >
      {options.length === 0 ? (
        <span className="menu-empty-state">No options available</span>
      ) : (
        options.map((option) => {
          const selected = values.includes(option.id);
          return (
            <button
              key={option.id}
              data-menu-keep-open
              role="menuitemcheckbox"
              aria-checked={selected}
              type="button"
              disabled={saving}
              onClick={() => {
                setSaving(true);
                void onChange(
                  selected
                    ? values.filter((value) => value !== option.id)
                    : [...values, option.id],
                ).finally(() => setSaving(false));
              }}
            >
              <Check aria-hidden="true" size={14} opacity={selected ? 1 : 0} />
              {option.label}
            </button>
          );
        })
      )}
    </ContextMenu>
  );
}

function relationLabel(relationType: TaskRelationType) {
  return {
    blocking: 'Blocking',
    blocked_by: 'Blocked by',
    relates_to: 'Relates to',
    duplicate: 'Duplicate',
  }[relationType];
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Task update failed';
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
