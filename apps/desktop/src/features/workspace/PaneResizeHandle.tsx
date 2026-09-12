import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { PaneLimits } from './workspacePaneLayout';

const KEYBOARD_STEP = 8;

export function PaneResizeHandle({
  label,
  value,
  limits,
  inverted = false,
  className = '',
  resizeTarget,
  resizeProperty,
  onChange,
}: {
  label: string;
  value: number;
  limits: PaneLimits;
  inverted?: boolean;
  className?: string;
  resizeTarget: RefObject<HTMLElement | null>;
  resizeProperty: `--${string}`;
  onChange: Dispatch<SetStateAction<number>>;
}) {
  const handleRef = useRef<HTMLDivElement>(null);
  const dragValue = useRef(value);
  const [drag, setDrag] = useState<{
    startX: number;
    startValue: number;
    pointerId: number;
  } | null>(null);

  useEffect(() => {
    if (!drag) return;
    const origin = drag;
    const target = resizeTarget.current;
    const handle = handleRef.current;
    let stopped = false;

    function move(event: PointerEvent) {
      if (event.pointerId !== origin.pointerId) return;
      const delta = (event.clientX - origin.startX) * (inverted ? -1 : 1);
      const next = constrain(origin.startValue + delta, limits);
      dragValue.current = next;
      updatePresentation(target, handle, resizeProperty, next);
    }
    function stop(event: PointerEvent) {
      if (event.pointerId !== origin.pointerId) return;
      if (stopped) return;
      stopped = true;
      onChange(dragValue.current);
      setDrag(null);
    }

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    handle?.addEventListener('lostpointercapture', stop);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      handle?.removeEventListener('lostpointercapture', stop);
      if (!stopped) {
        dragValue.current = value;
        updatePresentation(target, handle, resizeProperty, value);
      }
    };
  }, [drag, inverted, limits, onChange, resizeProperty, resizeTarget, value]);

  function commitValue(next: number) {
    const constrained = constrain(next, limits);
    dragValue.current = constrained;
    updatePresentation(
      resizeTarget.current,
      handleRef.current,
      resizeProperty,
      constrained,
    );
    onChange(constrained);
  }

  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    dragValue.current = value;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDrag({
      startX: event.clientX,
      startValue: value,
      pointerId: event.pointerId,
    });
  }

  function keyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = value - KEYBOARD_STEP;
    if (event.key === 'ArrowRight') next = value + KEYBOARD_STEP;
    if (event.key === 'Home') next = limits.min;
    if (event.key === 'End') next = limits.max;
    if (next === null) return;
    event.preventDefault();
    commitValue(next);
  }

  return (
    <div
      ref={handleRef}
      className={`pane-resize-handle ${className}${drag ? ' is-dragging' : ''}`}
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      aria-valuenow={value}
      tabIndex={0}
      onDoubleClick={() => commitValue(limits.defaultValue)}
      onKeyDown={keyDown}
      onPointerDown={startDrag}
    />
  );
}

function constrain(value: number, limits: PaneLimits) {
  return Math.min(limits.max, Math.max(limits.min, Math.round(value)));
}

function updatePresentation(
  target: HTMLElement | null,
  handle: HTMLElement | null,
  property: `--${string}`,
  value: number,
) {
  target?.style.setProperty(property, `${value}px`);
  handle?.setAttribute('aria-valuenow', String(value));
}
