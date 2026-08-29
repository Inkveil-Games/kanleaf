import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PANE_LIMITS, useWorkspacePaneLayout } from './workspacePaneLayout';
import { PaneResizeHandle } from './PaneResizeHandle';

describe('workspace pane layout', () => {
  afterEach(() => vi.unstubAllGlobals());

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
      'data-navigation-visible',
      'false',
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

  it('uses a temporary navigation drawer in narrow windows', () => {
    const media = mockMatchMedia(true);
    render(<LayoutHarness />);

    expect(screen.getByTestId('layout')).toHaveAttribute('data-narrow', 'true');
    expect(screen.getByTestId('layout')).toHaveAttribute(
      'data-navigation-visible',
      'false',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(screen.getByTestId('layout')).toHaveAttribute(
      'data-navigation-visible',
      'true',
    );

    act(() => media.change(false));
    expect(screen.getByTestId('layout')).toHaveAttribute(
      'data-narrow',
      'false',
    );
    expect(screen.getByTestId('layout')).toHaveAttribute(
      'data-navigation-visible',
      'true',
    );
  });
});

function LayoutHarness() {
  const layout = useWorkspacePaneLayout();
  return (
    <div
      data-testid="layout"
      data-narrow={layout.narrow}
      data-navigation-visible={layout.navigationVisible}
      data-navigation-width={layout.navigationWidth}
    >
      <button type="button" onClick={layout.toggleNavigation}>
        {layout.navigationVisible ? 'Collapse navigation' : 'Open navigation'}
      </button>
      <PaneResizeHandle
        label="Resize navigation"
        value={layout.navigationWidth}
        limits={PANE_LIMITS.navigation}
        onChange={layout.setNavigationWidth}
      />
    </div>
  );
}

function ResizeHarness() {
  const [value, setValue] = useState(PANE_LIMITS.collection.defaultValue);
  return (
    <PaneResizeHandle
      label="Resize collection"
      value={value}
      limits={PANE_LIMITS.collection}
      onChange={setValue}
    />
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
