import {
  Archive,
  ArrowLeft,
  FileText,
  Link2,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import type {
  Project,
  ProjectCycle,
  ProjectModule,
  Task,
  TaskAssignee,
  TaskLabel,
  TaskPatch,
  TaskRelationType,
  TaskState,
  TaskType,
  CustomPropertyDefinition,
  TaskCustomPropertyValue,
  UndefinedTaskProperty,
} from '../workspace/types';
import {
  DropdownMenu,
  DropdownMenuItem,
} from '../../components/ui/DropdownMenu';
import { Select } from '../../components/ui/Select';
import { TaskActivity } from '../collaboration/TaskActivity';
import { TaskProperties } from './TaskProperties';

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
  canManageProperties?: boolean;
  customProperties?: CustomPropertyDefinition[];
  customPropertiesLoading?: boolean;
  customPropertiesError?: string | null;
  onRetryCustomProperties?: () => void;
  undefinedProperties?: UndefinedTaskProperty[];
  undefinedPropertiesLoading?: boolean;
  undefinedPropertiesError?: string | null;
  onRetryUndefinedProperties?: () => void;
  currentUserId?: string;
  canComment?: boolean;
  canModerate?: boolean;
  onPatch: (patch: TaskPatch) => Promise<void>;
  onCustomPropertyChange?: (
    propertyId: string,
    value?: TaskCustomPropertyValue['value'],
  ) => Promise<void>;
  onDefineProperty?: (name: string) => Promise<void>;
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
  canManageProperties = false,
  customProperties = [],
  customPropertiesLoading = false,
  customPropertiesError = null,
  onRetryCustomProperties = () => undefined,
  undefinedProperties = [],
  undefinedPropertiesLoading = false,
  undefinedPropertiesError = null,
  onRetryUndefinedProperties = () => undefined,
  onCustomPropertyChange = async () => undefined,
  onDefineProperty = async () => undefined,
  currentUserId = '',
  canComment = false,
  canModerate = false,
}: Omit<TaskDetailPaneProps, 'task'> & { task: Task }) {
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [title, setTitle] = useState(task.title);
  const [savingTitle, setSavingTitle] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [relatedTaskId, setRelatedTaskId] = useState('');
  const [relationType, setRelationType] =
    useState<TaskRelationType>('relates_to');
  const [relationSaving, setRelationSaving] = useState(false);

  const fitTitle = useCallback(() => {
    const input = titleRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
  }, []);

  useLayoutEffect(() => fitTitle(), [fitTitle, title]);

  useEffect(() => {
    window.addEventListener('resize', fitTitle);
    return () => window.removeEventListener('resize', fitTitle);
  }, [fitTitle]);

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

  const documentContext = (
    <>
      <TaskProperties
        task={task}
        projects={projects}
        states={states}
        taskTypes={taskTypes}
        labels={labels}
        cycles={cycles}
        modules={modules}
        assigneeCandidates={assigneeCandidates}
        taskCandidates={taskCandidates}
        canEdit={canEdit}
        canManageProperties={canManageProperties}
        onPatch={onPatch}
        customProperties={customProperties}
        customPropertiesLoading={customPropertiesLoading}
        customPropertiesError={customPropertiesError}
        onRetryCustomProperties={onRetryCustomProperties}
        undefinedProperties={undefinedProperties}
        undefinedPropertiesLoading={undefinedPropertiesLoading}
        undefinedPropertiesError={undefinedPropertiesError}
        onRetryUndefinedProperties={onRetryUndefinedProperties}
        onCustomPropertyChange={onCustomPropertyChange}
        onDefineProperty={onDefineProperty}
      />
      {error && (
        <p className="detail-error" role="alert">
          {error}
        </p>
      )}
    </>
  );

  return (
    <section className="detail-pane" aria-label="Task detail">
      <header className="detail-toolbar">
        <span className="task-reference">{task.reference}</span>
        <div>
          {canEdit && (
            <DropdownMenu label="Task actions" className="detail-menu">
              <DropdownMenuItem
                className="danger-menu-item"
                onClick={() => {
                  if (window.confirm(`Archive ${task.title}?`)) {
                    void onArchive();
                  }
                }}
              >
                <Archive aria-hidden="true" size={14} /> Archive task
              </DropdownMenuItem>
              <DropdownMenuItem
                className="danger-menu-item"
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
              </DropdownMenuItem>
            </DropdownMenu>
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
          ref={titleRef}
          className="task-title-input"
          aria-label="Task title"
          rows={1}
          maxLength={300}
          value={title}
          readOnly={!canEdit}
          disabled={savingTitle}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => void saveTitle()}
          onKeyDown={titleKeyDown}
        />

        <Suspense
          fallback={
            <section
              className="task-document task-document-contextual"
              aria-label="Markdown document"
            >
              <header className="document-toolbar document-toolbar-pending">
                <span>Markdown</span>
                <span className="save-indicator" role="status">
                  Loading…
                </span>
              </header>
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
            documentContext={documentContext}
          />
        </Suspense>

        <section className="task-secondary-details" aria-label="Task structure">
          <details className="task-structure-disclosure">
            <summary>
              <span>Subtasks</span>
              <span>{task.subtasks.length}</span>
            </summary>
            <div className="task-link-section">
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
          </details>
          <details className="task-structure-disclosure">
            <summary>
              <span>Relations</span>
              <span>{task.relations.length}</span>
            </summary>
            <div className="task-link-section">
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
          </details>
        </section>

        <TaskActivity
          context={{ serverUrl, token }}
          workspaceId={workspaceId}
          taskId={task.id}
          currentUserId={currentUserId}
          canComment={canComment}
          canModerate={canModerate}
        />
      </div>
    </section>
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
