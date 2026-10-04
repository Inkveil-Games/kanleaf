import { render } from '@testing-library/react';
import { Position } from '@xyflow/react';
import { describe, expect, it, vi } from 'vitest';
import { ExecutionGraphEdge } from './ExecutionGraphEdge';
import { roundedGraphPath } from './graphPath';

describe('Execution Graph edges', () => {
  it('caps corner rounding on short segments and preserves straight paths', () => {
    expect(
      roundedGraphPath([
        { x: 0, y: 10 },
        { x: 0, y: 0 },
        { x: 4, y: 0 },
      ]),
    ).toBe('M 0 10 L 0 2 A 2 2 0 0 1 2 0 L 4 0');
    expect(
      roundedGraphPath([
        { x: 0, y: 10 },
        { x: 0, y: 5 },
        { x: 0, y: 0 },
      ]),
    ).toBe('M 0 10 L 0 5 L 0 0');
    expect(roundedGraphPath([])).toBe('');
  });
  it('aligns shared dashed tails at the target regardless of total path length', () => {
    const original = Object.getOwnPropertyDescriptor(
      SVGElement.prototype,
      'getTotalLength',
    );
    Object.defineProperty(SVGElement.prototype, 'getTotalLength', {
      configurable: true,
      value: vi.fn(() => 123),
    });
    try {
      const { container } = render(
        <svg>
          <ExecutionGraphEdge
            id="aligned"
            source="a"
            target="b"
            sourceX={0}
            sourceY={100}
            targetX={0}
            targetY={0}
            sourcePosition={Position.Top}
            targetPosition={Position.Bottom}
            data={{
              kind: 'blocks',
              route: [
                { x: 0, y: 100 },
                { x: 0, y: 0 },
              ],
            }}
          />
        </svg>,
      );
      expect(container.querySelector('#aligned')).toHaveStyle({
        strokeDashoffset: '-123',
      });
    } finally {
      if (original)
        Object.defineProperty(SVGElement.prototype, 'getTotalLength', original);
      else Reflect.deleteProperty(SVGElement.prototype, 'getTotalLength');
    }
  });
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
              cornerRadii: [0, 24, 24, 0],
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
        'M 80 300 L 80 224 A 24 24 0 0 1 104 200 L 296 200 A 24 24 0 0 0 320 176 L 320 100',
      );
      expect(container.querySelector('#relation')).toHaveAttribute(
        'marker-end',
        'url(#arrow)',
      );
    },
  );
});
