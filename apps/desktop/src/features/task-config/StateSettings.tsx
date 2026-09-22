import { useState } from 'react';
import { AppDialog } from '../../components/ui/AppDialog';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Select } from '../../components/ui/Select';
import { SettingsArticle } from '../settings/SettingsArticle';
import { SelectPropertyEditor } from '../settings/SelectPropertyEditor';
import {
  SelectValueEditor,
  type SelectValueDraft,
} from '../settings/SelectValueEditor';
import { errorMessage } from '../settings/utils';
import type { ApiContext } from '../workspace/api';
import type {
  TaskConfiguration,
  TaskState,
  Workspace,
} from '../workspace/types';
import {
  createTaskState,
  deleteTaskState,
  reorderTaskStates,
  updateTaskConfiguration,
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
  const [values, setValues] = useState<SelectValueDraft[]>(() =>
    stateDrafts(props.configuration.states),
  );
  const [description, setDescription] = useState(
    props.configuration.state_property_description ?? '',
  );
  const [defaultStateId, setDefaultStateId] = useState(
    props.configuration.default_state_id,
  );
  const [deleteTarget, setDeleteTarget] = useState<SelectValueDraft | null>(
    null,
  );
  const [replacementId, setReplacementId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (
      saving ||
      values.some((value) => !value.archived && !value.name.trim())
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const ids = new Map<string, string>();
      for (const value of values) {
        if (value.id) {
          ids.set(value.key, value.id);
          continue;
        }
        if (value.archived) continue;
        const created = await createTaskState(
          props.context,
          props.workspace.id,
          {
            name: value.name.trim(),
            icon: value.icon,
            color: value.color,
            description: value.description.trim(),
          },
        );
        ids.set(value.key, created.id);
      }

      const original = new Map(
        props.configuration.states.map((state) => [state.id, state]),
      );
      for (const value of values) {
        if (!value.id) continue;
        const state = original.get(value.id);
        if (!state || !stateChanged(state, value)) continue;
        await updateTaskState(
          props.context,
          props.workspace.id,
          value.id,
          statePatch(state, value),
        );
      }

      const activeIds = values
        .filter((value) => !value.archived)
        .flatMap((value) => {
          const id = ids.get(value.key);
          return id ? [id] : [];
        });
      const originalActiveIds = props.configuration.states
        .filter((state) => !state.archived_at)
        .map((state) => state.id);
      if (!sameOrder(activeIds, originalActiveIds)) {
        await reorderTaskStates(props.context, props.workspace.id, activeIds);
      }

      const nextDefaultId = ids.get(defaultStateId) ?? defaultStateId;
      const configurationPatch: {
        state_id?: string;
        state_property_description?: string;
      } = {};
      if (nextDefaultId !== props.configuration.default_state_id) {
        configurationPatch.state_id = nextDefaultId;
      }
      if (
        description.trim() !==
        (props.configuration.state_property_description ?? '')
      ) {
        configurationPatch.state_property_description = description.trim();
      }
      if (Object.keys(configurationPatch).length > 0) {
        await updateTaskConfiguration(
          props.context,
          props.workspace.id,
          configurationPatch,
        );
      }
      await props.onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function changeDefault(id: string | null) {
    if (!id) return;
    setDefaultStateId(id);
    if (id.startsWith('new-')) return;
    setError(null);
    try {
      await updateTaskConfiguration(props.context, props.workspace.id, {
        state_id: id,
      });
      await props.onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function removeState() {
    if (!deleteTarget?.id) return;
    setError(null);
    try {
      await deleteTaskState(
        props.context,
        props.workspace.id,
        deleteTarget.id,
        replacementId || undefined,
      );
      setValues((current) =>
        current.filter(({ key }) => key !== deleteTarget.key),
      );
      setDeleteTarget(null);
      setReplacementId('');
      await props.onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
      throw caught;
    }
  }

  return (
    <SettingsArticle
      className="configuration-settings unified-property-settings"
      eyebrow="Workspace"
      title="States"
      description="Define the steps work moves through."
    >
      <SelectPropertyEditor
        name="State"
        nameReadOnly
        typeLabel="Single select"
        description={description}
        onDescriptionChange={setDescription}
        disabled={!canManage || saving}
        error={error}
        values={
          <SelectValueEditor
            disabled={!canManage || saving}
            values={values}
            showDefault
            defaultValueId={defaultStateId}
            onDefaultChange={(id) => void changeDefault(id)}
            onChange={setValues}
            onDeleteRequest={setDeleteTarget}
            itemLabel="value"
            addLabel="Add state"
            emptyMessage="No active States. Add a value to define the path work follows."
          />
        }
        footer={
          canManage ? (
            <Button
              variant="primary"
              type="button"
              loading={saving}
              loadingLabel="Saving States"
              disabled={
                saving ||
                values.some((value) => !value.archived && !value.name.trim())
              }
              onClick={() => void save()}
            >
              Save changes
            </Button>
          ) : null
        }
      />
      {!canManage ? (
        <p className="settings-muted">
          Only Workspace Owners and Admins can change task states.
        </p>
      ) : null}
      <AppDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setReplacementId('');
          }
        }}
        type="confirm"
        variant="danger"
        size="md"
        title={`Delete ${deleteTarget?.name ?? 'State'}?`}
        description="Choose any other active State for Tasks or defaults that still use this value."
        confirmLabel="Delete"
        loadingLabel="Deleting…"
        onConfirm={removeState}
      >
        <FormField
          label={`Replacement for ${deleteTarget?.name ?? 'State'}`}
          hint="Used Tasks are moved to this State."
        >
          <Select
            ariaLabel={`Replacement for ${deleteTarget?.name ?? 'State'}`}
            value={replacementId}
            options={[
              { value: '', label: 'No replacement' },
              ...values
                .filter(
                  (value) =>
                    value.id &&
                    !value.archived &&
                    value.key !== deleteTarget?.key,
                )
                .map((value) => ({
                  value: value.id as string,
                  label: value.name,
                })),
            ]}
            onValueChange={setReplacementId}
          />
        </FormField>
      </AppDialog>
    </SettingsArticle>
  );
}

function stateDrafts(states: TaskState[]): SelectValueDraft[] {
  return states.map((state) => ({
    key: state.id,
    id: state.id,
    name: state.name,
    icon: state.icon ?? null,
    color: state.color,
    description: state.description ?? '',
    archived: Boolean(state.archived_at),
    locked: state.system_role != null,
  }));
}

function stateChanged(state: TaskState, value: SelectValueDraft) {
  return (
    state.name !== value.name.trim() ||
    (state.icon ?? null) !== value.icon ||
    state.color !== value.color ||
    (state.description ?? '') !== value.description.trim() ||
    Boolean(state.archived_at) !== Boolean(value.archived)
  );
}

function statePatch(state: TaskState, value: SelectValueDraft) {
  const patch: Partial<
    Pick<TaskState, 'name' | 'icon' | 'color' | 'description'> & {
      archived: boolean;
    }
  > = {};
  if (state.name !== value.name.trim()) patch.name = value.name.trim();
  if ((state.icon ?? null) !== value.icon) patch.icon = value.icon;
  if (state.color !== value.color) patch.color = value.color;
  if ((state.description ?? '') !== value.description.trim()) {
    patch.description = value.description.trim();
  }
  if (Boolean(state.archived_at) !== Boolean(value.archived)) {
    patch.archived = Boolean(value.archived);
  }
  return patch;
}

function sameOrder(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}
