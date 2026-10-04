import { BaseEdge, type Edge, type EdgeProps } from '@xyflow/react';
import { useLayoutEffect, useRef } from 'react';
import type { GraphPosition } from './graphLayout';
import { roundedGraphPath } from './graphPath';

export type ExecutionFlowEdge = Edge<{
  kind: string;
  route: GraphPosition[];
  cornerRadii?: number[];
}>;

export function ExecutionGraphEdge(props: EdgeProps<ExecutionFlowEdge>) {
  const points = props.data?.route;
  const path = roundedGraphPath(points ?? [], props.data?.cornerRadii);
  const groupRef = useRef<SVGGElement>(null);
  useLayoutEffect(() => {
    const element = groupRef.current?.querySelector<SVGPathElement>(
      '.react-flow__edge-path',
    );
    if (element && typeof element.getTotalLength === 'function') {
      element.style.strokeDashoffset = String(-element.getTotalLength());
    }
  }, [path]);
  if (!points?.length) return null;
  return (
    <g ref={groupRef}>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        style={props.style}
      />
    </g>
  );
}
