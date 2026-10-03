import { BaseEdge, type Edge, type EdgeProps } from '@xyflow/react';
import type { GraphPosition } from './graphLayout';

export type ExecutionFlowEdge = Edge<{ kind: string; route: GraphPosition[] }>;

export function ExecutionGraphEdge(props: EdgeProps<ExecutionFlowEdge>) {
  const points = props.data?.route;
  if (!points?.length) return null;
  const path = points
    .map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`)
    .join(' ');
  return (
    <BaseEdge
      id={props.id}
      path={path}
      markerEnd={props.markerEnd}
      style={props.style}
    />
  );
}
