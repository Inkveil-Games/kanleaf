import { render } from '@testing-library/react';
import { getSmoothStepPath, Position, type EdgeProps } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { ExecutionGraphEdge } from './ExecutionGraphEdge';

const endpoints: EdgeProps = {
  id: 'relation',
  source: 'child',
  target: 'parent',
  sourceX: 100,
  sourceY: 300,
  targetX: 300,
  targetY: 100,
  sourcePosition: Position.Top,
  targetPosition: Position.Bottom,
};

describe('Execution Graph edges', () => {
  it('uses a compact stepped path for hierarchy, parallel to the dependency lane', () => {
    const { container } = render(
      <svg>
        <ExecutionGraphEdge
          {...endpoints}
          data={{ kind: 'parent' }}
          markerEnd="url(#parent-arrow)"
        />
      </svg>,
    );
    const [expected] = getSmoothStepPath({
      ...endpoints,
      sourceX: 112,
      targetX: 312,
      centerY: 212,
      borderRadius: 12,
    });
    expect(container.querySelector('#relation')).toHaveAttribute('d', expected);
    expect(container.querySelector('#relation')).toHaveAttribute(
      'marker-end',
      'url(#parent-arrow)',
    );
  });

  it('keeps dependency direction and arrow on the unshifted stepped path', () => {
    const { container } = render(
      <svg>
        <ExecutionGraphEdge
          {...endpoints}
          data={{ kind: 'blocks' }}
          markerEnd="url(#dependency-arrow)"
        />
      </svg>,
    );
    const [expected] = getSmoothStepPath({ ...endpoints, borderRadius: 12 });
    expect(container.querySelector('#relation')).toHaveAttribute('d', expected);
    expect(container.querySelector('#relation')).toHaveAttribute(
      'marker-end',
      'url(#dependency-arrow)',
    );
  });

  it('keeps the parallel lane outside the dependency when the target is to the left', () => {
    const mirrored = { ...endpoints, sourceX: 300, targetX: 100 };
    const { container } = render(
      <svg>
        <ExecutionGraphEdge {...mirrored} data={{ kind: 'parent' }} />
      </svg>,
    );
    const [expected] = getSmoothStepPath({
      ...mirrored,
      sourceX: 312,
      targetX: 112,
      centerY: 188,
      borderRadius: 12,
    });
    expect(container.querySelector('#relation')).toHaveAttribute('d', expected);
  });
});
