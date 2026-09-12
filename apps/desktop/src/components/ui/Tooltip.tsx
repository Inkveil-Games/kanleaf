import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import { useState, type ReactElement } from 'react';
import { popupPortalContainer } from './popupPortal';

interface TooltipProps {
  label: string;
  trigger: ReactElement;
  placement?: 'top' | 'right' | 'bottom' | 'left';
  sideOffset?: number;
  delay?: number;
  disabled?: boolean;
  closeOnClick?: boolean;
}

export function Tooltip({
  label,
  trigger,
  placement = 'top',
  sideOffset = 7,
  delay,
  disabled = false,
  closeOnClick = true,
}: TooltipProps) {
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null,
  );

  return (
    <BaseTooltip.Root disabled={disabled}>
      <BaseTooltip.Trigger
        ref={(element: HTMLElement | null) =>
          setPortalContainer(popupPortalContainer(element))
        }
        render={trigger}
        delay={delay}
        closeOnClick={closeOnClick}
      />
      <BaseTooltip.Portal container={portalContainer}>
        <BaseTooltip.Positioner
          className="ui-tooltip-positioner"
          side={placement}
          sideOffset={sideOffset}
          collisionPadding={8}
        >
          <BaseTooltip.Popup className="ui-tooltip-popup" role="tooltip">
            {label}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
