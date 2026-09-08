import { Menu } from '@base-ui/react/menu';
import { MoreHorizontal } from 'lucide-react';
import { useState, type ReactNode, type RefObject } from 'react';
import { popupPortalContainer } from './popupPortal';

interface DropdownMenuProps {
  label: string;
  children: ReactNode;
  align?: 'start' | 'end';
  disabled?: boolean;
  placement?: 'down' | 'up';
  className?: string;
  trigger?: ReactNode;
  triggerRef?: RefObject<HTMLButtonElement | null>;
}

interface DropdownMenuItemProps {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick: () => void;
}

interface DropdownMenuCheckboxItemProps {
  checked: boolean;
  children: ReactNode;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export function DropdownMenuSeparator() {
  return <Menu.Separator className="context-menu-separator" />;
}

export function DropdownMenu({
  label,
  children,
  align = 'end',
  disabled = false,
  placement = 'down',
  className,
  trigger,
  triggerRef,
}: DropdownMenuProps) {
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null,
  );
  const triggerClassName = `context-menu context-menu-${placement}${className ? ` ${className}` : ''}`;
  const positionerClassName = `context-menu-positioner context-menu-${placement}${className ? ` ${className}` : ''}`;

  return (
    <Menu.Root disabled={disabled} modal={false}>
      <div className={triggerClassName}>
        <Menu.Trigger
          ref={(element: HTMLElement | null) => {
            const button = element as HTMLButtonElement | null;
            if (triggerRef) triggerRef.current = button;
            setPortalContainer(popupPortalContainer(button));
          }}
          className="context-menu-trigger"
          aria-label={label}
        >
          {trigger ?? <MoreHorizontal aria-hidden="true" size={16} />}
        </Menu.Trigger>
      </div>
      <Menu.Portal container={portalContainer}>
        <Menu.Positioner
          className={positionerClassName}
          side={placement === 'up' ? 'top' : 'bottom'}
          align={align}
          sideOffset={4}
          collisionPadding={8}
        >
          <Menu.Popup className="context-menu-popover">{children}</Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function DropdownMenuItem({
  children,
  className,
  disabled,
  onClick,
}: DropdownMenuItemProps) {
  return (
    <Menu.Item
      className={className}
      disabled={disabled}
      closeOnClick
      nativeButton
      onClick={onClick}
      render={<button type="button" />}
    >
      {children}
    </Menu.Item>
  );
}

export function DropdownMenuCheckboxItem({
  checked,
  children,
  disabled,
  onCheckedChange,
}: DropdownMenuCheckboxItemProps) {
  return (
    <Menu.CheckboxItem
      checked={checked}
      disabled={disabled}
      closeOnClick={false}
      nativeButton
      onCheckedChange={(nextChecked) => onCheckedChange(nextChecked)}
      render={<button type="button" />}
    >
      {children}
    </Menu.CheckboxItem>
  );
}
