import { ViewportPortal } from '@xyflow/react';

export function CompletionFrontier({
  y,
  width,
  completed,
}: {
  y: number;
  width: number;
  completed: number;
}) {
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
            d={`M 0 6 Q ${width / 4} 0 ${width / 2} 6 T ${width} 6`}
            fill="none"
          />
        </svg>
        <span>Completed · {completed}</span>
      </div>
    </ViewportPortal>
  );
}
