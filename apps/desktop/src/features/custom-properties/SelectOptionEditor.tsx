import { Archive, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { RefCallback } from 'react';
import { ColorSwatchPicker } from '../../components/ui/ColorSwatchPicker';
import {
  SettingsDragHandle,
  SettingsSortableItem,
  SettingsSortableProvider,
} from '../settings/SettingsSortable';
import {
  SettingsAction,
  SettingsActionSeparator,
  SettingsActionsMenu,
} from '../settings/SettingsList';

export interface SelectOptionDraft {
  key: string;
  id?: string;
  name: string;
  color: string;
  archived?: boolean;
}

export function SelectOptionEditor({
  disabled,
  options,
  onChange,
}: {
  disabled: boolean;
  options: SelectOptionDraft[];
  onChange: (options: SelectOptionDraft[]) => void;
}) {
  const activeOptions = options.filter((option) => !option.archived);
  const archivedOptions = options.filter((option) => option.archived);

  function update(key: string, patch: Partial<SelectOptionDraft>) {
    onChange(
      options.map((option) =>
        option.key === key ? { ...option, ...patch } : option,
      ),
    );
  }

  return (
    <fieldset className="select-option-editor" disabled={disabled}>
      <legend>Options</legend>
      <div className="select-option-editor-list">
        {activeOptions.length === 0 ? (
          <p>No options yet. Add the choices people can select.</p>
        ) : (
          <SettingsSortableProvider
            ids={activeOptions.map(({ key }) => key)}
            disabled={disabled}
            onReorder={(ids) =>
              onChange([
                ...optionsInOrder(activeOptions, ids),
                ...archivedOptions,
              ])
            }
          >
            {activeOptions.map((option, index) => (
              <SettingsSortableItem
                key={option.key}
                id={option.key}
                index={index}
                disabled={disabled}
              >
                {({ ref, handleRef, isDragging, sortingDisabled }) => (
                  <div
                    ref={ref as RefCallback<HTMLDivElement>}
                    className={`select-option-editor-row${isDragging ? ' is-dragging' : ''}`}
                  >
                    <SettingsDragHandle
                      ref={handleRef}
                      label={option.name || 'option'}
                      disabled={sortingDisabled}
                    />
                    <ColorSwatchPicker
                      ariaLabel={`Change color for ${option.name || 'option'}`}
                      disabled={disabled}
                      value={option.color}
                      onChange={(color) => update(option.key, { color })}
                    />
                    <input
                      aria-label="Option name"
                      required
                      maxLength={120}
                      disabled={disabled}
                      value={option.name}
                      placeholder="Option name"
                      onChange={(event) =>
                        update(option.key, { name: event.target.value })
                      }
                    />
                    {option.id ? (
                      <OptionActions
                        option={option}
                        disabled={disabled}
                        onArchive={() => update(option.key, { archived: true })}
                        onDelete={() => deleteOption(options, option, onChange)}
                      />
                    ) : (
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`Remove ${option.name || 'option'}`}
                        disabled={disabled}
                        onClick={() =>
                          onChange(
                            options.filter(({ key }) => key !== option.key),
                          )
                        }
                      >
                        <Trash2 aria-hidden="true" size={14} />
                      </button>
                    )}
                  </div>
                )}
              </SettingsSortableItem>
            ))}
          </SettingsSortableProvider>
        )}
      </div>
      {archivedOptions.length > 0 ? (
        <div className="select-option-archive">
          <strong>Archived options</strong>
          {archivedOptions.map((option) => (
            <div className="select-option-archived-row" key={option.key}>
              <span
                className="settings-color-dot"
                style={{ backgroundColor: option.color }}
                aria-hidden="true"
              />
              <span>{option.name}</span>
              <SettingsActionsMenu
                label={`Actions for ${option.name || 'option'}`}
                disabled={disabled}
              >
                <SettingsAction
                  icon={<RotateCcw aria-hidden="true" size={14} />}
                  onClick={() => update(option.key, { archived: false })}
                >
                  Restore
                </SettingsAction>
                <SettingsActionSeparator />
                <SettingsAction
                  destructive
                  icon={<Trash2 aria-hidden="true" size={14} />}
                  onClick={() => deleteOption(options, option, onChange)}
                >
                  Delete permanently
                </SettingsAction>
              </SettingsActionsMenu>
            </div>
          ))}
        </div>
      ) : null}
      <button
        className="text-button option-add-button"
        type="button"
        disabled={disabled}
        onClick={() =>
          onChange([
            ...options,
            {
              key: `new-${crypto.randomUUID()}`,
              name: '',
              color: '#64748B',
            },
          ])
        }
      >
        <Plus aria-hidden="true" size={14} /> Add option
      </button>
    </fieldset>
  );
}

function OptionActions({
  option,
  disabled,
  onArchive,
  onDelete,
}: {
  option: SelectOptionDraft;
  disabled: boolean;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <SettingsActionsMenu
      label={`Actions for ${option.name || 'option'}`}
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

function deleteOption(
  options: SelectOptionDraft[],
  option: SelectOptionDraft,
  onChange: (options: SelectOptionDraft[]) => void,
) {
  if (
    option.id &&
    !window.confirm(
      `Delete ${option.name || 'this option'}? It will be removed from every Task when you save.`,
    )
  ) {
    return;
  }
  onChange(options.filter(({ key }) => key !== option.key));
}

function optionsInOrder(options: SelectOptionDraft[], ids: string[]) {
  const byId = new Map(options.map((option) => [option.key, option]));
  return ids.flatMap((id) => {
    const option = byId.get(id);
    return option ? [option] : [];
  });
}
