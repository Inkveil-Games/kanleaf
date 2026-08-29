import {
  Archive,
  ArrowLeft,
  Check,
  FileText,
  Link2,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import {
  lazy,
  Suspense,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type {
  Project,
  ProjectCycle,
  ProjectModule,
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
import { Select } from '../../components/ui/Select';
import { TaskActivity } from '../collaboration/TaskActivity';

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
  cycles: ProjectCycle[];
  modules: ProjectModule[];
  assigneeCandidates: TaskAssignee[];
  taskCandidates: Task[];
  loading: boolean;
  error: string | null;
  canEdit: boolean;
  currentUserId?: string;
  canComment?: boolean;
  canModerate?: boolean;
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
  cycles,
  modules,
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
  currentUserId = '',
  canComment = false,
  canModerate = false,
}: Omit<TaskDetailPaneProps, 'task'> & { task: Task }) {
  const [title, setTitle] = useState(task.title);
  const [savingTitle, setSavingTitle] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [relatedTaskId, setRelatedTaskId] = useState('');
  const [relationType, setRelationType] =
    useState<TaskRelationType>('relates_to');
  const [relationSaving, setRelationSaving] = useState(false);
  const [tab, setTab] = useState<'details' | 'activity'>('details');

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
            className="icon-button detail-back-button"
            type="button"
            aria-label="Close task"
            onClick={onClose}
          >
            <ArrowLeft aria-hidden="true" size={16} />
            <span>Back</span>
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

        <div
          className="detail-tabs"
          role="tablist"
          aria-label="Task detail sections"
        >
          <button
            id={`task-${task.id}-details-tab`}
            type="button"
            role="tab"
            aria-controls={`task-${task.id}-details-panel`}
            aria-selected={tab === 'details'}
            onClick={() => setTab('details')}
          >
            Details
          </button>
          <button
            id={`task-${task.id}-activity-tab`}
            type="button"
            role="tab"
            aria-controls={`task-${task.id}-activity-panel`}
            aria-selected={tab === 'activity'}
            onClick={() => setTab('activity')}
          >
            Activity
          </button>
        </div>

        {/* Keep the editor mounted so Activity cannot discard its local buffer. */}
        <div
          id={`task-${task.id}-details-panel`}
          className="task-details-section"
          role="tabpanel"
          aria-labelledby={`task-${task.id}-details-tab`}
          hidden={tab !== 'details'}
        >
          <dl className="task-properties">
            <Property label="State">
              <Select
                ariaLabel="State"
                value={task.state.id}
                disabled={!canEdit}
                options={selectableStates(states, task).map((state) => ({
                  value: state.id,
                  label: state.name,
                }))}
                onValueChange={(value) => void patch({ state_id: value })}
              />
            </Property>
            <Property label="Type">
              <Select
                ariaLabel="Task type"
                value={task.task_type.id}
                disabled={!canEdit}
                options={selectableTypes(taskTypes, task).map((taskType) => ({
                  value: taskType.id,
                  label: taskType.name,
                }))}
                onValueChange={(value) => void patch({ task_type_id: value })}
              />
            </Property>
            <Property label="Priority">
              <Select
                ariaLabel="Priority"
                value={task.priority}
                disabled={!canEdit}
                options={[
                  { value: 'none', label: 'No priority' },
                  { value: 'low', label: 'Low' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'high', label: 'High' },
                  { value: 'urgent', label: 'Urgent' },
                ]}
                onValueChange={(value) =>
                  void patch({ priority: value as TaskPriority })
                }
              />
            </Property>
            <Property label="Project">
              <Select
                ariaLabel="Project"
                value={task.project_id ?? ''}
                disabled={!canEdit}
                options={[
                  { value: '', label: 'Inbox' },
                  ...projects.map((project) => ({
                    value: project.id,
                    label: project.name,
                  })),
                ]}
                onValueChange={(value) => {
                  const projectId = value || null;
                  const cleanup = window.confirm(
                    'Move this Task and remove incompatible assignees, type, hierarchy, Cycle, or Modules if needed?',
                  );
                  if (!cleanup) return;
                  void patch({
                    project_id: projectId,
                    cleanup_invalid: true,
                  });
                }}
              />
            </Property>
            {task.project_id && (
              <Property label="Cycle">
                <Select
                  ariaLabel="Cycle"
                  value={task.cycle?.id ?? ''}
                  disabled={!canEdit}
                  options={[
                    { value: '', label: 'No Cycle' },
                    ...(task.cycle &&
                    !cycles.some(({ id }) => id === task.cycle?.id)
                      ? [{ value: task.cycle.id, label: task.cycle.name }]
                      : []),
                    ...cycles
                      .filter(
                        (cycle) =>
                          cycle.status !== 'completed' ||
                          cycle.id === task.cycle?.id,
                      )
                      .map((cycle) => ({
                        value: cycle.id,
                        label: `${cycle.name}${cycle.status === 'completed' ? ' · Completed' : ''}`,
                      })),
                  ]}
                  onValueChange={(value) =>
                    void patch({ cycle_id: value || null })
                  }
                />
              </Property>
            )}
            {task.project_id && (
              <Property label="Modules">
                <MultiValuePicker
                  label="Edit Modules"
                  emptyLabel="No Modules"
                  disabled={!canEdit}
                  values={task.modules.map(({ id }) => id)}
                  options={[
                    ...task.modules.filter(
                      (assigned) =>
                        !modules.some((module) => module.id === assigned.id),
                    ),
                    ...modules,
                  ].map((module) => ({ id: module.id, label: module.name }))}
                  onChange={(moduleIds) => patch({ module_ids: moduleIds })}
                />
              </Property>
            )}
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
              <Select
                ariaLabel="Parent task"
                disabled={!canEdit}
                value={task.parent?.id ?? ''}
                options={[
                  { value: '', label: 'No parent' },
                  ...taskCandidates
                    .filter(
                      (candidate) =>
                        candidate.id !== task.id &&
                        candidate.project_id === task.project_id,
                    )
                    .map((candidate) => ({
                      value: candidate.id,
                      label: `${candidate.reference} · ${candidate.title}`,
                    })),
                ]}
                onValueChange={(value) =>
                  void patch({ parent_id: value || null })
                }
              />
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
              target={{ kind: 'task', id: task.id }}
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
                      .catch((caught: unknown) =>
                        setError(errorMessage(caught)),
                      )
                      .finally(() => setRelationSaving(false));
                  }}
                >
                  <Link2 aria-hidden="true" size={14} />
                  <Select
                    ariaLabel="Relation type"
                    value={relationType}
                    options={[
                      { value: 'relates_to', label: 'Relates to' },
                      { value: 'blocking', label: 'Blocking' },
                      { value: 'blocked_by', label: 'Blocked by' },
                      { value: 'duplicate', label: 'Duplicate' },
                    ]}
                    onValueChange={(value) =>
                      setRelationType(value as TaskRelationType)
                    }
                  />
                  <Select
                    ariaLabel="Related task"
                    value={relatedTaskId}
                    options={[
                      { value: '', label: 'Choose a Task…' },
                      ...taskCandidates
                        .filter(
                          (candidate) =>
                            candidate.id !== task.id &&
                            !task.relations.some(
                              (relation) => relation.task.id === candidate.id,
                            ),
                        )
                        .map((candidate) => ({
                          value: candidate.id,
                          label: `${candidate.reference} · ${candidate.title}`,
                        })),
                    ]}
                    onValueChange={setRelatedTaskId}
                  />
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
        {tab === 'activity' && (
          <div
            id={`task-${task.id}-activity-panel`}
            role="tabpanel"
            aria-labelledby={`task-${task.id}-activity-tab`}
          >
            <TaskActivity
              context={{ serverUrl, token }}
              workspaceId={workspaceId}
              taskId={task.id}
              currentUserId={currentUserId}
              canComment={canComment}
              canModerate={canModerate}
            />
          </div>
        )}
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
