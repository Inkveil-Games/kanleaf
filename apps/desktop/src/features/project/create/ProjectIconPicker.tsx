import { Search } from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { ProjectIconGlyph } from '../ProjectIconGlyph';
import { projectIconOptions } from '../projectIcons';

interface ProjectIconPickerProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function ProjectIconPicker({
  value,
  onChange,
  disabled = false,
}: ProjectIconPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized
      ? projectIconOptions.filter(({ key, label }) =>
          `${label} ${key}`.toLowerCase().includes(normalized),
        )
      : projectIconOptions;
  }, [query]);

  function close(restoreFocus: boolean) {
    setOpen(false);
    setQuery('');
    if (restoreFocus) triggerRef.current?.focus();
  }

  function moveIconFocus(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const buttons = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>(
        '.project-icon-grid button',
      ) ?? [],
    );
    const index = buttons.indexOf(event.currentTarget);
    if (index < 0) return;
    const grid = event.currentTarget.closest('.project-icon-grid');
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

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();

    function closeOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
        triggerRef.current?.focus();
      }
    }
    function closeWithEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setQuery('');
      triggerRef.current?.focus();
    }
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeWithEscape, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeWithEscape, true);
    };
  }, [open]);

  return (
    <div className="project-icon-picker" ref={rootRef}>
      <button
        ref={triggerRef}
        className="project-icon-trigger"
        type="button"
        aria-label="Choose Project icon"
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <ProjectIconGlyph
          name={value}
          aria-hidden="true"
          size={24}
          strokeWidth={1.8}
        />
      </button>
      {open ? (
        <div
          className="project-icon-popover"
          role="dialog"
          aria-label="Project icons"
        >
          <label className="project-icon-search">
            <Search aria-hidden="true" size={14} />
            <span className="sr-only">Search icons</span>
            <input
              ref={searchRef}
              type="search"
              placeholder="Search icons"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowDown') return;
                event.preventDefault();
                rootRef.current
                  ?.querySelector<HTMLButtonElement>(
                    '.project-icon-grid button',
                  )
                  ?.focus();
              }}
            />
          </label>
          <div className="project-icon-results">
            {(
              [
                'General',
                'Product',
                'Engineering',
                'Creative',
                'Growth',
              ] as const
            ).map((group) => {
              const options = matches.filter(
                (option) => option.group === group,
              );
              if (options.length === 0) return null;
              return (
                <section key={group} aria-labelledby={`project-icons-${group}`}>
                  <h3 id={`project-icons-${group}`}>{group}</h3>
                  <div className="project-icon-grid">
                    {options.map((option) => {
                      const Icon = option.icon;
                      return (
                        <button
                          key={option.key}
                          type="button"
                          aria-label={option.label}
                          aria-pressed={option.key === value}
                          title={option.label}
                          onKeyDown={moveIconFocus}
                          onClick={() => {
                            onChange(option.key);
                            close(true);
                          }}
                        >
                          <Icon aria-hidden="true" size={18} />
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
            {matches.length === 0 ? <p>No matching icons</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
