import { X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
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

export function PropertyEditorDialog({
  context,
  workspaceId,
  property,
  initialName = '',
  defineExisting = false,
  undefinedNames = [],
  onDefineExisting,
  onClose,
  onSaved,
}: {
  context: ApiContext;
  workspaceId: string;
  property?: CustomPropertyDefinition;
  initialName?: string;
  defineExisting?: boolean;
  undefinedNames?: string[];
  onDefineExisting?: (name: string) => void;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
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
  const title = property
    ? `Edit ${property.name}`
    : defineExisting
      ? `Define ${initialName}`
      : 'Create property';

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    return () => {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    };
  }, []);

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
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="configuration-dialog property-editor-dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <form onSubmit={(event) => void submit(event)}>
        <header>
          <div>
            <span className="dialog-step-label">Task property</span>
            <h2>{title}</h2>
            <p>Add structured information without changing the Task body.</p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close property editor"
            disabled={saving}
            onClick={onClose}
          >
            <X aria-hidden="true" size={16} />
          </button>
        </header>
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
        <footer>
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
    </dialog>
  );
}
