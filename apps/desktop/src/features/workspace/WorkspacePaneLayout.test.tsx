import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState, type CSSProperties } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PANE_LIMITS, useWorkspacePaneLayout } from './workspacePaneLayout';
import { PaneResizeHandle } from './PaneResizeHandle';

describe('workspace pane layout', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('innerWidth', 1280);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('persists pane widths and the desktop navigation preference', () => {
    mockMatchMedia(false);
    const { unmount } = render(<LayoutHarness />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Collapse navigation' }),
    );
    fireEvent.keyDown(
      screen.getByRole('separator', { name: 'Resize navigation' }),
      { key: 'End' },
    );

    expect(screen.getByTestId('layout')).toHaveAttribute(
      'data-navigation-width',
      String(PANE_LIMITS.navigation.max),
    );
    expect(screen.getByTestId('layout')).toHaveAttribute(
      'data-navigation-mode',
      'rail',
    );

    unmount();
    render(<LayoutHarness />);
    expect(screen.getByTestId('layout')).toHaveAttribute(
      'data-navigation-width',
      String(PANE_LIMITS.navigation.max),
    );
    expect(
      screen.getByRole('button', { name: 'Open navigation' }),
    ).toBeVisible();
  });

  it('ignores an obsolete stored detail width without losing other preferences', () => {
    localStorage.setItem(
      'kanleaf.workspace-pane-layout',
      JSON.stringify({
        navigationWidth: 280,
        collectionWidth: 480,
        detailWidth: 440,
        navigationCollapsed: true,
      }),
    );
    mockMatchMedia(false);

    render(<LayoutHarness />);

    expect(screen.getByTestId('layout')).toHaveAttribute(
      'data-navigation-width',
      '280',
    );
    expect(screen.getByTestId('layout')).toHaveAttribute(
      'data-collection-width',
      '480',
    );
    expect(screen.getByTestId('layout')).toHaveAttribute(
      'data-task-detail-drawer-width',
      '742',
    );
    expect(
      JSON.parse(localStorage.getItem('kanleaf.workspace-pane-layout') ?? '{}'),
    ).toEqual({
      navigationWidth: 280,
      collectionWidth: 480,
      navigationCollapsed: true,
    });
  });

  it('persists a Task Detail drawer width and resets to the responsive default', () => {
    mockMatchMedia(false);
    const setItem = vi.spyOn(localStorage, 'setItem');
    const { unmount } = render(<LayoutHarness />);
    const layout = screen.getByTestId('layout');
    const separator = screen.getByRole('separator', {
      name: 'Resize task detail',
    });
    const writesBeforeDrag = setItem.mock.calls.length;

    expect(layout).toHaveAttribute('data-task-detail-drawer-width', '742');
    expect(separator).toHaveAttribute('aria-valuemax', '894');

    fireEvent.pointerDown(separator, { button: 0, clientX: 600 });
    fireEvent.pointerMove(window, { clientX: 550 });
    fireEvent.pointerMove(window, { clientX: 500 });

    expect(layout.style.getPropertyValue('--task-detail-drawer-width')).toBe(
      '842px',
    );
    expect(layout).toHaveAttribute('data-task-detail-drawer-width', '742');
    expect(setItem).toHaveBeenCalledTimes(writesBeforeDrag);

    fireEvent.pointerUp(window);
    expect(layout).toHaveAttribute('data-task-detail-drawer-width', '842');
    expect(setItem).toHaveBeenCalledTimes(writesBeforeDrag + 1);
    expect(
      JSON.parse(localStorage.getItem('kanleaf.workspace-pane-layout') ?? '{}'),
    ).toMatchObject({ taskDetailDrawerWidth: 842 });

    unmount();
    render(<LayoutHarness />);
    const restoredSeparator = screen.getByRole('separator', {
      name: 'Resize task detail',
    });
    expect(screen.getByTestId('layout')).toHaveAttribute(
      'data-task-detail-drawer-width',
      '842',
    );

    fireEvent.doubleClick(restoredSeparator);
    expect(screen.getByTestId('layout')).toHaveAttribute(
      'data-task-detail-drawer-width',
      '742',
    );
    expect(
      JSON.parse(localStorage.getItem('kanleaf.workspace-pane-layout') ?? '{}'),
    ).not.toHaveProperty('taskDetailDrawerWidth');
  });

  it('keeps inverted pointer and keyboard resizing directionally consistent', () => {
    mockMatchMedia(false);
    render(<LayoutHarness />);
    const separator = screen.getByRole('separator', {
      name: 'Resize task detail',
    });

    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(separator).toHaveAttribute('aria-valuenow', '750');

    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator).toHaveAttribute('aria-valuenow', '742');

    fireEvent.keyDown(separator, { key: 'Home' });
    expect(separator).toHaveAttribute('aria-valuenow', '894');

    fireEvent.keyDown(separator, { key: 'End' });
    expect(separator).toHaveAttribute('aria-valuenow', '560');
  });

  it('temporarily clamps a persisted drawer width without overwriting it', () => {
    localStorage.setItem(
      'kanleaf.workspace-pane-layout',
      JSON.stringify({
        navigationWidth: 280,
        collectionWidth: 480,
        taskDetailDrawerWidth: 1000,
        navigationCollapsed: false,
      }),
    );
    mockMatchMedia(false);
    render(<LayoutHarness />);

    expect(screen.getByTestId('layout')).toHaveAttribute(
      'data-task-detail-drawer-width',
      '840',
    );
    expect(
      JSON.parse(localStorage.getItem('kanleaf.workspace-pane-layout') ?? '{}'),
    ).toMatchObject({ taskDetailDrawerWidth: 1000 });

    vi.stubGlobal('innerWidth', 1600);
    fireEvent(window, new Event('resize'));

    expect(screen.getByTestId('layout')).toHaveAttribute(
      'data-task-detail-drawer-width',
      '1000',
    );
  });

  it('supports pointer and keyboard resizing with constrained values', () => {
    render(<ResizeHarness />);
    const separator = screen.getByRole('separator', {
      name: 'Resize collection',
    });

    fireEvent.pointerDown(separator, { button: 0, clientX: 400 });
    fireEvent.pointerMove(window, { clientX: 472 });
    fireEvent.pointerUp(window);
    expect(separator).toHaveAttribute('aria-valuenow', '432');

    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(separator).toHaveAttribute('aria-valuenow', '424');

    fireEvent.keyDown(separator, { key: 'Home' });
    expect(separator).toHaveAttribute(
      'aria-valuenow',
      String(PANE_LIMITS.collection.min),
    );

    fireEvent.doubleClick(separator);
    expect(separator).toHaveAttribute(
      'aria-valuenow',
      String(PANE_LIMITS.collection.defaultValue),
    );
  });

  it('updates the CSS width during pointer movement and commits only once', () => {
    const rendered = vi.fn();
    render(<ResizeHarness onRender={rendered} />);
    const separator = screen.getByRole('separator', {
      name: 'Resize collection',
    });
    const layout = screen.getByTestId('resize-layout');

    fireEvent.pointerDown(separator, { button: 0, clientX: 400 });
    fireEvent.pointerMove(window, { clientX: 420 });
    fireEvent.pointerMove(window, { clientX: 440 });
    fireEvent.pointerMove(window, { clientX: 472 });

    expect(layout.style.getPropertyValue('--collection-pane-width')).toBe(
      '432px',
    );
    expect(screen.getByTestId('committed-width')).toHaveTextContent('360');
    expect(separator).toHaveAttribute('aria-valuenow', '432');
    expect(rendered).toHaveBeenCalledOnce();

    fireEvent.pointerUp(window);

    expect(screen.getByTestId('committed-width')).toHaveTextContent('432');
    expect(rendered).toHaveBeenCalledTimes(2);
  });

  it('does not persist a pane width for every pointer movement', () => {
    mockMatchMedia(false);
    const setItem = vi.spyOn(localStorage, 'setItem');
    render(<LayoutHarness />);
    const storedBeforeDrag = localStorage.getItem(
      'kanleaf.workspace-pane-layout',
    );
    const writesBeforeDrag = setItem.mock.calls.length;
    const separator = screen.getByRole('separator', {
      name: 'Resize navigation',
    });

    fireEvent.pointerDown(separator, { button: 0, clientX: 226 });
    fireEvent.pointerMove(window, { clientX: 240 });
    fireEvent.pointerMove(window, { clientX: 260 });
    fireEvent.pointerMove(window, { clientX: 280 });

    expect(localStorage.getItem('kanleaf.workspace-pane-layout')).toBe(
      storedBeforeDrag,
    );
    expect(setItem).toHaveBeenCalledTimes(writesBeforeDrag);

    fireEvent.pointerUp(window);
    expect(setItem).toHaveBeenCalledTimes(writesBeforeDrag + 1);
    expect(localStorage.getItem('kanleaf.workspace-pane-layout')).toContain(
      '"navigationWidth":280',
    );
  });

  it('commits the latest width when a pointer drag is interrupted', () => {
    render(<ResizeHarness />);
    const separator = screen.getByRole('separator', {
      name: 'Resize collection',
    });

    fireEvent.pointerDown(separator, { button: 0, clientX: 400 });
    fireEvent.pointerMove(window, { clientX: 440 });
    fireEvent.pointerCancel(window);
    expect(screen.getByTestId('committed-width')).toHaveTextContent('400');

    fireEvent.pointerDown(separator, { button: 0, clientX: 400 });
    fireEvent.pointerMove(window, { clientX: 424 });
    fireEvent.lostPointerCapture(separator);
    expect(screen.getByTestId('committed-width')).toHaveTextContent('424');
  });

  it('ignores pointer events from a different pointer', () => {
    render(<ResizeHarness />);
    const separator = screen.getByRole('separator', {
      name: 'Resize collection',
    });
    const layout = screen.getByTestId('resize-layout');

    fireEvent.pointerDown(separator, {
      button: 0,
      clientX: 400,
      pointerId: 7,
    });
    fireEvent.pointerMove(window, { clientX: 500, pointerId: 8 });
    fireEvent.pointerUp(window, { pointerId: 8 });

    expect(layout.style.getPropertyValue('--collection-pane-width')).toBe(
      '360px',
    );
    expect(screen.getByTestId('committed-width')).toHaveTextContent('360');

    fireEvent.pointerMove(window, { clientX: 424, pointerId: 7 });
    fireEvent.pointerUp(window, { pointerId: 7 });
    expect(screen.getByTestId('committed-width')).toHaveTextContent('384');
  });

  it('restores the committed width when the handle unmounts mid-drag', () => {
    render(<ResizeHarness />);
    const separator = screen.getByRole('separator', {
      name: 'Resize collection',
    });
    const layout = screen.getByTestId('resize-layout');

    fireEvent.pointerDown(separator, {
      button: 0,
      clientX: 400,
      pointerId: 7,
    });
    fireEvent.pointerMove(window, { clientX: 440, pointerId: 7 });
    expect(layout.style.getPropertyValue('--collection-pane-width')).toBe(
      '400px',
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove resize handle' }),
    );

    expect(layout.style.getPropertyValue('--collection-pane-width')).toBe(
      '360px',
    );
    expect(screen.getByTestId('committed-width')).toHaveTextContent('360');
    fireEvent.pointerUp(window, { pointerId: 7 });
    expect(screen.getByTestId('committed-width')).toHaveTextContent('360');
  });

  it('derives expanded, rail, and drawer modes without persisting the drawer', () => {
    const media = mockMatchMedia(true);
    render(<LayoutHarness />);

    expect(screen.getByTestId('layout')).toHaveAttribute('data-narrow', 'true');
    expect(screen.getByTestId('layout')).toHaveAttribute(
      'data-navigation-mode',
      'rail',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(screen.getByTestId('layout')).toHaveAttribute(
      'data-navigation-mode',
      'drawer',
    );

    act(() => media.change(false));
    expect(screen.getByTestId('layout')).toHaveAttribute(
      'data-narrow',
      'false',
    );
    expect(screen.getByTestId('layout')).toHaveAttribute(
      'data-navigation-mode',
      'expanded',
    );

    act(() => media.change(true));
    expect(screen.getByTestId('layout')).toHaveAttribute(
      'data-navigation-mode',
      'rail',
    );
  });

  it('preserves the collapsed desktop preference across narrow mode', () => {
    const media = mockMatchMedia(false);
    render(<LayoutHarness />);

    expect(screen.getByTestId('layout')).toHaveAttribute(
      'data-navigation-mode',
      'expanded',
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Collapse navigation' }),
    );
    expect(screen.getByTestId('layout')).toHaveAttribute(
      'data-navigation-mode',
      'rail',
    );

    act(() => media.change(true));
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(screen.getByTestId('layout')).toHaveAttribute(
      'data-navigation-mode',
      'drawer',
    );

    act(() => media.change(false));
    expect(screen.getByTestId('layout')).toHaveAttribute(
      'data-navigation-mode',
      'rail',
    );
  });
});

function LayoutHarness() {
  const layout = useWorkspacePaneLayout();
  const layoutRef = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={layoutRef}
      data-testid="layout"
      data-narrow={layout.narrow}
      data-navigation-mode={layout.navigationMode}
      data-navigation-width={layout.navigationWidth}
      data-collection-width={layout.collectionWidth}
      data-task-detail-drawer-width={layout.taskDetailDrawerWidth}
      style={
        {
          '--navigation-pane-width': `${layout.navigationWidth}px`,
          '--task-detail-drawer-width': `${layout.taskDetailDrawerWidth}px`,
        } as CSSProperties
      }
    >
      <button type="button" onClick={layout.toggleNavigation}>
        {layout.navigationMode === 'rail'
          ? 'Open navigation'
          : layout.navigationMode === 'drawer'
            ? 'Close navigation'
            : 'Collapse navigation'}
      </button>
      <PaneResizeHandle
        label="Resize navigation"
        value={layout.navigationWidth}
        limits={PANE_LIMITS.navigation}
        resizeTarget={layoutRef}
        resizeProperty="--navigation-pane-width"
        onChange={layout.setNavigationWidth}
      />
      <PaneResizeHandle
        label="Resize task detail"
        value={layout.taskDetailDrawerWidth}
        limits={layout.taskDetailDrawerLimits}
        inverted
        resizeTarget={layoutRef}
        resizeProperty="--task-detail-drawer-width"
        onChange={layout.setTaskDetailDrawerWidth}
        onReset={layout.resetTaskDetailDrawerWidth}
      />
    </div>
  );
}

function ResizeHarness({
  onRender = () => undefined,
}: {
  onRender?: () => void;
}) {
  const [value, setValue] = useState(PANE_LIMITS.collection.defaultValue);
  const [handleVisible, setHandleVisible] = useState(true);
  const layoutRef = useRef<HTMLDivElement>(null);
  onRender();
  return (
    <div
      ref={layoutRef}
      data-testid="resize-layout"
      style={{ '--collection-pane-width': `${value}px` } as CSSProperties}
    >
      <output data-testid="committed-width">{value}</output>
      <button type="button" onClick={() => setHandleVisible(false)}>
        Remove resize handle
      </button>
      {handleVisible && (
        <PaneResizeHandle
          label="Resize collection"
          value={value}
          limits={PANE_LIMITS.collection}
          resizeTarget={layoutRef}
          resizeProperty="--collection-pane-width"
          onChange={setValue}
        />
      )}
    </div>
  );
}

function mockMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const media = {
    get matches() {
      return matches;
    },
    media: '(max-width: 1080px)',
    onchange: null,
    addEventListener(
      _type: string,
      listener: EventListenerOrEventListenerObject,
    ) {
      listeners.add(listener);
    },
    removeEventListener(
      _type: string,
      listener: EventListenerOrEventListenerObject,
    ) {
      listeners.delete(listener);
    },
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
    change(next: boolean) {
      matches = next;
      const event = { matches: next, media: this.media } as MediaQueryListEvent;
      listeners.forEach((listener) => {
        if (typeof listener === 'function') listener(event);
        else listener.handleEvent(event);
      });
    },
  } satisfies MediaQueryList & { change: (next: boolean) => void };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => media),
  );
  return media;
}
