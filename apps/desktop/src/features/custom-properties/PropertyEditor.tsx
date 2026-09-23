import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Textarea } from '../../components/ui/Textarea';
import { SettingsArticle } from '../settings/SettingsArticle';
import { SelectPropertyEditor } from '../settings/SelectPropertyEditor';
import {
  SelectValueEditor,
  type SelectValueDraft,
} from '../settings/SelectValueEditor';
import { errorMessage } from '../settings/utils';
import type { ApiContext } from '../workspace/api';
import type {
  CustomPropertyDefinition,
  CustomPropertyType,
} from '../workspace/types';
import { createProperty, defineProperty, updateProperty } from './api';

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
  const [options, setOptions] = useState<SelectValueDraft[]>(() =>
    (property?.options ?? []).map((option) => ({
      key: option.id,
      id: option.id,
      name: option.name,
      color: option.color,
      description: option.description ?? '',
      archived: Boolean(option.archived_at),
    })),
  );
  const [defaultOptionId, setDefaultOptionId] = useState<string | null>(
    property?.default_option_id ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectType = type === 'single_select' || type === 'multi_select';
  const showDefault = type === 'single_select';
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
          default_option_id: selectType
            ? showDefault
              ? persistedOptionId(defaultOptionId)
              : null
            : undefined,
          options: selectType
            ? options.map((option) => ({
                id: persistedOptionId(option.id ?? option.key) ?? undefined,
                name: option.name.trim(),
                color: option.color,
                description: option.description.trim(),
              }))
            : undefined,
        });
      } else {
        await updateProperty(context, workspaceId, property.id, {
          name: name.trim(),
          description: description.trim(),
          default_option_id: selectType
            ? showDefault
              ? persistedOptionId(defaultOptionId)
              : null
            : undefined,
          options: selectType
            ? options.map((option) => ({
                id: persistedOptionId(option.id ?? option.key) ?? undefined,
                name: option.name.trim(),
                color: option.color,
                description: option.description.trim(),
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

  const typeControl = (
    <Select
      ariaLabel="Property type"
      disabled={saving || Boolean(property)}
      value={type}
      options={PROPERTY_TYPES}
      onValueChange={(value) => {
        const nextType = value as CustomPropertyType;
        setType(nextType);
        if (nextType !== 'single_select') setDefaultOptionId(null);
      }}
    />
  );
  const footer = (
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
    </>
  );

  return (
    <form
      className="property-editor-form"
      onSubmit={(event) => void submit(event)}
    >
      {selectType ? (
        <SelectPropertyEditor
          name={name}
          nameAutoFocus
          onNameChange={setName}
          typeLabel={
            PROPERTY_TYPES.find(({ value }) => value === type)?.label ?? type
          }
          typeControl={typeControl}
          typeHint={
            property ? 'Type cannot be changed after creation.' : undefined
          }
          description={description}
          onDescriptionChange={setDescription}
          disabled={saving}
          error={error}
          values={
            <SelectValueEditor
              disabled={saving}
              values={options}
              showDefault={showDefault}
              defaultValueId={defaultOptionId}
              onDefaultChange={setDefaultOptionId}
              onChange={setOptions}
              itemLabel="option"
              addLabel="Add option"
            />
          }
          footer={footer}
        />
      ) : (
        <>
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
              hint={
                property ? 'Type cannot be changed after creation.' : undefined
              }
            >
              {typeControl}
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
          {error ? (
            <p className="settings-error" role="alert">
              {error}
            </p>
          ) : null}
          <footer className="property-editor-actions">{footer}</footer>
        </>
      )}
    </form>
  );
}

function persistedOptionId(value: string | null | undefined) {
  if (!value) return null;
  return value.startsWith('new-') ? value.slice(4) : value;
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
