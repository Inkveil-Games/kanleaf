import { Check, Plus, Search } from 'lucide-react';
import { useState, type FocusEvent, type ReactNode } from 'react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
} from '../../components/ui/DropdownMenu';
import { Popover, PopoverClose } from '../../components/ui/Popover';
import type {
  ExtendedPropertyKey,
  PropertyKey,
  TaskPropertyDefinition,
} from './taskPropertyModel';

export function AddPropertyMenu({
  properties,
  onSelect,
}: {
  properties: TaskPropertyDefinition[];
  onSelect: (key: ExtendedPropertyKey) => void;
}) {
  return (
    <Popover
      label="Add property"
      className="add-property-menu"
      align="start"
      trigger={
        <span>
          <Plus aria-hidden="true" size={14} /> Add property
        </span>
      }
    >
      <PropertyCatalog properties={properties} onSelect={onSelect} />
    </Popover>
  );
}

function PropertyCatalog({
  properties,
  onSelect,
}: {
  properties: TaskPropertyDefinition[];
  onSelect: (key: ExtendedPropertyKey) => void;
}) {
  const [search, setSearch] = useState('');
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filtered = properties.filter(({ label }) =>
    label.toLocaleLowerCase().includes(normalizedSearch),
  );
  return (
    <div className="property-catalog">
      <label>
        <Search aria-hidden="true" size={14} />
        <span className="sr-only">Search properties</span>
        <input
          autoFocus
          aria-label="Search properties"
          value={search}
          placeholder="Search properties"
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <div className="property-catalog-list">
        {filtered.length === 0 ? (
          <span className="menu-empty-state">
            {properties.length === 0
              ? 'All properties are shown'
              : 'No matching properties'}
          </span>
        ) : (
          filtered.map(({ key, label }) => (
            <PopoverClose
              key={key}
              ariaLabel={`Add ${label} property`}
              onClick={() => onSelect(key)}
            >
              <Plus aria-hidden="true" size={14} /> {label}
            </PopoverClose>
          ))
        )}
      </div>
    </div>
  );
}

export function PropertyRow({
  label,
  propertyKey,
  children,
  onLeaveEmpty,
}: {
  label: string;
  propertyKey: PropertyKey;
  children: ReactNode;
  onLeaveEmpty?: () => void;
}) {
  function blur(event: FocusEvent<HTMLDivElement>) {
    if (!onLeaveEmpty) return;
    const row = event.currentTarget;
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && row.contains(active)) return;
      if (row.querySelector('[aria-expanded="true"]')) return;
      const controls = row.querySelectorAll<HTMLElement>('[aria-controls]');
      if (
        active &&
        [...controls].some((control) => {
          const target = control.getAttribute('aria-controls');
          return target && document.getElementById(target)?.contains(active);
        })
      ) {
        return;
      }
      onLeaveEmpty();
    });
  }
  return (
    <div data-task-property={propertyKey} onBlur={blur}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function MultiValuePicker({
  label,
  emptyLabel,
  readOnly,
  saving,
  values,
  options,
  onChange,
}: {
  label: string;
  emptyLabel: string;
  readOnly: boolean;
  saving: boolean;
  values: string[];
  options: { id: string; label: string }[];
  onChange: (values: string[]) => Promise<void>;
}) {
  const selectedLabels = options
    .filter(({ id }) => values.includes(id))
    .map((option) => option.label);
  const summary =
    selectedLabels.length > 0 ? selectedLabels.join(', ') : emptyLabel;
  if (readOnly)
    return <span className="property-readonly-value">{summary}</span>;
  return (
    <DropdownMenu
      label={label}
      className="property-picker"
      align="start"
      disabled={saving}
      trigger={<span>{summary}</span>}
    >
      {options.length === 0 ? (
        <span className="menu-empty-state">No options available</span>
      ) : (
        options.map((option) => {
          const selected = values.includes(option.id);
          return (
            <DropdownMenuCheckboxItem
              key={option.id}
              checked={selected}
              disabled={saving}
              onCheckedChange={(nextSelected) =>
                void onChange(
                  nextSelected
                    ? [...values, option.id]
                    : values.filter((value) => value !== option.id),
                )
              }
            >
              <Check aria-hidden="true" size={14} opacity={selected ? 1 : 0} />
              {option.label}
            </DropdownMenuCheckboxItem>
          );
        })
      )}
    </DropdownMenu>
  );
}
