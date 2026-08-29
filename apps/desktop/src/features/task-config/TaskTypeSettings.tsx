import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  LockKeyhole,
  Trash2,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { SettingsArticle } from '../settings/SettingsArticle';
import { errorMessage } from '../settings/utils';
import type { ApiContext } from '../workspace/api';
import type {
  TaskConfiguration,
  TaskType,
  Workspace,
} from '../workspace/types';
import {
  createTaskType,
  deleteTaskType,
  reorderTaskTypes,
  updateTaskDefaults,
  updateTaskType,
} from './api';

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
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const active = props.configuration.task_types.filter(
    (type) => !type.archived_at,
  );
  const archived = props.configuration.task_types.filter(
    (type) => type.archived_at,
  );

  async function create(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createTaskType(props.context, props.workspace.id, {
        name,
        icon,
        color,
        description,
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
    } catch (caught) {
      setError(errorMessage(caught));
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
      description="Use types such as Task, Bug, or Story without turning Kanleaf into a custom workflow engine."
    >
      {canManage && (
        <form
          className="configuration-create-form type-create-form"
          onSubmit={(event) => void create(event)}
        >
          <label>
            <span>Name</span>
            <input
              aria-label="Task type name"
              required
              maxLength={120}
              value={name}
              placeholder="Type name"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            <span>Icon key</span>
            <input
              aria-label="Task type icon key"
              required
              maxLength={32}
              pattern="[a-z0-9](?:[a-z0-9_]|-)*"
              value={icon}
              onChange={(event) => setIcon(event.target.value)}
            />
          </label>
          <label className="color-field">
            <span>Color</span>
            <input
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value.toUpperCase())}
            />
          </label>
          <label>
            <span>Description</span>
            <input
              maxLength={500}
              value={description}
              placeholder="Optional context"
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <button
            className="primary-button compact-button"
            type="submit"
            disabled={saving}
          >
            {saving ? 'Adding…' : 'Add type'}
          </button>
        </form>
      )}
      {error && (
        <p className="settings-error configuration-message" role="alert">
          {error}
        </p>
      )}
      <div className="configuration-list" aria-label="Active task types">
        {active.map((taskType, index) => (
          <TaskTypeRow
            key={taskType.id}
            taskType={taskType}
            taskTypes={active}
            isDefault={taskType.id === props.configuration.default_task_type_id}
            canManage={canManage}
            canMoveUp={index > 0}
            canMoveDown={index < active.length - 1}
            onMove={(offset) => move(taskType.id, offset)}
            onSave={(patch) =>
              run(() =>
                updateTaskType(
                  props.context,
                  props.workspace.id,
                  taskType.id,
                  patch,
                ),
              )
            }
            onDefault={() =>
              run(() =>
                updateTaskDefaults(props.context, props.workspace.id, {
                  task_type_id: taskType.id,
                }),
              )
            }
            onArchive={() =>
              run(() =>
                updateTaskType(props.context, props.workspace.id, taskType.id, {
                  archived: true,
                }),
              )
            }
            onDelete={(replacementId) =>
              run(() =>
                deleteTaskType(
                  props.context,
                  props.workspace.id,
                  taskType.id,
                  replacementId,
                ),
              )
            }
          />
        ))}
      </div>
      {archived.length > 0 && (
        <section className="configuration-archive">
          <h2>Archived</h2>
          {archived.map((taskType) => (
            <div className="configuration-archived-row" key={taskType.id}>
              <span
                className="configuration-color"
                style={{ background: taskType.color }}
              />
              <span>
                <strong>{taskType.name}</strong>
                <small>{taskType.description || taskType.icon}</small>
              </span>
              {canManage && (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() =>
                    void run(() =>
                      updateTaskType(
                        props.context,
                        props.workspace.id,
                        taskType.id,
                        { archived: false },
                      ),
                    )
                  }
                >
                  <ArchiveRestore size={13} /> Restore
                </button>
              )}
            </div>
          ))}
        </section>
      )}
      {!canManage && (
        <p className="settings-muted">
          Only Workspace Owners and Admins can change task types.
        </p>
      )}
    </SettingsArticle>
  );
}

function TaskTypeRow({
  taskType,
  taskTypes,
  isDefault,
  canManage,
  canMoveUp,
  canMoveDown,
  onMove,
  onSave,
  onDefault,
  onArchive,
  onDelete,
}: {
  taskType: TaskType;
  taskTypes: TaskType[];
  isDefault: boolean;
  canManage: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (offset: -1 | 1) => Promise<void>;
  onSave: (
    patch: Pick<TaskType, 'name' | 'icon' | 'color' | 'description'>,
  ) => Promise<void>;
  onDefault: () => Promise<void>;
  onArchive: () => Promise<void>;
  onDelete: (replacementId?: string) => Promise<void>;
}) {
  const [name, setName] = useState(taskType.name);
  const [icon, setIcon] = useState(taskType.icon);
  const [color, setColor] = useState(taskType.color);
  const [description, setDescription] = useState(taskType.description);
  const replacements = taskTypes.filter(({ id }) => id !== taskType.id);
  const [replacementId, setReplacementId] = useState(replacements[0]?.id ?? '');
  const dirty =
    name.trim() !== taskType.name ||
    icon.trim() !== taskType.icon ||
    color !== taskType.color ||
    description.trim() !== taskType.description;

  return (
    <div className="configuration-row type-configuration-row">
      <div className="configuration-order">
        <button
          type="button"
          aria-label={`Move ${taskType.name} up`}
          disabled={!canManage || !canMoveUp}
          onClick={() => void onMove(-1)}
        >
          <ArrowUp size={13} />
        </button>
        <button
          type="button"
          aria-label={`Move ${taskType.name} down`}
          disabled={!canManage || !canMoveDown}
          onClick={() => void onMove(1)}
        >
          <ArrowDown size={13} />
        </button>
      </div>
      <input
        className="configuration-color-input"
        aria-label={`${taskType.name} color`}
        type="color"
        disabled={!canManage}
        value={color}
        onChange={(event) => setColor(event.target.value.toUpperCase())}
      />
      <input
        aria-label={`${taskType.name} name`}
        disabled={!canManage}
        maxLength={120}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <input
        aria-label={`${taskType.name} icon key`}
        disabled={!canManage}
        maxLength={32}
        value={icon}
        onChange={(event) => setIcon(event.target.value)}
      />
      <input
        aria-label={`${taskType.name} description`}
        disabled={!canManage}
        maxLength={500}
        value={description}
        placeholder="No description"
        onChange={(event) => setDescription(event.target.value)}
      />
      <div className="configuration-row-actions">
        {taskType.is_protected && (
          <span className="configuration-default">
            <LockKeyhole size={11} /> Protected
          </span>
        )}
        {isDefault ? (
          <span className="configuration-default">Workspace default</span>
        ) : (
          canManage && (
            <button
              type="button"
              className="text-button"
              onClick={() => void onDefault()}
            >
              Make default
            </button>
          )
        )}
        {canManage && dirty && (
          <button
            className="secondary-button"
            type="button"
            onClick={() => void onSave({ name, icon, color, description })}
          >
            Save
          </button>
        )}
        {canManage && !taskType.is_protected && (
          <button
            className="icon-button"
            type="button"
            aria-label={`Archive ${taskType.name}`}
            onClick={() => void onArchive()}
          >
            <Archive size={14} />
          </button>
        )}
      </div>
      {canManage && !taskType.is_protected && (
        <details className="configuration-delete">
          <summary aria-label={`Delete ${taskType.name}`}>
            <Trash2 size={14} />
          </summary>
          <div>
            <strong>Delete task type</strong>
            <p>Choose a replacement when this type is in use.</p>
            <label>
              <span className="sr-only">Replacement for {taskType.name}</span>
              <select
                value={replacementId}
                onChange={(event) => setReplacementId(event.target.value)}
              >
                <option value="">No replacement</option>
                {replacements.map((replacement) => (
                  <option key={replacement.id} value={replacement.id}>
                    {replacement.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="danger-button"
              type="button"
              onClick={() => {
                if (window.confirm(`Delete ${taskType.name}?`))
                  void onDelete(replacementId || undefined);
              }}
            >
              Delete
            </button>
          </div>
        </details>
      )}
    </div>
  );
}
