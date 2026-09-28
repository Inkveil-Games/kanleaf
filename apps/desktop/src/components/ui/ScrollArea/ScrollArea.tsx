import { ScrollArea as BaseScrollArea } from '@base-ui/react/scroll-area';
import { forwardRef, type ReactNode } from 'react';
import './ScrollArea.css';

export type ScrollAreaOrientation = 'vertical' | 'horizontal' | 'both';

export interface ScrollAreaProps {
  children: ReactNode;
  className?: string;
  orientation?: ScrollAreaOrientation;
  viewportProps?: BaseScrollArea.Viewport.Props;
}

export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(
  function ScrollArea(
    { children, className, orientation = 'both', viewportProps },
    ref,
  ) {
    const vertical = orientation !== 'horizontal';
    const horizontal = orientation !== 'vertical';

    return (
      <BaseScrollArea.Root
        className={`ui-scroll-area${className ? ` ${className}` : ''}`}
        data-orientation={orientation}
      >
        <BaseScrollArea.Viewport
          {...viewportProps}
          ref={ref}
          className={mergeViewportClassName(viewportProps?.className)}
        >
          <BaseScrollArea.Content
            className="ui-scroll-area-content"
            style={{
              minWidth: vertical && !horizontal ? '100%' : 'fit-content',
            }}
          >
            {children}
          </BaseScrollArea.Content>
        </BaseScrollArea.Viewport>
        {vertical && (
          <BaseScrollArea.Scrollbar className="ui-scroll-area-scrollbar">
            <BaseScrollArea.Thumb className="ui-scroll-area-thumb" />
          </BaseScrollArea.Scrollbar>
        )}
        {horizontal && (
          <BaseScrollArea.Scrollbar
            className="ui-scroll-area-scrollbar"
            orientation="horizontal"
          >
            <BaseScrollArea.Thumb className="ui-scroll-area-thumb" />
          </BaseScrollArea.Scrollbar>
        )}
        {orientation === 'both' && (
          <BaseScrollArea.Corner className="ui-scroll-area-corner" />
        )}
      </BaseScrollArea.Root>
    );
  },
);

function mergeViewportClassName(
  className: BaseScrollArea.Viewport.Props['className'],
): BaseScrollArea.Viewport.Props['className'] {
  if (typeof className === 'function') {
    return (state) =>
      joinClassNames('ui-scroll-area-viewport', className(state));
  }
  return joinClassNames('ui-scroll-area-viewport', className);
}

function joinClassNames(...classNames: Array<string | undefined>) {
  return classNames.filter(Boolean).join(' ');
}
