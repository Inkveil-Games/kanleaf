const INTERACTION_STRIP_SIZE = 10;
const SCROLL_IDLE_DELAY = 500;
const HOVERING_ATTRIBUTE = 'data-scrollbar-hovering';
const SCROLLING_ATTRIBUTE = 'data-scrollbar-scrolling';

export function installNativeScrollbarReveal(documentRef: Document) {
  const defaultView = documentRef.defaultView;
  if (!defaultView) return () => undefined;
  const windowRef: Window = defaultView;

  let hoveredElement: HTMLElement | null = null;
  const scrollingTimers = new Map<HTMLElement, number>();

  function setHoveredElement(element: HTMLElement | null) {
    if (hoveredElement === element) return;
    hoveredElement?.removeAttribute(HOVERING_ATTRIBUTE);
    hoveredElement = element;
    hoveredElement?.setAttribute(HOVERING_ATTRIBUTE, '');
  }

  function handlePointerMove(event: PointerEvent) {
    if (event.pointerType === 'touch') {
      setHoveredElement(null);
      return;
    }
    const element = closestNativeScrollbar(event.target);
    setHoveredElement(
      element && isOverScrollbarStrip(element, event.clientX, event.clientY)
        ? element
        : null,
    );
  }

  function handlePointerOut(event: PointerEvent) {
    if (event.relatedTarget === null) setHoveredElement(null);
  }

  function handleScroll(event: Event) {
    const element =
      event.target instanceof HTMLElement &&
      event.target.classList.contains('ui-native-scrollbar')
        ? event.target
        : null;
    if (!element) return;

    element.setAttribute(SCROLLING_ATTRIBUTE, '');
    const existingTimer = scrollingTimers.get(element);
    if (existingTimer !== undefined) windowRef.clearTimeout(existingTimer);
    scrollingTimers.set(
      element,
      windowRef.setTimeout(() => {
        element.removeAttribute(SCROLLING_ATTRIBUTE);
        scrollingTimers.delete(element);
      }, SCROLL_IDLE_DELAY),
    );
  }

  documentRef.addEventListener('pointermove', handlePointerMove, true);
  documentRef.addEventListener('pointerout', handlePointerOut, true);
  documentRef.addEventListener('scroll', handleScroll, true);

  return () => {
    documentRef.removeEventListener('pointermove', handlePointerMove, true);
    documentRef.removeEventListener('pointerout', handlePointerOut, true);
    documentRef.removeEventListener('scroll', handleScroll, true);
    setHoveredElement(null);
    for (const [element, timer] of scrollingTimers) {
      windowRef.clearTimeout(timer);
      element.removeAttribute(SCROLLING_ATTRIBUTE);
    }
    scrollingTimers.clear();
  };

  function isOverScrollbarStrip(
    element: HTMLElement,
    clientX: number,
    clientY: number,
  ) {
    const rect = element.getBoundingClientRect();
    const inside =
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom;
    if (!inside) return false;

    const hasVerticalOverflow = element.scrollHeight > element.clientHeight;
    const hasHorizontalOverflow = element.scrollWidth > element.clientWidth;
    const direction = windowRef.getComputedStyle(element).direction;
    const verticalDistance =
      direction === 'rtl' ? clientX - rect.left : rect.right - clientX;

    return (
      (hasVerticalOverflow && verticalDistance <= INTERACTION_STRIP_SIZE) ||
      (hasHorizontalOverflow && rect.bottom - clientY <= INTERACTION_STRIP_SIZE)
    );
  }
}

function closestNativeScrollbar(target: EventTarget | null) {
  return target instanceof Element
    ? target.closest<HTMLElement>('.ui-native-scrollbar')
    : null;
}
