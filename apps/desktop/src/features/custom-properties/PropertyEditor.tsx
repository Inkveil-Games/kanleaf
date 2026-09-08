import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Textarea } from '../../components/ui/Textarea';
import { SettingsArticle } from '../settings/SettingsArticle';
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
  onBack: () => void;
  onSaved: () => Promise<void>;
}

export function PropertyEditorPanel(props: PropertyEditorProps) {
  const title = propertyEditorTitle(props);

  return (
    <SettingsArticle
      eyebrow="Workspace"
      title={title}
      description="Add structured information without changing the Task body."
      backAction={{
        label: 'Back to Properties',
        onClick: props.onBack,
      }}
    >
      <PropertyEditorForm {...props} />
    </SettingsArticle>
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
  onBack,
  onSaved,
}: PropertyEditorProps) {
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
    setError(null);
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
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="property-editor-form"
      onSubmit={(event) => void submit(event)}
    >
      <div className="property-editor-fields">
        <FormField label="Name" required>
          <Input
            autoFocus
            required
            maxLength={120}
            disabled={saving}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <FormField
          label="Type"
          hint={property ? 'Type cannot be changed after creation.' : undefined}
        >
          <Select
            ariaLabel="Property type"
            disabled={saving || Boolean(property)}
            value={type}
            options={PROPERTY_TYPES}
            onValueChange={(value) => setType(value as CustomPropertyType)}
          />
        </FormField>
      </div>
      <FormField label="Description">
        <Textarea
          maxLength={500}
          disabled={saving}
          value={description}
          placeholder="What should this property capture?"
          onChange={(event) => setDescription(event.target.value)}
        />
      </FormField>
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
            !name.trim() ||
            (selectType && options.some((option) => !option.name.trim()))
          }
        >
          {property
            ? 'Save changes'
            : defineExisting
              ? 'Define property'
              : 'Create property'}
        </Button>
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
