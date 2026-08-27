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
  placement?: 'down' | 'up';
  className?: string;
}

export function ContextMenu({
  label,
  children,
  placement = 'down',
  className,
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

    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  function menuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
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
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={openFromKeyboard}
      >
        <MoreHorizontal aria-hidden="true" size={16} />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          className="context-menu-popover"
          role="menu"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('button')) setOpen(false);
          }}
          onKeyDown={menuKeyDown}
        >
          {children}
        </div>
      )}
    </div>
  );
}
