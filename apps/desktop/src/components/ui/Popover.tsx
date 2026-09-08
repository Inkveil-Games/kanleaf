import { Popover as BasePopover } from '@base-ui/react/popover';
import { MoreHorizontal } from 'lucide-react';
import {
  useState,
  type AriaAttributes,
  type MouseEventHandler,
  type ReactNode,
  type RefObject,
} from 'react';
import { popupPortalContainer } from './popupPortal';

interface PopoverProps {
  label: string;
  contentLabel?: string;
  children: ReactNode;
  align?: 'start' | 'end';
  disabled?: boolean;
  placement?: 'down' | 'up';
  className?: string;
  trigger?: ReactNode;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  sideOffset?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface PopoverCloseProps {
  children: ReactNode;
  ariaCurrent?: AriaAttributes['aria-current'];
  ariaLabel?: string;
  ariaPressed?: boolean;
  className?: string;
  disabled?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
}

export function Popover({
  label,
  contentLabel,
  children,
  align = 'end',
  disabled = false,
  placement = 'down',
  className,
  trigger,
  triggerRef,
  sideOffset = 4,
  open,
  onOpenChange,
}: PopoverProps) {
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null,
  );
  const triggerClassName = `context-menu context-menu-${placement}${className ? ` ${className}` : ''}`;
  const positionerClassName = `context-menu-positioner context-menu-${placement}${className ? ` ${className}` : ''}`;

  return (
    <BasePopover.Root modal={false} open={open} onOpenChange={onOpenChange}>
      <div className={triggerClassName}>
        <BasePopover.Trigger
          ref={(element: HTMLElement | null) => {
            const button = element as HTMLButtonElement | null;
            if (triggerRef) triggerRef.current = button;
            setPortalContainer(popupPortalContainer(button));
          }}
          className="context-menu-trigger"
          aria-label={label}
          disabled={disabled}
        >
          {trigger ?? <MoreHorizontal aria-hidden="true" size={16} />}
        </BasePopover.Trigger>
      </div>
      <BasePopover.Portal container={portalContainer}>
        <BasePopover.Positioner
          className={positionerClassName}
          side={placement === 'up' ? 'top' : 'bottom'}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={8}
        >
          <BasePopover.Popup className="context-menu-popover">
            <BasePopover.Title className="sr-only">
              {contentLabel ?? label}
            </BasePopover.Title>
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}

export function PopoverClose({
  children,
  ariaCurrent,
  ariaLabel,
  ariaPressed,
  className,
  disabled,
  onClick,
}: PopoverCloseProps) {
  return (
    <BasePopover.Close
      aria-current={ariaCurrent}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      className={className}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </BasePopover.Close>
  );
}
