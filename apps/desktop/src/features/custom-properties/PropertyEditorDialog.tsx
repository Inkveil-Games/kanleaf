import { useState, type FormEvent } from 'react';
import { AppDialog } from '../../components/ui/AppDialog';
import { Select } from '../../components/ui/Select';
import { errorMessage } from '../settings/utils';
import type { ApiContext } from '../workspace/api';
import type {
  CustomPropertyDefinition,
  CustomPropertyType,
} from '../workspace/types';
import { createProperty, defineProperty, updateProperty } from './api';
import {
  SelectOptionEditor,
  type SelectOptionDraft,
} from './SelectOptionEditor';

const PROPERTY_TYPES: { value: CustomPropertyType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'single_select', label: 'Single select' },
  { value: 'multi_select', label: 'Multi select' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'url', label: 'URL' },
];

interface PropertyEditorProps {
  context: ApiContext;
  workspaceId: string;
  property?: CustomPropertyDefinition;
  initialName?: string;
  defineExisting?: boolean;
  undefinedNames?: string[];
  onDefineExisting?: (name: string) => void;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export function PropertyEditorDialog(props: PropertyEditorProps) {
  const [busy, setBusy] = useState(false);
  const title = propertyEditorTitle(props);

  return (
    <AppDialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      type="custom"
      size="lg"
      title={title}
      description="Add structured information without changing the Task body."
      loading={busy}
    >
      <PropertyEditorForm {...props} onBusyChange={setBusy} />
    </AppDialog>
  );
}

export function PropertyEditorForm({
  context,
  workspaceId,
  property,
  initialName = '',
  defineExisting = false,
  undefinedNames = [],
  onDefineExisting,
  onClose,
  onSaved,
  onBusyChange,
}: PropertyEditorProps & { onBusyChange?: (busy: boolean) => void }) {
  const [name, setName] = useState(property?.name ?? initialName);
  const [description, setDescription] = useState(property?.description ?? '');
  const [type, setType] = useState<CustomPropertyType>(
    property?.type ?? 'text',
  );
  const [options, setOptions] = useState<SelectOptionDraft[]>(() =>
    (property?.options ?? []).map((option) => ({
      key: option.id,
      id: option.id,
      name: option.name,
      color: option.color,
      archived: Boolean(option.archived_at),
    })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectType = type === 'single_select' || type === 'multi_select';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !name.trim()) return;
    const undefinedName = undefinedNames.find(
      (candidate) =>
        candidate.localeCompare(name.trim(), undefined, {
          sensitivity: 'accent',
        }) === 0,
    );
    if (!property && !defineExisting && undefinedName && onDefineExisting) {
      onDefineExisting(undefinedName);
      return;
    }
    setSaving(true);
    onBusyChange?.(true);
    setError(null);
    let saved = false;
    try {
      if (!property) {
        const create = defineExisting ? defineProperty : createProperty;
        await create(context, workspaceId, {
          name: name.trim(),
          type,
          description: description.trim(),
          options: selectType
            ? options.map((option) => ({
                name: option.name.trim(),
                color: option.color,
              }))
            : undefined,
        });
      } else {
        await updateProperty(context, workspaceId, property.id, {
          name: name.trim(),
          description: description.trim(),
          options: selectType
            ? options.map((option) => ({
                id: option.id,
                name: option.name.trim(),
                color: option.color,
                archived: Boolean(option.archived),
              }))
            : undefined,
        });
      }
      await onSaved();
      saved = true;
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
      onBusyChange?.(false);
    }
    if (saved) onClose();
  }

  return (
    <form
      className="property-editor-form"
      onSubmit={(event) => void submit(event)}
    >
      <div className="property-editor-fields">
        <label className="settings-field">
          Name
          <input
            autoFocus
            required
            maxLength={120}
            disabled={saving}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="settings-field">
          Type
          <Select
            ariaLabel="Property type"
            disabled={saving || Boolean(property)}
            value={type}
            options={PROPERTY_TYPES}
            onValueChange={(value) => setType(value as CustomPropertyType)}
          />
          {property ? (
            <small>Type cannot be changed after creation.</small>
          ) : null}
        </label>
      </div>
      <label className="settings-field">
        Description
        <textarea
          maxLength={500}
          disabled={saving}
          value={description}
          placeholder="What should this property capture?"
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      {selectType ? (
        <SelectOptionEditor
          disabled={saving}
          options={options}
          onChange={setOptions}
        />
      ) : null}
      {error ? (
        <p className="settings-error" role="alert">
          {error}
        </p>
      ) : null}
      <footer className="property-editor-actions">
        <button
          className="secondary-button"
          type="button"
          disabled={saving}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          className="primary-button"
          type="submit"
          disabled={
            saving ||
            !name.trim() ||
            (selectType && options.some((option) => !option.name.trim()))
          }
        >
          {saving
            ? 'Saving…'
            : property
              ? 'Save changes'
              : defineExisting
                ? 'Define property'
                : 'Create property'}
        </button>
      </footer>
    </form>
  );
}

function propertyEditorTitle({
  property,
  defineExisting,
  initialName = '',
}: PropertyEditorProps) {
  if (property) return `Edit ${property.name}`;
  if (defineExisting) return `Define ${initialName}`;
  return 'Create property';
}
