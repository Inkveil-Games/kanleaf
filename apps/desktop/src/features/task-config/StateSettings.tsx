import {
  Archive,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ColorSwatchPicker } from '../../components/ui/ColorSwatchPicker';
import { Select } from '../../components/ui/Select';
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
import { errorMessage, titleCase } from '../settings/utils';
import type { ApiContext } from '../workspace/api';
import type {
  TaskConfiguration,
  TaskState,
  TaskStateGroup,
  Workspace,
} from '../workspace/types';
import { ArchivedConfigurationList } from './ArchivedConfigurationList';
import { ConfigurationDeleteDialog } from './ConfigurationDeleteDialog';
import { ConfigurationSwatch } from './ConfigurationSwatch';
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
  const [color, setColor] = useState(STATE_GROUP_COLORS.todo);
  const [colorChanged, setColorChanged] = useState(false);
  const [group, setGroup] = useState<TaskStateGroup>('todo');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TaskState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const active = props.configuration.states.filter(
    (state) => !state.archived_at,
  );
  const archived = props.configuration.states.filter(
    (state) => state.archived_at,
  );

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createTaskState(props.context, props.workspace.id, {
        name: name.trim(),
        color,
        state_group: group,
      });
      setName('');
      setGroup('todo');
      setColor(STATE_GROUP_COLORS.todo);
      setColorChanged(false);
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

  async function move(stateId: string, offset: -1 | 1) {
    const index = active.findIndex(({ id }) => id === stateId);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= active.length) return;
    const ids = active.map(({ id }) => id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await run(() => reorderTaskStates(props.context, props.workspace.id, ids));
  }

  return (
    <SettingsArticle
      className="configuration-settings"
      eyebrow="Workspace"
      title="States"
      description="Define the steps work moves through."
    >
      {error ? (
        <p className="settings-error configuration-message" role="alert">
          {error}
        </p>
      ) : null}
      <SettingsList
        ariaLabel="Active task states"
        className="state-settings-grid"
        header={
          <>
            <SettingsListCell>
              <span className="sr-only">Order</span>
            </SettingsListCell>
            <SettingsListCell>Color</SettingsListCell>
            <SettingsListCell>Name</SettingsListCell>
            <SettingsListCell>Group</SettingsListCell>
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
            aria-label="Create state"
            onSubmit={(event) => void create(event)}
          >
            <SettingsListCell className="settings-grid-placeholder" />
            <SettingsListCell className="settings-visual-cell">
              <ColorSwatchPicker
                ariaLabel="Choose new state color"
                disabled={saving}
                value={color}
                onChange={(value) => {
                  setColor(value);
                  setColorChanged(true);
                }}
              />
            </SettingsListCell>
            <SettingsListCell>
              <input
                aria-label="State name"
                required
                maxLength={120}
                value={name}
                placeholder="State name"
                disabled={saving}
                onChange={(event) => setName(event.target.value)}
              />
            </SettingsListCell>
            <SettingsListCell>
              <Select
                ariaLabel="State group"
                disabled={saving}
                value={group}
                options={stateGroupOptions()}
                onValueChange={(value) => {
                  const nextGroup = value as TaskStateGroup;
                  setGroup(nextGroup);
                  if (!colorChanged) setColor(STATE_GROUP_COLORS[nextGroup]);
                }}
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
                {saving ? 'Adding…' : 'Add state'}
              </button>
            </SettingsListCell>
          </form>
        ) : null}
        {active.length === 0 ? (
          <SettingsEmptyState
            title="No active states"
            description="Create a state to define the path work follows."
          />
        ) : null}
        <SettingsSortableProvider
          ids={active.map(({ id }) => id)}
          disabled={!canManage || editingId !== null}
          onReorder={(ids) =>
            run(() =>
              reorderTaskStates(props.context, props.workspace.id, ids),
            ).then(() => undefined)
          }
        >
          {active.map((state, index) =>
            editingId === state.id ? (
              <StateEditRow
                key={state.id}
                state={state}
                onCancel={() => setEditingId(null)}
                onSave={async (patch) => {
                  const saved = await run(() =>
                    updateTaskState(
                      props.context,
                      props.workspace.id,
                      state.id,
                      patch,
                    ),
                  );
                  if (saved) setEditingId(null);
                }}
              />
            ) : (
              <SettingsSortableRow
                key={state.id}
                id={state.id}
                index={index}
                label={state.name}
                disabled={!canManage}
              >
                <SettingsListCell className="settings-visual-cell">
                  <ConfigurationSwatch color={state.color} />
                </SettingsListCell>
                <SettingsListCell primary>{state.name}</SettingsListCell>
                <SettingsListCell>
                  {groupLabel(state.state_group)}
                </SettingsListCell>
                <SettingsListCell>
                  {state.id === props.configuration.default_state_id ? (
                    <span className="settings-status-badge is-accent">
                      <CheckCircle2 aria-hidden="true" size={12} /> Inbox
                      default
                    </span>
                  ) : (
                    <span className="settings-status-text">Available</span>
                  )}
                </SettingsListCell>
                <SettingsListCell className="settings-list-actions-cell">
                  {canManage ? (
                    <SettingsActionsMenu label={`Actions for ${state.name}`}>
                      <SettingsAction
                        icon={<Pencil aria-hidden="true" size={14} />}
                        onClick={() => setEditingId(state.id)}
                      >
                        Edit
                      </SettingsAction>
                      {state.id !== props.configuration.default_state_id ? (
                        <SettingsAction
                          icon={<CheckCircle2 aria-hidden="true" size={14} />}
                          onClick={() =>
                            void run(() =>
                              updateTaskDefaults(
                                props.context,
                                props.workspace.id,
                                { state_id: state.id },
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
                        onClick={() => void move(state.id, -1)}
                      >
                        Move up
                      </SettingsAction>
                      <SettingsAction
                        disabled={index === active.length - 1}
                        icon={<ArrowDown aria-hidden="true" size={14} />}
                        onClick={() => void move(state.id, 1)}
                      >
                        Move down
                      </SettingsAction>
                      <SettingsActionSeparator />
                      <SettingsAction
                        disabled={
                          state.id === props.configuration.default_state_id
                        }
                        icon={<Archive aria-hidden="true" size={14} />}
                        onClick={() =>
                          void run(() =>
                            updateTaskState(
                              props.context,
                              props.workspace.id,
                              state.id,
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
                        onClick={() => setDeleteTarget(state)}
                      >
                        Delete
                      </SettingsAction>
                    </SettingsActionsMenu>
                  ) : null}
                </SettingsListCell>
              </SettingsSortableRow>
            ),
          )}
        </SettingsSortableProvider>
      </SettingsList>
      <ArchivedConfigurationList
        ariaLabel="Archived task states"
        canManage={canManage}
        className="state-archive-list"
        items={archived.map((state) => ({
          id: state.id,
          name: state.name,
          detail: groupLabel(state.state_group),
          visual: <ConfigurationSwatch color={state.color} />,
        }))}
        onRestore={(stateId) =>
          run(() =>
            updateTaskState(props.context, props.workspace.id, stateId, {
              archived: false,
            }),
          ).then(() => undefined)
        }
      />
      {!canManage ? (
        <p className="settings-muted">
          Only Workspace Owners and Admins can change task states.
        </p>
      ) : null}
      {deleteTarget ? (
        <ConfigurationDeleteDialog
          entityName={deleteTarget.name}
          entityType="state"
          explanation="Choose a state from the same group for any tasks or defaults that still use this state."
          replacementOptions={[
            { value: '', label: 'No replacement' },
            ...active
              .filter(
                (state) =>
                  state.id !== deleteTarget.id &&
                  state.state_group === deleteTarget.state_group,
              )
              .map((state) => ({ value: state.id, label: state.name })),
          ]}
          onClose={() => setDeleteTarget(null)}
          onDelete={async (replacementId) => {
            await deleteTaskState(
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

function StateEditRow({
  state,
  onCancel,
  onSave,
}: {
  state: TaskState;
  onCancel: () => void;
  onSave: (
    patch: Pick<TaskState, 'name' | 'color' | 'state_group'>,
  ) => Promise<void>;
}) {
  const [name, setName] = useState(state.name);
  const [color, setColor] = useState(state.color);
  const [group, setGroup] = useState(state.state_group);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !name.trim()) return;
    setSaving(true);
    try {
      await onSave({ name: name.trim(), color, state_group: group });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="settings-list-row settings-list-edit-row"
      role="listitem"
      aria-label={`Edit ${state.name}`}
      onSubmit={(event) => void submit(event)}
    >
      <SettingsListCell className="settings-grid-placeholder" />
      <SettingsListCell className="settings-visual-cell">
        <ColorSwatchPicker
          ariaLabel={`Change color for ${state.name}`}
          disabled={saving}
          value={color}
          onChange={setColor}
        />
      </SettingsListCell>
      <SettingsListCell>
        <input
          autoFocus
          aria-label={`${state.name} name`}
          maxLength={120}
          disabled={saving}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </SettingsListCell>
      <SettingsListCell>
        <Select
          ariaLabel={`${state.name} group`}
          disabled={saving}
          value={group}
          options={stateGroupOptions()}
          onValueChange={(value) => setGroup(value as TaskStateGroup)}
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

const STATE_GROUPS: TaskStateGroup[] = [
  'backlog',
  'todo',
  'in_progress',
  'done',
  'canceled',
];

const STATE_GROUP_COLORS: Record<TaskStateGroup, string> = {
  backlog: '#6B7280',
  todo: '#64748B',
  in_progress: '#3B82F6',
  done: '#22C55E',
  canceled: '#6B7280',
};

function stateGroupOptions() {
  return STATE_GROUPS.map((value) => ({ value, label: groupLabel(value) }));
}

function groupLabel(group: TaskStateGroup) {
  return titleCase(group.replace('_', ' '));
}
