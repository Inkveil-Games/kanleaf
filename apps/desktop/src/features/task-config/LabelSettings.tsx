import { useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
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
  TaskLabel,
  Workspace,
} from '../workspace/types';
import {
  createTaskLabel,
  deleteTaskLabel,
  reorderTaskLabels,
  updateTaskConfiguration,
  updateTaskLabel,
} from './api';

interface LabelSettingsProps {
  context: ApiContext;
  workspace: Workspace;
  configuration: TaskConfiguration;
  onChanged: () => Promise<void>;
  onBack?: () => void;
}

export function LabelSettings(props: LabelSettingsProps) {
  const canManage =
    props.workspace.role === 'owner' || props.workspace.role === 'admin';
  const [values, setValues] = useState<SelectValueDraft[]>(() =>
    labelDrafts(props.configuration.labels),
  );
  const [description, setDescription] = useState(
    props.configuration.label_property_description ?? '',
  );
  const [defaultLabelIds, setDefaultLabelIds] = useState<string[]>(
    props.configuration.default_label_ids ?? [],
  );
  // Successful writes survive a later failure and must remain the retry baseline.
  const persisted = useRef(props.configuration);
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
      const originalActiveIds = persisted.current.labels
        .filter((label) => !label.archived_at)
        .map((label) => label.id);
      const ids = new Map<string, string>();
      for (const value of values) {
        if (value.id) {
          ids.set(value.key, value.id);
          continue;
        }
        if (value.archived) continue;
        const created = await createTaskLabel(
          props.context,
          props.workspace.id,
          {
            name: value.name.trim(),
            color: value.color,
            description: value.description.trim(),
          },
        );
        ids.set(value.key, created.id);
        persisted.current = {
          ...persisted.current,
          labels: [...persisted.current.labels, created],
        };
        setValues((current) =>
          current.map((draft) =>
            draft.key === value.key ? { ...draft, id: created.id } : draft,
          ),
        );
        setDefaultLabelIds((current) =>
          current.map((id) => (id === value.key ? created.id : id)),
        );
      }

      const currentIds = new Set(ids.values());
      for (const label of persisted.current.labels) {
        if (!currentIds.has(label.id)) {
          await deleteTaskLabel(props.context, props.workspace.id, label.id);
          persisted.current = {
            ...persisted.current,
            labels: persisted.current.labels.filter(
              ({ id }) => id !== label.id,
            ),
            default_label_ids: persisted.current.default_label_ids.filter(
              (id) => id !== label.id,
            ),
          };
        }
      }

      const original = new Map(
        persisted.current.labels.map((label) => [label.id, label]),
      );
      for (const value of values) {
        if (!value.id) continue;
        const label = original.get(value.id);
        if (!label || !labelChanged(label, value)) continue;
        const updated = await updateTaskLabel(
          props.context,
          props.workspace.id,
          value.id,
          labelPatch(label, value),
        );
        persisted.current = {
          ...persisted.current,
          labels: persisted.current.labels.map((label) =>
            label.id === updated.id ? updated : label,
          ),
          default_label_ids: updated.archived_at
            ? persisted.current.default_label_ids.filter(
                (id) => id !== updated.id,
              )
            : persisted.current.default_label_ids,
        };
      }

      const activeIds = values
        .filter((value) => !value.archived)
        .flatMap((value) => {
          const id = ids.get(value.key);
          return id ? [id] : [];
        });
      if (!sameOrder(activeIds, originalActiveIds)) {
        await reorderTaskLabels(props.context, props.workspace.id, activeIds);
        persisted.current = {
          ...persisted.current,
          labels: persisted.current.labels
            .map((label) => {
              const position = activeIds.indexOf(label.id);
              return position < 0 ? label : { ...label, position };
            })
            .sort((left, right) => left.position - right.position),
        };
      }

      const defaults = values
        .filter(
          (value) =>
            !value.archived && defaultLabelIds.includes(value.id ?? value.key),
        )
        .flatMap((value) => {
          const id = ids.get(value.key);
          return id ? [id] : [];
        });
      const patch: Parameters<typeof updateTaskConfiguration>[2] = {};
      if (
        description.trim() !==
        (persisted.current.label_property_description ?? '')
      ) {
        patch.label_property_description = description.trim();
      }
      if (!sameOrder(defaults, persisted.current.default_label_ids ?? [])) {
        patch.default_label_ids = defaults;
      }
      if (Object.keys(patch).length > 0) {
        persisted.current = await updateTaskConfiguration(
          props.context,
          props.workspace.id,
          patch,
        );
      }
      await props.onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsArticle
      className="configuration-settings unified-property-settings"
      eyebrow="Workspace"
      title="Labels"
      description="Create a shared vocabulary for organizing work."
      backAction={
        props.onBack
          ? {
              label: 'Back to Properties',
              onClick: props.onBack,
            }
          : undefined
      }
    >
      <SelectPropertyEditor
        name="Labels"
        nameReadOnly
        typeLabel="Multi select"
        description={description}
        onDescriptionChange={setDescription}
        disabled={!canManage || saving}
        error={error}
        values={
          <SelectValueEditor
            disabled={!canManage || saving}
            values={values}
            showDefault
            defaultValueIds={defaultLabelIds}
            onDefaultsChange={setDefaultLabelIds}
            onChange={setValues}
            itemLabel="value"
            addLabel="Add label"
            emptyMessage="No Labels yet. Add values to organize work across this Workspace."
          />
        }
        footer={
          canManage ? (
            <Button
              variant="primary"
              type="button"
              loading={saving}
              loadingLabel="Saving Labels"
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
          Only Workspace Owners and Admins can change labels.
        </p>
      ) : null}
    </SettingsArticle>
  );
}

function labelDrafts(labels: TaskLabel[]): SelectValueDraft[] {
  return labels.map((label) => ({
    key: label.id,
    id: label.id,
    name: label.name,
    color: label.color,
    description: label.description,
    archived: Boolean(label.archived_at),
  }));
}

function labelChanged(label: TaskLabel, value: SelectValueDraft) {
  return (
    label.name !== value.name.trim() ||
    label.color !== value.color ||
    label.description !== value.description.trim() ||
    Boolean(label.archived_at) !== Boolean(value.archived)
  );
}

function labelPatch(label: TaskLabel, value: SelectValueDraft) {
  const patch: Partial<
    Pick<TaskLabel, 'name' | 'color' | 'description'> & {
      archived: boolean;
    }
  > = {};
  if (label.name !== value.name.trim()) patch.name = value.name.trim();
  if (label.color !== value.color) patch.color = value.color;
  if (label.description !== value.description.trim()) {
    patch.description = value.description.trim();
  }
  if (Boolean(label.archived_at) !== Boolean(value.archived)) {
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
