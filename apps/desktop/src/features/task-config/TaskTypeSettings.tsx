import {
  Archive,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  LockKeyhole,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useState, type CSSProperties, type FormEvent } from 'react';
import { ColorSwatchPicker } from '../../components/ui/ColorSwatchPicker';
import { IconPicker } from '../../components/ui/IconPicker';
import { SettingsArticle } from '../settings/SettingsArticle';
import {
  SettingsAction,
  SettingsActionSeparator,
  SettingsActionsMenu,
  SettingsEmptyState,
  SettingsList,
  SettingsListCell,
} from '../settings/SettingsList';
import {
  SettingsSortableProvider,
  SettingsSortableRow,
} from '../settings/SettingsSortable';
import { errorMessage } from '../settings/utils';
import type { ApiContext } from '../workspace/api';
import type {
  TaskConfiguration,
  TaskType,
  Workspace,
} from '../workspace/types';
import { ArchivedConfigurationList } from './ArchivedConfigurationList';
import { ConfigurationDeleteDialog } from './ConfigurationDeleteDialog';
import { ConfigurationSwatch } from './ConfigurationSwatch';
import {
  createTaskType,
  deleteTaskType,
  reorderTaskTypes,
  updateTaskDefaults,
  updateTaskType,
} from './api';
import { TaskTypeIcon } from './TaskTypeIcon';
import {
  TASK_TYPE_ICON_FALLBACK,
  TASK_TYPE_ICON_OPTIONS,
} from './taskTypeIcons';

interface TaskTypeSettingsProps {
  context: ApiContext;
  workspace: Workspace;
  configuration: TaskConfiguration;
  onChanged: () => Promise<void>;
}

export function TaskTypeSettings(props: TaskTypeSettingsProps) {
  const canManage =
    props.workspace.role === 'owner' || props.workspace.role === 'admin';
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('circle-dot');
  const [color, setColor] = useState('#64748B');
  const [description, setDescription] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TaskType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const active = props.configuration.task_types.filter(
    (type) => !type.archived_at,
  );
  const archived = props.configuration.task_types.filter(
    (type) => type.archived_at,
  );

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createTaskType(props.context, props.workspace.id, {
        name: name.trim(),
        icon,
        color,
        description: description.trim(),
      });
      setName('');
      setDescription('');
      await props.onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await props.onChanged();
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      return false;
    }
  }

  async function move(taskTypeId: string, offset: -1 | 1) {
    const index = active.findIndex(({ id }) => id === taskTypeId);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= active.length) return;
    const ids = active.map(({ id }) => id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await run(() => reorderTaskTypes(props.context, props.workspace.id, ids));
  }

  return (
    <SettingsArticle
      className="configuration-settings"
      eyebrow="Workspace"
      title="Task types"
      description="Define the kinds of work your Workspace tracks."
    >
      {error ? (
        <p className="settings-error configuration-message" role="alert">
          {error}
        </p>
      ) : null}
      <SettingsList
        ariaLabel="Active task types"
        className="task-type-settings-grid"
        header={
          <>
            <SettingsListCell>
              <span className="sr-only">Order</span>
            </SettingsListCell>
            <SettingsListCell>Icon</SettingsListCell>
            <SettingsListCell>Color</SettingsListCell>
            <SettingsListCell>Name</SettingsListCell>
            <SettingsListCell>Description</SettingsListCell>
            <SettingsListCell>Status</SettingsListCell>
            <SettingsListCell>
              <span className="sr-only">Actions</span>
            </SettingsListCell>
          </>
        }
      >
        {canManage ? (
          <form
            className="settings-list-row settings-list-create-row"
            role="listitem"
            aria-label="Create Task type"
            onSubmit={(event) => void create(event)}
          >
            <SettingsListCell className="settings-grid-placeholder" />
            <SettingsListCell className="settings-visual-cell">
              <IconPicker
                ariaLabel="Choose Task type icon"
                dialogLabel="Task type icons"
                fallbackIcon={TASK_TYPE_ICON_FALLBACK}
                options={TASK_TYPE_ICON_OPTIONS}
                value={icon}
                disabled={saving}
                onChange={setIcon}
              />
            </SettingsListCell>
            <SettingsListCell className="settings-visual-cell">
              <ColorSwatchPicker
                ariaLabel="Choose new Task type color"
                disabled={saving}
                value={color}
                onChange={setColor}
              />
            </SettingsListCell>
            <SettingsListCell>
              <input
                aria-label="Task type name"
                required
                maxLength={120}
                value={name}
                placeholder="Type name"
                disabled={saving}
                onChange={(event) => setName(event.target.value)}
              />
            </SettingsListCell>
            <SettingsListCell>
              <input
                aria-label="Task type description"
                maxLength={500}
                value={description}
                placeholder="Optional description"
                disabled={saving}
                onChange={(event) => setDescription(event.target.value)}
              />
            </SettingsListCell>
            <SettingsListCell className="settings-create-hint">
              Added to the end
            </SettingsListCell>
            <SettingsListCell className="settings-list-actions-cell">
              <button
                className="primary-button compact-button"
                type="submit"
                disabled={saving || !name.trim()}
              >
                {saving ? 'Adding…' : 'Add type'}
              </button>
            </SettingsListCell>
          </form>
        ) : null}
        {active.length === 0 ? (
          <SettingsEmptyState
            title="No active Task types"
            description="Create a type to describe the work this Workspace tracks."
          />
        ) : null}
        <SettingsSortableProvider
          ids={active.map(({ id }) => id)}
          disabled={!canManage || editingId !== null}
          onReorder={(ids) =>
            run(() =>
              reorderTaskTypes(props.context, props.workspace.id, ids),
            ).then(() => undefined)
          }
        >
          {active.map((taskType, index) =>
            editingId === taskType.id ? (
              <TaskTypeEditRow
                key={taskType.id}
                taskType={taskType}
                onCancel={() => setEditingId(null)}
                onSave={async (patch) => {
                  const saved = await run(() =>
                    updateTaskType(
                      props.context,
                      props.workspace.id,
                      taskType.id,
                      patch,
                    ),
                  );
                  if (saved) setEditingId(null);
                }}
              />
            ) : (
              <SettingsSortableRow
                key={taskType.id}
                id={taskType.id}
                index={index}
                label={taskType.name}
                disabled={!canManage}
              >
                <SettingsListCell className="settings-visual-cell">
                  <span
                    className="task-type-icon-swatch"
                    style={
                      { '--task-type-color': taskType.color } as CSSProperties
                    }
                  >
                    <TaskTypeIcon iconKey={taskType.icon} />
                  </span>
                </SettingsListCell>
                <SettingsListCell className="settings-visual-cell">
                  <ConfigurationSwatch color={taskType.color} />
                </SettingsListCell>
                <SettingsListCell primary>{taskType.name}</SettingsListCell>
                <SettingsListCell className="settings-description-cell">
                  {taskType.description || 'No description'}
                </SettingsListCell>
                <SettingsListCell>
                  <span className="settings-status-stack">
                    {taskType.is_protected ? (
                      <span className="settings-status-badge">
                        <LockKeyhole aria-hidden="true" size={11} /> Protected
                      </span>
                    ) : null}
                    {taskType.id ===
                    props.configuration.default_task_type_id ? (
                      <span className="settings-status-badge is-accent">
                        <CheckCircle2 aria-hidden="true" size={11} /> Default
                      </span>
                    ) : null}
                    {!taskType.is_protected &&
                    taskType.id !== props.configuration.default_task_type_id ? (
                      <span className="settings-status-text">Available</span>
                    ) : null}
                  </span>
                </SettingsListCell>
                <SettingsListCell className="settings-list-actions-cell">
                  {canManage ? (
                    <SettingsActionsMenu label={`Actions for ${taskType.name}`}>
                      <SettingsAction
                        icon={<Pencil aria-hidden="true" size={14} />}
                        onClick={() => setEditingId(taskType.id)}
                      >
                        Edit
                      </SettingsAction>
                      {taskType.id !==
                      props.configuration.default_task_type_id ? (
                        <SettingsAction
                          icon={<CheckCircle2 aria-hidden="true" size={14} />}
                          onClick={() =>
                            void run(() =>
                              updateTaskDefaults(
                                props.context,
                                props.workspace.id,
                                { task_type_id: taskType.id },
                              ),
                            )
                          }
                        >
                          Make default
                        </SettingsAction>
                      ) : null}
                      <SettingsAction
                        disabled={index === 0}
                        icon={<ArrowUp aria-hidden="true" size={14} />}
                        onClick={() => void move(taskType.id, -1)}
                      >
                        Move up
                      </SettingsAction>
                      <SettingsAction
                        disabled={index === active.length - 1}
                        icon={<ArrowDown aria-hidden="true" size={14} />}
                        onClick={() => void move(taskType.id, 1)}
                      >
                        Move down
                      </SettingsAction>
                      {!taskType.is_protected ? (
                        <>
                          <SettingsActionSeparator />
                          <SettingsAction
                            disabled={
                              taskType.id ===
                              props.configuration.default_task_type_id
                            }
                            icon={<Archive aria-hidden="true" size={14} />}
                            onClick={() =>
                              void run(() =>
                                updateTaskType(
                                  props.context,
                                  props.workspace.id,
                                  taskType.id,
                                  { archived: true },
                                ),
                              )
                            }
                          >
                            Archive
                          </SettingsAction>
                          <SettingsAction
                            destructive
                            icon={<Trash2 aria-hidden="true" size={14} />}
                            onClick={() => setDeleteTarget(taskType)}
                          >
                            Delete
                          </SettingsAction>
                        </>
                      ) : null}
                    </SettingsActionsMenu>
                  ) : null}
                </SettingsListCell>
              </SettingsSortableRow>
            ),
          )}
        </SettingsSortableProvider>
      </SettingsList>
      <ArchivedConfigurationList
        ariaLabel="Archived task types"
        canManage={canManage}
        className="task-type-archive-list"
        items={archived.map((taskType) => ({
          id: taskType.id,
          name: taskType.name,
          detail: taskType.description || 'No description',
          visual: (
            <span
              className="task-type-icon-swatch"
              style={{ '--task-type-color': taskType.color } as CSSProperties}
            >
              <TaskTypeIcon iconKey={taskType.icon} />
            </span>
          ),
        }))}
        onRestore={(taskTypeId) =>
          run(() =>
            updateTaskType(props.context, props.workspace.id, taskTypeId, {
              archived: false,
            }),
          )
        }
      />
      {!canManage ? (
        <p className="settings-muted">
          Only Workspace Owners and Admins can change Task types.
        </p>
      ) : null}
      {deleteTarget ? (
        <ConfigurationDeleteDialog
          entityName={deleteTarget.name}
          entityType="Task type"
          explanation="Choose a replacement for tasks that still use this type."
          replacementOptions={[
            { value: '', label: 'No replacement' },
            ...active
              .filter(({ id }) => id !== deleteTarget.id)
              .map((taskType) => ({
                value: taskType.id,
                label: taskType.name,
              })),
          ]}
          onClose={() => setDeleteTarget(null)}
          onDelete={async (replacementId) => {
            await deleteTaskType(
              props.context,
              props.workspace.id,
              deleteTarget.id,
              replacementId,
            );
            await props.onChanged();
          }}
        />
      ) : null}
    </SettingsArticle>
  );
}

function TaskTypeEditRow({
  taskType,
  onCancel,
  onSave,
}: {
  taskType: TaskType;
  onCancel: () => void;
  onSave: (
    patch: Pick<TaskType, 'name' | 'icon' | 'color' | 'description'>,
  ) => Promise<void>;
}) {
  const [name, setName] = useState(taskType.name);
  const [icon, setIcon] = useState(taskType.icon);
  const [color, setColor] = useState(taskType.color);
  const [description, setDescription] = useState(taskType.description);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        icon,
        color,
        description: description.trim(),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="settings-list-row settings-list-edit-row"
      role="listitem"
      aria-label={`Edit ${taskType.name}`}
      onSubmit={(event) => void submit(event)}
    >
      <SettingsListCell className="settings-grid-placeholder" />
      <SettingsListCell className="settings-visual-cell">
        <IconPicker
          ariaLabel={`Change icon for ${taskType.name}`}
          dialogLabel="Task type icons"
          fallbackIcon={TASK_TYPE_ICON_FALLBACK}
          options={TASK_TYPE_ICON_OPTIONS}
          value={icon}
          disabled={saving}
          onChange={setIcon}
        />
      </SettingsListCell>
      <SettingsListCell className="settings-visual-cell">
        <ColorSwatchPicker
          ariaLabel={`Change color for ${taskType.name}`}
          disabled={saving}
          value={color}
          onChange={setColor}
        />
      </SettingsListCell>
      <SettingsListCell>
        <input
          autoFocus
          aria-label={`${taskType.name} name`}
          maxLength={120}
          disabled={saving}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </SettingsListCell>
      <SettingsListCell>
        <input
          aria-label={`${taskType.name} description`}
          maxLength={500}
          disabled={saving}
          value={description}
          placeholder="No description"
          onChange={(event) => setDescription(event.target.value)}
        />
      </SettingsListCell>
      <SettingsListCell className="settings-status-text">
        Editing
      </SettingsListCell>
      <SettingsListCell className="settings-edit-actions">
        <button
          className="text-button"
          type="button"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          className="primary-button compact-button"
          type="submit"
          disabled={saving || !name.trim()}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </SettingsListCell>
    </form>
  );
}
