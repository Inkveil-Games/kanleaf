import { useStore, useViewport, ViewportPortal } from '@xyflow/react';

export function CompletionFrontier({
  y,
  width,
  completed,
}: {
  y: number;
  width: number;
  completed: number;
}) {
  const viewport = useViewport();
  const canvasWidth = useStore((state) => state.width);
  const left = Math.min(0, (-viewport.x - 64) / viewport.zoom);
  const right = Math.max(
    width,
    (canvasWidth - viewport.x + 64) / viewport.zoom,
  );
  return (
    <ViewportPortal>
      <div
        className="completion-frontier"
        style={{ transform: `translate(0px, ${y}px)`, width }}
      >
        <svg
          width={width}
          height="12"
          aria-hidden="true"
          viewBox={`0 0 ${width} 12`}
        >
          <path
            d={`M ${left} 6 L 0 6 Q ${width / 4} 0 ${width / 2} 6 T ${width} 6 L ${right} 6`}
            fill="none"
          />
        </svg>
        <span>Completed · {completed}</span>
      </div>
    </ViewportPortal>
  );
}
