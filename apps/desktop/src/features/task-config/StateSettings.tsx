import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Trash2,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { SettingsArticle } from '../settings/SettingsArticle';
import { errorMessage, titleCase } from '../settings/utils';
import type { ApiContext } from '../workspace/api';
import type {
  TaskConfiguration,
  TaskState,
  TaskStateGroup,
  Workspace,
} from '../workspace/types';
import {
  createTaskState,
  deleteTaskState,
  reorderTaskStates,
  updateTaskDefaults,
  updateTaskState,
} from './api';

interface StateSettingsProps {
  context: ApiContext;
  workspace: Workspace;
  configuration: TaskConfiguration;
  onChanged: () => Promise<void>;
}

export function StateSettings(props: StateSettingsProps) {
  const canManage =
    props.workspace.role === 'owner' || props.workspace.role === 'admin';
  const [name, setName] = useState('');
  const [color, setColor] = useState('#64748B');
  const [group, setGroup] = useState<TaskStateGroup>('todo');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const active = props.configuration.states.filter(
    (state) => !state.archived_at,
  );
  const archived = props.configuration.states.filter(
    (state) => state.archived_at,
  );

  async function create(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createTaskState(props.context, props.workspace.id, {
        name,
        color,
        state_group: group,
      });
      setName('');
      await props.onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function move(stateId: string, offset: -1 | 1) {
    const index = active.findIndex(({ id }) => id === stateId);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= active.length) return;
    const ids = active.map(({ id }) => id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await run(() => reorderTaskStates(props.context, props.workspace.id, ids));
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

  return (
    <SettingsArticle
      className="configuration-settings"
      eyebrow="Workspace"
      title="States"
      description="Name the steps work moves through. Semantic groups keep views and completion behavior consistent."
    >
      {canManage && (
        <form
          className="configuration-create-form state-create-form"
          onSubmit={(event) => void create(event)}
        >
          <label>
            <span>Name</span>
            <input
              required
              maxLength={120}
              value={name}
              placeholder="State name"
              onChange={(event) => setName(event.target.value)}
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
            <span>Group</span>
            <select
              aria-label="State group"
              value={group}
              onChange={(event) =>
                setGroup(event.target.value as TaskStateGroup)
              }
            >
              {STATE_GROUPS.map((value) => (
                <option key={value} value={value}>
                  {groupLabel(value)}
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary-button compact-button"
            type="submit"
            disabled={saving}
          >
            {saving ? 'Adding…' : 'Add state'}
          </button>
        </form>
      )}
      {error && (
        <p className="settings-error configuration-message" role="alert">
          {error}
        </p>
      )}
      <div className="configuration-list" aria-label="Active task states">
        {active.map((state, index) => (
          <StateRow
            key={state.id}
            state={state}
            states={active}
            isDefault={state.id === props.configuration.default_state_id}
            canManage={canManage}
            canMoveUp={index > 0}
            canMoveDown={index < active.length - 1}
            onMove={(offset) => move(state.id, offset)}
            onSave={(patch) =>
              run(() =>
                updateTaskState(
                  props.context,
                  props.workspace.id,
                  state.id,
                  patch,
                ),
              )
            }
            onDefault={() =>
              run(() =>
                updateTaskDefaults(props.context, props.workspace.id, {
                  state_id: state.id,
                }),
              )
            }
            onArchive={() =>
              run(() =>
                updateTaskState(props.context, props.workspace.id, state.id, {
                  archived: true,
                }),
              )
            }
            onDelete={(replacementId) =>
              run(() =>
                deleteTaskState(
                  props.context,
                  props.workspace.id,
                  state.id,
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
          {archived.map((state) => (
            <div className="configuration-archived-row" key={state.id}>
              <span
                className="configuration-color"
                style={{ background: state.color }}
              />
              <span>
                <strong>{state.name}</strong>
                <small>{groupLabel(state.state_group)}</small>
              </span>
              {canManage && (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() =>
                    void run(() =>
                      updateTaskState(
                        props.context,
                        props.workspace.id,
                        state.id,
                        { archived: false },
                      ),
                    )
                  }
                >
                  <ArchiveRestore aria-hidden="true" size={13} /> Restore
                </button>
              )}
            </div>
          ))}
        </section>
      )}
      {!canManage && (
        <p className="settings-muted">
          Only Workspace Owners and Admins can change task states.
        </p>
      )}
    </SettingsArticle>
  );
}

function StateRow({
  state,
  states,
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
  state: TaskState;
  states: TaskState[];
  isDefault: boolean;
  canManage: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (offset: -1 | 1) => Promise<void>;
  onSave: (
    patch: Pick<TaskState, 'name' | 'color' | 'state_group'>,
  ) => Promise<void>;
  onDefault: () => Promise<void>;
  onArchive: () => Promise<void>;
  onDelete: (replacementId?: string) => Promise<void>;
}) {
  const [name, setName] = useState(state.name);
  const [color, setColor] = useState(state.color);
  const [group, setGroup] = useState(state.state_group);
  const replacements = states.filter(
    ({ id, state_group }) =>
      id !== state.id && state_group === state.state_group,
  );
  const [replacementId, setReplacementId] = useState(replacements[0]?.id ?? '');
  const dirty =
    name.trim() !== state.name ||
    color !== state.color ||
    group !== state.state_group;

  return (
    <div className="configuration-row">
      <div className="configuration-order">
        <button
          type="button"
          aria-label={`Move ${state.name} up`}
          disabled={!canManage || !canMoveUp}
          onClick={() => void onMove(-1)}
        >
          <ArrowUp size={13} />
        </button>
        <button
          type="button"
          aria-label={`Move ${state.name} down`}
          disabled={!canManage || !canMoveDown}
          onClick={() => void onMove(1)}
        >
          <ArrowDown size={13} />
        </button>
      </div>
      <input
        className="configuration-color-input"
        aria-label={`${state.name} color`}
        type="color"
        disabled={!canManage}
        value={color}
        onChange={(event) => setColor(event.target.value.toUpperCase())}
      />
      <input
        aria-label={`${state.name} name`}
        disabled={!canManage}
        maxLength={120}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <select
        aria-label={`${state.name} group`}
        disabled={!canManage}
        value={group}
        onChange={(event) => setGroup(event.target.value as TaskStateGroup)}
      >
        {STATE_GROUPS.map((value) => (
          <option key={value} value={value}>
            {groupLabel(value)}
          </option>
        ))}
      </select>
      <div className="configuration-row-actions">
        {isDefault ? (
          <span className="configuration-default">Inbox default</span>
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
            type="button"
            className="secondary-button"
            onClick={() => void onSave({ name, color, state_group: group })}
          >
            Save
          </button>
        )}
        {canManage && (
          <button
            className="icon-button"
            type="button"
            aria-label={`Archive ${state.name}`}
            onClick={() => void onArchive()}
          >
            <Archive size={14} />
          </button>
        )}
      </div>
      {canManage && (
        <details className="configuration-delete">
          <summary aria-label={`Delete ${state.name}`}>
            <Trash2 size={14} />
          </summary>
          <div>
            <strong>Delete state</strong>
            <p>Choose a same-group replacement when this state is in use.</p>
            <label>
              <span className="sr-only">Replacement for {state.name}</span>
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
                if (window.confirm(`Delete ${state.name}?`))
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

const STATE_GROUPS: TaskStateGroup[] = [
  'backlog',
  'todo',
  'in_progress',
  'done',
  'canceled',
];

function groupLabel(group: TaskStateGroup) {
  return titleCase(group.replace('_', ' '));
}
