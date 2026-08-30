import { MoreHorizontal } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

interface ContextMenuProps {
  label: string;
  children: ReactNode;
  disabled?: boolean;
  placement?: 'down' | 'up';
  className?: string;
  trigger?: ReactNode;
  popoverRole?: 'menu' | 'dialog';
}

export function ContextMenu({
  label,
  children,
  disabled = false,
  placement = 'down',
  className,
  trigger,
  popoverRole = 'menu',
}: ContextMenuProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function closeOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function closeWithEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeWithEscape, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeWithEscape, true);
    };
  }, [open]);

  function menuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = [...(menuRef.current?.querySelectorAll('button') ?? [])];
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const offset = event.key === 'ArrowDown' ? 1 : -1;
    const next = (current + offset + items.length) % items.length;
    items[next]?.focus();
  }

  function openFromKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    setOpen(true);
    requestAnimationFrame(() =>
      menuRef.current?.querySelector('button')?.focus(),
    );
  }

  return (
    <div
      ref={rootRef}
      className={`context-menu context-menu-${placement}${className ? ` ${className}` : ''}`}
      data-open={open ? 'true' : undefined}
    >
      <button
        ref={triggerRef}
        className="context-menu-trigger"
        type="button"
        aria-label={label}
        aria-haspopup={popoverRole}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={openFromKeyboard}
      >
        {trigger ?? <MoreHorizontal aria-hidden="true" size={16} />}
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          className="context-menu-popover"
          role={popoverRole}
          aria-label={popoverRole === 'dialog' ? label : undefined}
          onClick={(event) => {
            const button = (event.target as HTMLElement).closest('button');
            if (button && !button.hasAttribute('data-menu-keep-open')) {
              setOpen(false);
            }
          }}
          onKeyDown={menuKeyDown}
        >
          {children}
        </div>
      )}
    </div>
  );
}
