import { ScrollArea as BaseScrollArea } from '@base-ui/react/scroll-area';
import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
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
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const setViewportRef = useCallback(
      (node: HTMLDivElement | null) => {
        viewportRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      },
      [ref],
    );

    // Base UI measures overflow when it mounts and then only on size changes.
    // A pane laid out after that first pass (its width or height settling in
    // the same frame) can keep a stale "overflowing" state with no further
    // resize to correct it, leaving a scrollbar on content that fits.
    // Re-measuring once after the first paint goes through its own scroll
    // handler.
    useEffect(() => {
      const frame = requestAnimationFrame(() => {
        viewportRef.current?.dispatchEvent(new Event('scroll'));
      });
      return () => cancelAnimationFrame(frame);
    }, []);

    return (
      <BaseScrollArea.Root
        className={`ui-scroll-area${className ? ` ${className}` : ''}`}
        data-orientation={orientation}
      >
        <BaseScrollArea.Viewport
          {...viewportProps}
          ref={setViewportRef}
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
