import {
  useEffect,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
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
  onChange,
}: {
  label: string;
  value: number;
  limits: PaneLimits;
  inverted?: boolean;
  className?: string;
  onChange: Dispatch<SetStateAction<number>>;
}) {
  const [drag, setDrag] = useState<{
    startX: number;
    startValue: number;
  } | null>(null);

  useEffect(() => {
    if (!drag) return;
    const origin = drag;

    function move(event: PointerEvent) {
      const delta = (event.clientX - origin.startX) * (inverted ? -1 : 1);
      onChange(constrain(origin.startValue + delta, limits));
    }
    function stop() {
      setDrag(null);
    }

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    window.addEventListener('pointercancel', stop, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, [drag, inverted, limits, onChange]);

  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    setDrag({ startX: event.clientX, startValue: value });
  }

  function keyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = value - KEYBOARD_STEP;
    if (event.key === 'ArrowRight') next = value + KEYBOARD_STEP;
    if (event.key === 'Home') next = limits.min;
    if (event.key === 'End') next = limits.max;
    if (next === null) return;
    event.preventDefault();
    onChange(constrain(next, limits));
  }

  return (
    <div
      className={`pane-resize-handle ${className}${drag ? ' is-dragging' : ''}`}
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      aria-valuenow={value}
      tabIndex={0}
      onDoubleClick={() => onChange(limits.defaultValue)}
      onKeyDown={keyDown}
      onPointerDown={startDrag}
    />
  );
}

function constrain(value: number, limits: PaneLimits) {
  return Math.min(limits.max, Math.max(limits.min, Math.round(value)));
}
