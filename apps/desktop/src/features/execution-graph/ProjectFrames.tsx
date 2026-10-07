import { useMemo } from 'react';
import { ViewportPortal } from '@xyflow/react';
import type { Project } from '../workspace/types';
import {
  GRAPH_NODE_HEIGHT,
  GRAPH_NODE_WIDTH,
  type GraphPosition,
} from './graphLayout';
import type { GraphTaskNode } from './types';

export function ProjectFrames({
  nodes,
  positions,
  projects,
}: {
  nodes: GraphTaskNode[];
  positions: Record<string, GraphPosition>;
  projects: Project[];
}) {
  const frames = useMemo(() => {
    const groups = new Map<string, GraphPosition[]>();
    for (const node of nodes) {
      const projectId = node.task.project_id;
      const position = positions[node.id];
      if (!projectId || !position) continue;
      const group = groups.get(projectId) ?? [];
      group.push(position);
      groups.set(projectId, group);
    }
    return projects.flatMap((project) => {
      const group = groups.get(project.id);
      if (!group?.length) return [];
      const left = Math.min(...group.map((position) => position.x)) - 12;
      const top = Math.min(...group.map((position) => position.y)) - 48;
      const right =
        Math.max(...group.map((position) => position.x)) +
        GRAPH_NODE_WIDTH +
        12;
      const bottom =
        Math.max(...group.map((position) => position.y)) +
        GRAPH_NODE_HEIGHT +
        16;
      return [
        {
          id: project.id,
          name: project.name,
          left,
          top,
          width: right - left,
          height: bottom - top,
        },
      ];
    });
  }, [nodes, positions, projects]);

  return (
    <ViewportPortal>
      {frames.map((frame) => (
        <div
          key={frame.id}
          className="execution-project-frame"
          style={{
            transform: `translate(${frame.left}px, ${frame.top}px)`,
            width: frame.width,
            height: frame.height,
          }}
        >
          <span className="execution-project-frame-title">{frame.name}</span>
        </div>
      ))}
    </ViewportPortal>
  );
}
