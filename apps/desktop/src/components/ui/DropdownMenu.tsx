import { Menu } from '@base-ui/react/menu';
import { MoreHorizontal } from 'lucide-react';
import {
  useState,
  type AriaAttributes,
  type ReactNode,
  type RefObject,
} from 'react';
import { popupPortalContainer } from './popupPortal';
import { Tooltip } from './Tooltip';

type PopupPlacement = 'down' | 'up' | 'right';

interface DropdownMenuProps {
  label: string;
  children: ReactNode;
  align?: 'start' | 'end';
  disabled?: boolean;
  placement?: PopupPlacement;
  className?: string;
  trigger?: ReactNode;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  triggerAriaCurrent?: AriaAttributes['aria-current'];
  triggerTooltip?: string;
  tooltipDelay?: number;
  sideOffset?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface DropdownMenuItemProps {
  children: ReactNode;
  ariaCurrent?: AriaAttributes['aria-current'];
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
  triggerAriaCurrent,
  triggerTooltip,
  tooltipDelay,
  sideOffset = 4,
  open,
  onOpenChange,
}: DropdownMenuProps) {
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null,
  );
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [internallyControlled] = useState(() => triggerTooltip !== undefined);
  const resolvedOpen =
    open ?? (internallyControlled ? uncontrolledOpen : undefined);
  const isOpen = resolvedOpen === true;
  const handleOpenChange = (nextOpen: boolean) => {
    if (open === undefined && internallyControlled) {
      setUncontrolledOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  };
  const triggerClassName = `context-menu context-menu-${placement}${className ? ` ${className}` : ''}`;
  const positionerClassName = `context-menu-positioner context-menu-${placement}${className ? ` ${className}` : ''}`;
  const menuTrigger = (
    <Menu.Trigger
      ref={(element: HTMLElement | null) => {
        const button = element as HTMLButtonElement | null;
        if (triggerRef) triggerRef.current = button;
        setPortalContainer(popupPortalContainer(button));
      }}
      className="context-menu-trigger"
      aria-current={triggerAriaCurrent}
      aria-label={label}
      onClick={() => {
        if (triggerTooltip && !isOpen) handleOpenChange(true);
      }}
    >
      {trigger ?? <MoreHorizontal aria-hidden="true" size={16} />}
    </Menu.Trigger>
  );

  return (
    <Menu.Root
      disabled={disabled}
      modal={false}
      open={resolvedOpen}
      onOpenChange={handleOpenChange}
    >
      <div className={triggerClassName}>
        {triggerTooltip ? (
          <Tooltip
            label={triggerTooltip}
            placement={placement === 'right' ? 'right' : 'top'}
            delay={tooltipDelay}
            disabled={isOpen}
            trigger={menuTrigger}
          />
        ) : (
          menuTrigger
        )}
      </div>
      <Menu.Portal container={portalContainer}>
        <Menu.Positioner
          className={positionerClassName}
          side={popupSide(placement)}
          align={align}
          sideOffset={sideOffset}
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
  ariaCurrent,
  className,
  disabled,
  onClick,
}: DropdownMenuItemProps) {
  return (
    <Menu.Item
      aria-current={ariaCurrent}
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

function popupSide(placement: PopupPlacement) {
  if (placement === 'up') return 'top';
  if (placement === 'right') return 'right';
  return 'bottom';
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
