import { useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { InlineAlert } from '../../components/ui/InlineAlert';
import { DateDefaultEditor } from '../settings/DateDefaultEditor';
import { isDateDefaultComplete } from '../settings/dateDefault';
import { SettingsArticle } from '../settings/SettingsArticle';
import { SelectPropertyEditor } from '../settings/SelectPropertyEditor';
import {
  SelectValueEditor,
  type SelectValueDraft,
} from '../settings/SelectValueEditor';
import { errorMessage } from '../settings/utils';
import { updateTaskConfiguration } from '../task-config/api';
import { TASK_PRIORITY_OPTIONS } from '../task/taskPropertyModel';
import { PriorityIcon, StateIcon } from '../task/TaskValueIcon';
import type { ApiContext } from '../workspace/api';
import type {
  DateDefault,
  TaskConfiguration,
  TaskPriority,
  Workspace,
} from '../workspace/types';
import type { BuiltInProperty } from './builtInProperties';

export function BuiltInPropertyDetails({
  context,
  workspace,
  property,
  typeLabel,
  configuration,
  onBack,
  onChanged,
  refreshError,
  onRetryConfiguration,
}: {
  context: ApiContext;
  workspace: Workspace;
  property: BuiltInProperty;
  typeLabel: string;
  configuration: TaskConfiguration;
  onBack: () => void;
  onChanged: () => Promise<void>;
  refreshError?: Error | null;
  onRetryConfiguration?: () => void;
}) {
  const canManage = workspace.role === 'owner' || workspace.role === 'admin';
  const [description, setDescription] = useState(
    property.key === 'state'
      ? configuration.state_property_description
      : property.description,
  );
  const [defaultStateId, setDefaultStateId] = useState(
    configuration.default_state_id,
  );
  const [defaultPriority, setDefaultPriority] = useState(
    configuration.default_priority,
  );
  const [defaultDate, setDefaultDate] = useState<DateDefault | null>(
    property.key === 'start-date'
      ? configuration.default_start_date
      : configuration.default_due_date,
  );
  const persisted = useRef(configuration);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dateProperty = property.type === 'date';
  const disabled = !canManage || saving;
  const values: SelectValueDraft[] =
    property.key === 'state'
      ? configuration.states.map((state) => ({
          key: state.id,
          id: state.id,
          name: state.name,
          description: state.description,
          color: state.color,
          archived: Boolean(state.archived_at),
        }))
      : TASK_PRIORITY_OPTIONS.map((priority) => ({
          key: priority.value,
          id: priority.value,
          name: priority.label,
          description: priority.description,
          color: '',
        }));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || (dateProperty && !isDateDefaultComplete(defaultDate)))
      return;
    setSaving(true);
    setError(null);
    try {
      const patch: Parameters<typeof updateTaskConfiguration>[2] = {};
      if (property.key === 'state') {
        if (defaultStateId !== persisted.current.default_state_id)
          patch.state_id = defaultStateId;
        if (description.trim() !== persisted.current.state_property_description)
          patch.state_property_description = description.trim();
      } else if (property.key === 'priority') {
        if (defaultPriority !== persisted.current.default_priority)
          patch.default_priority = defaultPriority;
      } else {
        const field =
          property.key === 'start-date'
            ? 'default_start_date'
            : 'default_due_date';
        if (
          JSON.stringify(defaultDate) !==
          JSON.stringify(persisted.current[field])
        )
          patch[field] = defaultDate;
      }
      if (Object.keys(patch).length > 0) {
        persisted.current = await updateTaskConfiguration(
          context,
          workspace.id,
          patch,
        );
      }
      await onChanged();
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
      title={property.name}
      description="Set the default for new Tasks in this Workspace."
      backAction={{ label: 'Back to Properties', onClick: onBack }}
    >
      {refreshError ? (
        <InlineAlert
          variant="danger"
          action={
            onRetryConfiguration
              ? {
                  label: 'Retry configuration',
                  onClick: onRetryConfiguration,
                }
              : undefined
          }
        >
          Could not refresh this setting. {errorMessage(refreshError)}
        </InlineAlert>
      ) : null}
      <form
        className="property-editor-form"
        onSubmit={(event) => void save(event)}
      >
        <SelectPropertyEditor
          name={property.name}
          nameReadOnly
          typeLabel={typeLabel}
          description={description}
          descriptionReadOnly={property.key !== 'state' || !canManage}
          onDescriptionChange={setDescription}
          disabled={disabled}
          error={error}
          values={
            dateProperty ? (
              <DateDefaultEditor
                value={defaultDate}
                onChange={setDefaultDate}
                disabled={disabled}
              />
            ) : (
              <>
                <SelectValueEditor
                  disabled={disabled}
                  fixedVocabulary
                  values={values}
                  onChange={() => {}}
                  showDefault
                  defaultValueId={
                    property.key === 'state' ? defaultStateId : defaultPriority
                  }
                  onDefaultChange={(id) => {
                    if (!id) return;
                    if (property.key === 'state') setDefaultStateId(id);
                    else setDefaultPriority(id as TaskPriority);
                  }}
                  renderVisual={(value) => {
                    if (property.key === 'priority')
                      return (
                        <PriorityIcon
                          priority={value.key as TaskPriority}
                          size={18}
                        />
                      );
                    const state = configuration.states.find(
                      ({ id }) => id === value.key,
                    );
                    return state ? (
                      <StateIcon role={state.system_role} size={18} />
                    ) : null;
                  }}
                />
                {property.key === 'state' ? (
                  <p className="settings-muted">
                    Applies to Inbox Tasks. Projects keep their own default
                    State.
                  </p>
                ) : null}
              </>
            )
          }
          footer={
            canManage ? (
              <>
                <Button
                  variant="secondary"
                  type="button"
                  disabled={saving}
                  onClick={onBack}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  type="submit"
                  loading={saving}
                  loadingLabel="Saving property"
                  disabled={
                    saving ||
                    (dateProperty && !isDateDefaultComplete(defaultDate))
                  }
                >
                  Save changes
                </Button>
              </>
            ) : null
          }
        />
      </form>
    </SettingsArticle>
  );
}
