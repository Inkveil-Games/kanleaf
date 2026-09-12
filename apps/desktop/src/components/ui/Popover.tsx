import { Popover as BasePopover } from '@base-ui/react/popover';
import { MoreHorizontal } from 'lucide-react';
import {
  useState,
  type AriaAttributes,
  type MouseEventHandler,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { popupPortalContainer } from './popupPortal';
import { Tooltip } from './Tooltip';

type PopupPlacement = 'down' | 'up' | 'right';

interface PopoverProps {
  label: string;
  contentLabel?: string;
  children: ReactNode;
  align?: 'start' | 'end';
  disabled?: boolean;
  placement?: PopupPlacement;
  className?: string;
  trigger?: ReactNode;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  sideOffset?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerTooltip?: string;
  tooltipDelay?: number;
}

interface PopoverCloseProps {
  children: ReactNode;
  ariaCurrent?: AriaAttributes['aria-current'];
  ariaLabel?: string;
  ariaPressed?: boolean;
  className?: string;
  disabled?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  render?: ReactElement;
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
  triggerTooltip,
  tooltipDelay,
}: PopoverProps) {
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
  const popoverTrigger = (
    <BasePopover.Trigger
      ref={(element: HTMLElement | null) => {
        const button = element as HTMLButtonElement | null;
        if (triggerRef) triggerRef.current = button;
        setPortalContainer(popupPortalContainer(button));
      }}
      className="context-menu-trigger"
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        if (triggerTooltip && !isOpen) handleOpenChange(true);
      }}
    >
      {trigger ?? <MoreHorizontal aria-hidden="true" size={16} />}
    </BasePopover.Trigger>
  );

  return (
    <BasePopover.Root
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
            trigger={popoverTrigger}
          />
        ) : (
          popoverTrigger
        )}
      </div>
      <BasePopover.Portal container={portalContainer}>
        <BasePopover.Positioner
          className={positionerClassName}
          side={popupSide(placement)}
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

function popupSide(placement: PopupPlacement) {
  if (placement === 'up') return 'top';
  if (placement === 'right') return 'right';
  return 'bottom';
}

export function PopoverClose({
  children,
  ariaCurrent,
  ariaLabel,
  ariaPressed,
  className,
  disabled,
  onClick,
  render,
}: PopoverCloseProps) {
  return (
    <BasePopover.Close
      aria-current={ariaCurrent}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      className={className}
      disabled={disabled}
      onClick={onClick}
      render={render}
    >
      {children}
    </BasePopover.Close>
  );
}
