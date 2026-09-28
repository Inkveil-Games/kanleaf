import { afterEach, describe, expect, it, vi } from 'vitest';
import { installNativeScrollbarReveal } from './nativeScrollbarReveal';

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('installNativeScrollbarReveal', () => {
  it('marks only the native scrollbar interaction strip as hovered', () => {
    const element = scrollableElement();
    const horizontal = scrollableElement('horizontal');
    const uninstall = installNativeScrollbarReveal(document);

    element.dispatchEvent(pointerMove(50, 50));
    expect(element).not.toHaveAttribute('data-scrollbar-hovering');

    element.dispatchEvent(pointerMove(96, 50));
    expect(element).toHaveAttribute('data-scrollbar-hovering');

    element.dispatchEvent(pointerMove(50, 50));
    expect(element).not.toHaveAttribute('data-scrollbar-hovering');

    horizontal.dispatchEvent(pointerMove(50, 96));
    expect(horizontal).toHaveAttribute('data-scrollbar-hovering');

    uninstall();
  });

  it('marks native scrolling as active until the idle delay elapses', () => {
    vi.useFakeTimers();
    const element = scrollableElement();
    const uninstall = installNativeScrollbarReveal(document);

    element.dispatchEvent(new Event('scroll'));
    expect(element).toHaveAttribute('data-scrollbar-scrolling');

    vi.advanceTimersByTime(499);
    expect(element).toHaveAttribute('data-scrollbar-scrolling');
    vi.advanceTimersByTime(1);
    expect(element).not.toHaveAttribute('data-scrollbar-scrolling');

    uninstall();
  });
});

function scrollableElement(axis: 'vertical' | 'horizontal' = 'vertical') {
  const element = document.createElement('div');
  element.className = 'ui-native-scrollbar';
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: 100 },
    clientWidth: { configurable: true, value: 100 },
    scrollHeight: {
      configurable: true,
      value: axis === 'vertical' ? 300 : 100,
    },
    scrollWidth: {
      configurable: true,
      value: axis === 'horizontal' ? 300 : 100,
    },
  });
  element.getBoundingClientRect = () =>
    ({
      bottom: 100,
      height: 100,
      left: 0,
      right: 100,
      top: 0,
      width: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  document.body.append(element);
  return element;
}

function pointerMove(clientX: number, clientY: number) {
  const event = new MouseEvent('pointermove', {
    bubbles: true,
    clientX,
    clientY,
  });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  return event;
}
