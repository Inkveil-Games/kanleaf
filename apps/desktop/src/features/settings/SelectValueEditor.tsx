import { Archive, Plus, RotateCcw, Trash2 } from 'lucide-react';
import {
  createElement,
  useState,
  type CSSProperties,
  type RefCallback,
} from 'react';
import { AppDialog } from '../../components/ui/AppDialog';
import { Button } from '../../components/ui/Button';
import { ColorSwatchPicker } from '../../components/ui/ColorSwatchPicker';
import { IconButton } from '../../components/ui/IconButton';
import { IconPicker } from '../../components/ui/IconPicker';
import { Input } from '../../components/ui/Input';
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
import { propertyIcon, propertyIconOptions } from './propertyIcons';

export interface SelectValueDraft {
  key: string;
  id?: string;
  name: string;
  icon: string | null;
  color: string;
  description: string;
  archived?: boolean;
  locked?: boolean;
}

interface SelectValueEditorProps {
  disabled: boolean;
  values: SelectValueDraft[];
  onChange: (values: SelectValueDraft[]) => void;
  showDefault?: boolean;
  defaultValueId?: string | null;
  onDefaultChange?: (id: string | null) => void;
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
  itemLabel = 'value',
  addLabel = 'Add value',
  emptyMessage = 'No values yet. Add the choices people can select.',
}: SelectValueEditorProps) {
  const [deletingValue, setDeletingValue] = useState<SelectValueDraft | null>(
    null,
  );
  const activeValues = values.filter((value) => !value.archived);
  const archivedValues = values.filter((value) => value.archived);
  const label = sentenceCase(itemLabel);

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

  return (
    <fieldset className="select-value-editor" disabled={disabled}>
      <legend>Property values</legend>
      <div
        className={`select-value-editor-header${showDefault ? ' has-default' : ''}`}
        aria-hidden="true"
      >
        <span />
        <span>Icon</span>
        <span>Color</span>
        <span>Name</span>
        <span>Description</span>
        {showDefault ? <span>Default</span> : null}
        <span />
      </div>
      <div className="select-value-editor-list">
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
                  >
                    <SettingsDragHandle
                      ref={handleRef}
                      label={value.name || itemLabel}
                      disabled={sortingDisabled}
                    />
                    <IconPicker
                      allowNone
                      ariaLabel={`Change icon for ${value.name || itemLabel}`}
                      dialogLabel={`${label} icons`}
                      fallbackIcon={propertyIcon(value.icon)}
                      options={propertyIconOptions}
                      value={value.icon}
                      disabled={disabled || Boolean(value.locked)}
                      onChange={(icon) => update(value.key, { icon })}
                    />
                    <ColorSwatchPicker
                      ariaLabel={`Change color for ${value.name || itemLabel}`}
                      disabled={disabled || Boolean(value.locked)}
                      value={value.color}
                      onChange={(color) => update(value.key, { color })}
                    />
                    <Input
                      aria-label={`${label} name`}
                      required
                      maxLength={120}
                      disabled={disabled || Boolean(value.locked)}
                      value={value.name}
                      placeholder={`${label} name`}
                      onChange={(event) =>
                        update(value.key, { name: event.target.value })
                      }
                    />
                    <Input
                      aria-label={`${label} description`}
                      maxLength={500}
                      disabled={disabled}
                      value={value.description}
                      placeholder="Optional description"
                      onChange={(event) =>
                        update(value.key, { description: event.target.value })
                      }
                    />
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
                    {value.locked ? (
                      <span className="select-value-actions-placeholder" />
                    ) : value.id ? (
                      <ValueActions
                        value={value}
                        disabled={disabled}
                        onArchive={() => archive(value)}
                        onDelete={() => setDeletingValue(value)}
                      />
                    ) : (
                      <IconButton
                        variant="ghost"
                        size="sm"
                        type="button"
                        aria-label={`Remove ${value.name || itemLabel}`}
                        disabled={disabled}
                        onClick={() => remove(value)}
                      >
                        <Trash2 aria-hidden="true" size={14} />
                      </IconButton>
                    )}
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
                className="select-value-archived-icon"
                style={{ '--value-color': value.color } as CSSProperties}
                aria-hidden="true"
              >
                {createElement(propertyIcon(value.icon), { size: 16 })}
              </span>
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
                  onClick={() => setDeletingValue(value)}
                >
                  Delete permanently
                </SettingsAction>
              </SettingsActionsMenu>
            </div>
          ))}
        </div>
      ) : null}
      <Button
        className="select-value-add-button"
        variant="text"
        size="sm"
        type="button"
        disabled={disabled}
        onClick={() =>
          onChange([
            ...values,
            {
              key: `new-${crypto.randomUUID()}`,
              name: '',
              icon: null,
              color: '#64748B',
              description: '',
            },
          ])
        }
      >
        <Plus aria-hidden="true" size={14} /> {addLabel}
      </Button>
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

function ValueActions({
  value,
  disabled,
  onArchive,
  onDelete,
}: {
  value: SelectValueDraft;
  disabled: boolean;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <SettingsActionsMenu
      label={`Actions for ${value.name || 'value'}`}
      disabled={disabled}
    >
      <SettingsAction
        icon={<Archive aria-hidden="true" size={14} />}
        onClick={onArchive}
      >
        Archive
      </SettingsAction>
      <SettingsActionSeparator />
      <SettingsAction
        destructive
        icon={<Trash2 aria-hidden="true" size={14} />}
        onClick={onDelete}
      >
        Delete permanently
      </SettingsAction>
    </SettingsActionsMenu>
  );
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
