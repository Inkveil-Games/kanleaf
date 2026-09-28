import { fireEvent, render, screen } from '@testing-library/react';
import { createRef, type ComponentPropsWithoutRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ScrollArea } from './ScrollArea';

vi.mock('@base-ui/react/scroll-area', async () => {
  const React = await import('react');
  type PartProps = ComponentPropsWithoutRef<'div'>;
  type ScrollbarProps = PartProps & {
    keepMounted?: boolean;
    orientation?: 'vertical' | 'horizontal';
  };

  return {
    ScrollArea: {
      Root: React.forwardRef<HTMLDivElement, PartProps>(function Root(
        { children, ...props },
        ref,
      ) {
        return (
          <div data-scroll-part="root" ref={ref} {...props}>
            {children}
          </div>
        );
      }),
      Viewport: React.forwardRef<HTMLDivElement, PartProps>(function Viewport(
        { children, ...props },
        ref,
      ) {
        return (
          <div data-scroll-part="viewport" ref={ref} {...props}>
            {children}
          </div>
        );
      }),
      Content: ({ children, ...props }: PartProps) => (
        <div data-scroll-part="content" {...props}>
          {children}
        </div>
      ),
      Scrollbar: ({
        children,
        keepMounted = false,
        orientation = 'vertical',
        ...props
      }: ScrollbarProps) => (
        <div
          data-keep-mounted={String(keepMounted)}
          data-orientation={orientation}
          data-scroll-part="scrollbar"
          {...props}
        >
          {children}
        </div>
      ),
      Thumb: (props: PartProps) => <div data-scroll-part="thumb" {...props} />,
      Corner: (props: PartProps) => (
        <div data-scroll-part="corner" {...props} />
      ),
    },
  };
});

describe('ScrollArea', () => {
  it('forwards viewport semantics, handlers, classes, children, and refs', () => {
    const viewportRef = createRef<HTMLDivElement>();
    const onKeyDown = vi.fn();

    render(
      <ScrollArea
        className="feature-root"
        ref={viewportRef}
        viewportProps={{
          'aria-label': 'Tasks',
          className: 'task-list',
          onKeyDown,
          role: 'listbox',
        }}
      >
        <span>Task one</span>
      </ScrollArea>,
    );

    const root = document.querySelector('[data-scroll-part="root"]');
    const viewport = screen.getByRole('listbox', { name: 'Tasks' });
    expect(root).toHaveClass('ui-scroll-area', 'feature-root');
    expect(root).not.toHaveAttribute('role');
    expect(root).not.toHaveAttribute('aria-label');
    expect(viewport).toHaveClass('ui-scroll-area-viewport', 'task-list');
    expect(viewportRef.current).toBe(viewport);
    expect(
      viewport.querySelector('[data-scroll-part="content"]'),
    ).toHaveTextContent('Task one');

    fireEvent.keyDown(viewport, { key: 'ArrowDown' });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['vertical', ['vertical'], false],
    ['horizontal', ['horizontal'], false],
    ['both', ['vertical', 'horizontal'], true],
  ] as const)(
    'composes only the requested %s scrollbar axes',
    (orientation, expectedAxes, expectsCorner) => {
      const { container } = render(
        <ScrollArea orientation={orientation}>Content</ScrollArea>,
      );

      expect(
        [...container.querySelectorAll('[data-scroll-part="scrollbar"]')].map(
          (scrollbar) => scrollbar.getAttribute('data-orientation'),
        ),
      ).toEqual(expectedAxes);
      expect(
        container.querySelector('[data-scroll-part="corner"]') !== null,
      ).toBe(expectsCorner);
    },
  );

  it('keeps no-overflow scrollbar parts unmounted through Base UI defaults', () => {
    const { container } = render(<ScrollArea>Content</ScrollArea>);

    for (const scrollbar of container.querySelectorAll(
      '[data-scroll-part="scrollbar"]',
    )) {
      expect(scrollbar).toHaveAttribute('data-keep-mounted', 'false');
    }
  });
});
