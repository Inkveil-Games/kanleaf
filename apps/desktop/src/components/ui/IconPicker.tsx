import { Search, type LucideIcon } from 'lucide-react';
import {
  createElement,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Popover } from './Popover';

export interface IconPickerOption {
  key: string;
  label: string;
  group: string;
  icon: LucideIcon;
}

interface IconPickerProps {
  ariaLabel: string;
  dialogLabel: string;
  fallbackIcon: LucideIcon;
  options: IconPickerOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  iconSize?: number;
}

export function IconPicker({
  ariaLabel,
  dialogLabel,
  fallbackIcon,
  options,
  value,
  onChange,
  className,
  disabled = false,
  iconSize = 18,
}: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      normalizedQuery
        ? options.filter(({ key, label }) =>
            `${label} ${key}`.toLowerCase().includes(normalizedQuery),
          )
        : options,
    [normalizedQuery, options],
  );
  const groups = useMemo(
    () => [...new Set(matches.map(({ group }) => group))],
    [matches],
  );
  const selectedIcon =
    options.find((option) => option.key === value)?.icon ?? fallbackIcon;

  function moveIconFocus(event: KeyboardEvent<HTMLButtonElement>) {
    const buttons = Array.from(
      contentRef.current?.querySelectorAll<HTMLButtonElement>(
        '.icon-picker-grid button',
      ) ?? [],
    );
    const index = buttons.indexOf(event.currentTarget);
    if (index < 0) return;
    const grid = event.currentTarget.closest('.icon-picker-grid');
    const measuredColumns = grid
      ? getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean)
          .length
      : 0;
    const columns = measuredColumns || 6;
    const offsets: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -columns,
      ArrowDown: columns,
    };
    let nextIndex = index + (offsets[event.key] ?? 0);
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = buttons.length - 1;
    if (
      !(event.key in offsets) &&
      event.key !== 'Home' &&
      event.key !== 'End'
    ) {
      return;
    }
    event.preventDefault();
    buttons[Math.max(0, Math.min(buttons.length - 1, nextIndex))]?.focus();
  }

  return (
    <Popover
      className={`icon-picker${className ? ` ${className}` : ''}`}
      label={ariaLabel}
      contentLabel={dialogLabel}
      align="start"
      disabled={disabled}
      open={open}
      triggerRef={triggerRef}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setQuery('');
          triggerRef.current?.focus();
        }
      }}
      trigger={
        <span className="icon-picker-trigger">
          {createElement(selectedIcon, {
            'aria-hidden': true,
            size: iconSize,
            strokeWidth: 1.8,
          })}
        </span>
      }
    >
      <div className="icon-picker-popover" ref={contentRef}>
        <label className="icon-picker-search">
          <Search aria-hidden="true" size={14} />
          <span className="sr-only">Search icons</span>
          <input
            autoFocus
            type="search"
            aria-label="Search icons"
            placeholder="Search icons"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown') return;
              event.preventDefault();
              contentRef.current
                ?.querySelector<HTMLButtonElement>('.icon-picker-grid button')
                ?.focus();
            }}
          />
        </label>
        <div className="icon-picker-results">
          {groups.map((group) => (
            <section key={group} aria-labelledby={`icons-${slugId(group)}`}>
              <h3 id={`icons-${slugId(group)}`}>{group}</h3>
              <div className="icon-picker-grid">
                {matches
                  .filter((option) => option.group === group)
                  .map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      aria-label={option.label}
                      aria-pressed={option.key === value}
                      title={option.label}
                      onKeyDown={moveIconFocus}
                      onClick={() => {
                        onChange(option.key);
                        setOpen(false);
                      }}
                    >
                      <option.icon aria-hidden="true" size={18} />
                    </button>
                  ))}
              </div>
            </section>
          ))}
          {matches.length === 0 ? <p>No matching icons</p> : null}
        </div>
      </div>
    </Popover>
  );
}

function slugId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}
