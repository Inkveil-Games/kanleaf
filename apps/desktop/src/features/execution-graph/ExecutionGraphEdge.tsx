import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react';

export function ExecutionGraphEdge(props: EdgeProps) {
  const [path] =
    props.data?.kind === 'parent'
      ? getSmoothStepPath({
          ...props,
          sourceX: props.sourceX + 12,
          targetX: props.targetX + 12,
          centerY:
            (props.sourceY + props.targetY) / 2 +
            (props.targetX >= props.sourceX ? 12 : -12),
          borderRadius: 12,
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
