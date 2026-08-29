import { Check, ChevronDown } from 'lucide-react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps {
  ariaLabel: string;
  value: string;
  options: SelectOption[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

interface PopoverPosition {
  bottom?: number;
  left: number;
  maxHeight: number;
  top?: number;
  width: number;
}

export function Select({
  ariaLabel,
  value,
  options,
  onValueChange,
  disabled = false,
  className,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const listboxId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;

    const rect = triggerRef.current.getBoundingClientRect();
    const edge = 8;
    const gap = 4;
    const spaceBelow = window.innerHeight - rect.bottom - edge - gap;
    const spaceAbove = rect.top - edge - gap;
    const placeAbove = spaceBelow < 180 && spaceAbove > spaceBelow;
    const available = Math.max(96, placeAbove ? spaceAbove : spaceBelow);
    const width = Math.min(
      Math.max(rect.width, 180),
      window.innerWidth - edge * 2,
    );

    setPortalRoot(triggerRef.current.closest('dialog') ?? document.body);
    setPosition({
      ...(placeAbove
        ? { bottom: window.innerHeight - rect.top + gap }
        : { top: rect.bottom + gap }),
      left: Math.max(
        edge,
        Math.min(rect.left, window.innerWidth - width - edge),
      ),
      maxHeight: Math.min(280, available),
      width,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function closeOutside(event: PointerEvent) {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !listboxRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }

    function closeWithEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }

    function closeAfterViewportChange() {
      setOpen(false);
    }

    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeWithEscape, true);
    window.addEventListener('resize', closeAfterViewportChange);
    window.addEventListener('scroll', closeAfterViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeWithEscape, true);
      window.removeEventListener('resize', closeAfterViewportChange);
      window.removeEventListener('scroll', closeAfterViewportChange, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !position) return;
    const selectedOption = listboxRef.current?.querySelector<HTMLElement>(
      '[role="option"][aria-selected="true"]',
    );
    const firstOption = listboxRef.current?.querySelector<HTMLElement>(
      '[role="option"]:not([aria-disabled="true"])',
    );
    (selectedOption ?? firstOption)?.focus();
  }, [open, position]);

  function openWithKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    setOpen(true);
  }

  function moveOptionFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [
      ...(listboxRef.current?.querySelectorAll<HTMLElement>(
        '[role="option"]:not([aria-disabled="true"])',
      ) ?? []),
    ];
    if (items.length === 0) return;

    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next = 0;
    if (event.key === 'End') next = items.length - 1;
    if (event.key === 'ArrowDown') next = (current + 1) % items.length;
    if (event.key === 'ArrowUp') {
      next = (current - 1 + items.length) % items.length;
    }
    items[next]?.focus();
  }

  function choose(option: SelectOption) {
    if (option.disabled) return;
    onValueChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  const popoverStyle = position
    ? ({
        bottom: position.bottom,
        left: position.left,
        maxHeight: position.maxHeight,
        top: position.top,
        width: position.width,
      } satisfies CSSProperties)
    : undefined;
  return (
    <div className={`kanleaf-select${className ? ` ${className}` : ''}`}>
      <button
        ref={triggerRef}
        className="select-trigger"
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        data-value={value}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={openWithKeyboard}
      >
        <span className="select-value">{selected?.label ?? ''}</span>
        <ChevronDown className="select-chevron" aria-hidden="true" size={14} />
      </button>
      {open &&
        position &&
        portalRoot &&
        createPortal(
          <div
            ref={listboxRef}
            id={listboxId}
            className="select-popover"
            role="listbox"
            aria-label={ariaLabel}
            style={popoverStyle}
            onBlur={(event) => {
              const next = event.relatedTarget as Node | null;
              if (
                !next ||
                (!event.currentTarget.contains(next) &&
                  !triggerRef.current?.contains(next))
              ) {
                setOpen(false);
              }
            }}
            onKeyDown={moveOptionFocus}
          >
            {options.map((option) => (
              <button
                key={option.value}
                className="select-option"
                type="button"
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                disabled={option.disabled}
                onClick={() => choose(option)}
              >
                <span>{option.label}</span>
                {option.value === value && (
                  <Check aria-hidden="true" size={14} />
                )}
              </button>
            ))}
          </div>,
          portalRoot,
        )}
    </div>
  );
}
