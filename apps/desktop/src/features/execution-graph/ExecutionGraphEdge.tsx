import {
  BaseEdge,
  getBezierPath,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react';

export function ExecutionGraphEdge(props: EdgeProps) {
  const [path] =
    props.data?.kind === 'parent'
      ? getBezierPath({
          ...props,
          sourceX: props.sourceX + 18,
          targetX: props.targetX + 18,
        })
      : getSmoothStepPath({ ...props, borderRadius: 12 });
  return (
    <BaseEdge
      id={props.id}
      path={path}
      markerEnd={props.markerEnd}
      style={props.style}
    />
  );
}
