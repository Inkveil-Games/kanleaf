import { Archive, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { useState, type CSSProperties, type RefCallback } from 'react';
import { AppDialog } from '../../components/ui/AppDialog';
import { Button } from '../../components/ui/Button';
import { ColorSwatchPicker } from '../../components/ui/ColorSwatchPicker';
import { FormField } from '../../components/ui/FormField';
import { IconButton } from '../../components/ui/IconButton';
import { Input } from '../../components/ui/Input';
import { Popover } from '../../components/ui/Popover';
import { Textarea } from '../../components/ui/Textarea';
import {
  SettingsDragHandle,
  SettingsSortableItem,
  SettingsSortableProvider,
} from './SettingsSortable';
import {
  SettingsAction,
  SettingsActionSeparator,
  SettingsActionsMenu,
} from './SettingsList';

export interface SelectValueDraft {
  key: string;
  id?: string;
  name: string;
  color: string;
  description: string;
  archived?: boolean;
}

interface SelectValueEditorProps {
  disabled: boolean;
  values: SelectValueDraft[];
  onChange: (values: SelectValueDraft[]) => void;
  showDefault?: boolean;
  defaultValueId?: string | null;
  onDefaultChange?: (id: string | null) => void;
  onDeleteRequest?: (value: SelectValueDraft) => void;
  itemLabel?: string;
  addLabel?: string;
  emptyMessage?: string;
}

export function SelectValueEditor({
  disabled,
  values,
  onChange,
  showDefault = false,
  defaultValueId = null,
  onDefaultChange,
  onDeleteRequest,
  itemLabel = 'value',
  addLabel = 'Add value',
  emptyMessage = 'No values yet. Add the choices people can select.',
}: SelectValueEditorProps) {
  const [deletingValue, setDeletingValue] = useState<SelectValueDraft | null>(
    null,
  );
  const activeValues = values.filter((value) => !value.archived);
  const archivedValues = values.filter((value) => value.archived);

  function update(key: string, patch: Partial<SelectValueDraft>) {
    onChange(
      values.map((value) =>
        value.key === key ? { ...value, ...patch } : value,
      ),
    );
  }

  function remove(value: SelectValueDraft) {
    onChange(values.filter(({ key }) => key !== value.key));
    if (defaultValueId === valueIdentity(value)) onDefaultChange?.(null);
  }

  function archive(value: SelectValueDraft) {
    update(value.key, { archived: true });
    if (defaultValueId === valueIdentity(value)) onDefaultChange?.(null);
  }

  function requestDelete(value: SelectValueDraft) {
    if (onDeleteRequest) onDeleteRequest(value);
    else setDeletingValue(value);
  }

  function saveValue(nextValue: SelectValueDraft) {
    const existing = values.some(({ key }) => key === nextValue.key);
    onChange(
      existing
        ? values.map((value) =>
            value.key === nextValue.key ? nextValue : value,
          )
        : [...values, nextValue],
    );
  }

  return (
    <fieldset className="select-value-editor" disabled={disabled}>
      <legend>Property values</legend>
      <ValueEditorPopover
        addLabel={addLabel}
        disabled={disabled}
        itemLabel={itemLabel}
        showDefault={showDefault}
        isDefault={false}
        onSave={saveValue}
        onDefaultChange={onDefaultChange}
      />
      <div
        className={`select-value-editor-header${showDefault ? ' has-default' : ''}`}
        aria-hidden="true"
      >
        <span />
        <span>Color</span>
        <span>Name</span>
        <span>Description</span>
        {showDefault ? <span>Default</span> : null}
        <span />
      </div>
      <div className="select-value-editor-list" role="list">
        {activeValues.length === 0 ? (
          <p>{emptyMessage}</p>
        ) : (
          <SettingsSortableProvider
            ids={activeValues.map(({ key }) => key)}
            disabled={disabled}
            onReorder={(ids) =>
              onChange([...valuesInOrder(activeValues, ids), ...archivedValues])
            }
          >
            {activeValues.map((value, index) => (
              <SettingsSortableItem
                key={value.key}
                id={value.key}
                index={index}
                disabled={disabled}
              >
                {({ ref, handleRef, isDragging, sortingDisabled }) => (
                  <div
                    ref={ref as RefCallback<HTMLDivElement>}
                    className={`select-value-editor-row${showDefault ? ' has-default' : ''}${isDragging ? ' is-dragging' : ''}`}
                    role="listitem"
                  >
                    <SettingsDragHandle
                      ref={handleRef}
                      label={value.name || itemLabel}
                      disabled={sortingDisabled}
                    />
                    <span
                      className="select-value-color"
                      style={{ '--value-color': value.color } as CSSProperties}
                      aria-hidden="true"
                    />
                    <strong className="select-value-name">{value.name}</strong>
                    <span className="select-value-description">
                      {value.description || '—'}
                    </span>
                    {showDefault ? (
                      <label
                        className="select-value-default"
                        title={`Use ${value.name || itemLabel} as default`}
                      >
                        <input
                          type="radio"
                          name="select-value-default"
                          aria-label={`Use ${value.name || itemLabel} as default`}
                          checked={defaultValueId === valueIdentity(value)}
                          disabled={disabled}
                          onChange={() =>
                            onDefaultChange?.(valueIdentity(value))
                          }
                        />
                      </label>
                    ) : null}
                    <ValueEditorPopover
                      addLabel={addLabel}
                      disabled={disabled}
                      itemLabel={itemLabel}
                      value={value}
                      showDefault={showDefault}
                      isDefault={defaultValueId === valueIdentity(value)}
                      onSave={saveValue}
                      onDefaultChange={onDefaultChange}
                      onArchive={!value.id ? undefined : () => archive(value)}
                      onDelete={() =>
                        value.id ? requestDelete(value) : remove(value)
                      }
                    />
                  </div>
                )}
              </SettingsSortableItem>
            ))}
          </SettingsSortableProvider>
        )}
      </div>
      {archivedValues.length > 0 ? (
        <div className="select-value-archive">
          <strong>Archived values</strong>
          {archivedValues.map((value) => (
            <div className="select-value-archived-row" key={value.key}>
              <span
                className="select-value-color"
                style={{ '--value-color': value.color } as CSSProperties}
                aria-hidden="true"
              />
              <span>{value.name}</span>
              <span>{value.description}</span>
              <SettingsActionsMenu
                label={`Actions for ${value.name || itemLabel}`}
                disabled={disabled}
              >
                <SettingsAction
                  icon={<RotateCcw aria-hidden="true" size={14} />}
                  onClick={() => update(value.key, { archived: false })}
                >
                  Restore
                </SettingsAction>
                <SettingsActionSeparator />
                <SettingsAction
                  destructive
                  icon={<Trash2 aria-hidden="true" size={14} />}
                  onClick={() => requestDelete(value)}
                >
                  Delete permanently
                </SettingsAction>
              </SettingsActionsMenu>
            </div>
          ))}
        </div>
      ) : null}
      <AppDialog
        open={deletingValue !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingValue(null);
        }}
        type="confirm"
        variant="danger"
        title={`Delete ${deletingValue?.name || `this ${itemLabel}`}?`}
        description={`It will be removed from every Task when you save the property.`}
        confirmLabel={`Delete ${itemLabel}`}
        onConfirm={() => {
          if (deletingValue) remove(deletingValue);
        }}
      />
    </fieldset>
  );
}

function ValueEditorPopover({
  addLabel,
  disabled,
  itemLabel,
  value,
  showDefault,
  isDefault,
  onSave,
  onDefaultChange,
  onArchive,
  onDelete,
}: {
  addLabel: string;
  disabled: boolean;
  itemLabel: string;
  value?: SelectValueDraft;
  showDefault: boolean;
  isDefault: boolean;
  onSave: (value: SelectValueDraft) => void;
  onDefaultChange?: (id: string | null) => void;
  onArchive?: () => void;
  onDelete?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<SelectValueDraft>(() =>
    value ? { ...value } : newValueDraft(),
  );
  const [setAsDefault, setSetAsDefault] = useState(isDefault);
  const label = sentenceCase(itemLabel);
  const title = value ? `Edit ${value.name || itemLabel}` : addLabel;

  function update(patch: Partial<SelectValueDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function save() {
    if (!draft.name.trim()) return;
    onSave(draft);
    if (showDefault && setAsDefault !== isDefault) {
      onDefaultChange?.(setAsDefault ? valueIdentity(draft) : null);
    }
    setOpen(false);
  }

  return (
    <Popover
      className={`select-value-popover ${value ? 'select-value-edit-popover' : 'select-value-add-popover'}`}
      label={title}
      contentLabel={title}
      align="end"
      disabled={disabled}
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          setDraft(value ? { ...value } : newValueDraft());
          setSetAsDefault(isDefault);
        }
      }}
      trigger={
        value ? (
          <Pencil aria-hidden="true" size={15} />
        ) : (
          <span className="select-value-add-trigger">
            <Plus aria-hidden="true" size={15} />
            {addLabel}
          </span>
        )
      }
    >
      <div className="select-value-popover-form">
        <header className="select-value-popover-header">
          <h3>{title}</h3>
          <IconButton
            aria-label="Close editor"
            type="button"
            onClick={() => setOpen(false)}
          >
            <X aria-hidden="true" size={15} />
          </IconButton>
        </header>
        <div className="select-value-popover-body">
          <div className="select-value-visual-fields">
            <div>
              <span>Color</span>
              <ColorSwatchPicker
                ariaLabel={`Change color for ${draft.name || itemLabel}`}
                value={draft.color}
                onChange={(color) => update({ color })}
              />
            </div>
          </div>
          <FormField label="Name" required>
            <Input
              autoFocus
              aria-label={`${label} name`}
              required
              maxLength={120}
              value={draft.name}
              placeholder={`${label} name`}
              onChange={(event) => update({ name: event.target.value })}
            />
          </FormField>
          <FormField label="Description">
            <Textarea
              aria-label={`${label} description`}
              maxLength={500}
              value={draft.description}
              placeholder="Optional description"
              onChange={(event) => update({ description: event.target.value })}
            />
          </FormField>
          {showDefault ? (
            <label className="select-value-default-control">
              <input
                type="checkbox"
                checked={setAsDefault}
                onChange={(event) => setSetAsDefault(event.target.checked)}
              />
              <span>Set as default</span>
            </label>
          ) : null}
        </div>
        <footer className="select-value-popover-footer">
          <div className="select-value-popover-destructive">
            {onArchive ? (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => {
                  setOpen(false);
                  onArchive();
                }}
              >
                <Archive aria-hidden="true" size={14} /> Archive
              </Button>
            ) : null}
            {onDelete ? (
              <Button
                className="select-value-delete-button"
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => {
                  setOpen(false);
                  onDelete();
                }}
              >
                <Trash2 aria-hidden="true" size={14} />
                {value?.id ? 'Delete permanently' : 'Remove value'}
              </Button>
            ) : null}
          </div>
          <div className="select-value-popover-actions">
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="button"
              disabled={!draft.name.trim()}
              onClick={save}
            >
              {value ? 'Save value' : addLabel}
            </Button>
          </div>
        </footer>
      </div>
    </Popover>
  );
}

function newValueDraft(): SelectValueDraft {
  return {
    key: `new-${crypto.randomUUID()}`,
    name: '',
    color: '#64748B',
    description: '',
  };
}

function valuesInOrder(values: SelectValueDraft[], ids: string[]) {
  const byId = new Map(values.map((value) => [value.key, value]));
  return ids.flatMap((id) => {
    const value = byId.get(id);
    return value ? [value] : [];
  });
}

function sentenceCase(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function valueIdentity(value: SelectValueDraft) {
  return value.id ?? value.key;
}
