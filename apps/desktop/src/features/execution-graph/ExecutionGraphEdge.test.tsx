import { render } from '@testing-library/react';
import { Position } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { ExecutionGraphEdge } from './ExecutionGraphEdge';

describe('Execution Graph edges', () => {
  it.each(['parent', 'blocks'])(
    'preserves obstacle-aware routing and arrow direction for %s',
    (kind) => {
      const { container } = render(
        <svg>
          <ExecutionGraphEdge
            id="relation"
            source="source"
            target="target"
            sourceX={100}
            sourceY={300}
            targetX={300}
            targetY={100}
            sourcePosition={Position.Top}
            targetPosition={Position.Bottom}
            data={{
              kind,
              route: [
                { x: 80, y: 300 },
                { x: 80, y: 200 },
                { x: 320, y: 200 },
                { x: 320, y: 100 },
              ],
            }}
            markerEnd="url(#arrow)"
          />
        </svg>,
      );
      expect(container.querySelector('#relation')).toHaveAttribute(
        'd',
        'M 80 300 L 80 200 L 320 200 L 320 100',
      );
      expect(container.querySelector('#relation')).toHaveAttribute(
        'marker-end',
        'url(#arrow)',
      );
    },
  );
});
