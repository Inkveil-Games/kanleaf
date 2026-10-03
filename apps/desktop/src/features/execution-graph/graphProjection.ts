import type { Task } from '../workspace/types';
import { isCompletedRole, taskExecutionState } from './executionState';
import type {
  ExecutionGraphProjection,
  GraphRelationEdge,
  GraphViewSettings,
} from './types';

export function projectExecutionGraph(
  tasks: readonly Task[],
): ExecutionGraphProjection {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const ordered = [...byId.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const hierarchy = new Map<string, GraphRelationEdge>();
  const dependencies = new Map<string, GraphRelationEdge>();
  const blocked = new Set<string>();
  for (const task of ordered) {
    if (task.parent && task.parent.id !== task.id && byId.has(task.parent.id)) {
      const id = `parent:${task.id}:${task.parent.id}`;
      hierarchy.set(id, {
        id,
        source: task.id,
        target: task.parent.id,
        kind: 'parent',
      });
    }
    for (const relation of task.relations) {
      const relatedId = relation.task.id;
      if (relatedId === task.id) continue;
      const related = byId.get(relatedId);
      if (
        relation.relation_type === 'blocked_by' &&
        !isCompletedRole(
          related?.state.system_role ?? relation.task_system_role,
        )
      )
        blocked.add(task.id);
      if (
        !related ||
        !['blocking', 'blocked_by'].includes(relation.relation_type)
      )
        continue;
      const [source, target] =
        relation.relation_type === 'blocking'
          ? [task.id, relatedId]
          : [relatedId, task.id];
      const id = `blocks:${source}:${target}`;
      dependencies.set(id, { id, source, target, kind: 'blocks' });
      const blocker = byId.get(source);
      if (blocker && !isCompletedRole(blocker.state.system_role))
        blocked.add(target);
    }
  }
  const nodes = ordered.map((task) => ({
    id: task.id,
    task,
    completed: isCompletedRole(task.state.system_role),
    executionState: taskExecutionState(task, blocked.has(task.id)),
  }));
  return {
    nodes,
    hierarchyEdges: [...hierarchy.values()],
    dependencyEdges: [...dependencies.values()],
    completion: {
      completed: nodes.filter((node) => node.completed).length,
      total: nodes.length,
    },
  };
}

export function visibleGraph(
  graph: ExecutionGraphProjection,
  settings: GraphViewSettings,
) {
  const nodes = graph.nodes.filter(
    (node) => settings.showCompleted || !node.completed,
  );
  const ids = new Set(nodes.map((node) => node.id));
  const edges = [
    ...(settings.showParentEdges ? graph.hierarchyEdges : []),
    ...(settings.showBlockEdges ? graph.dependencyEdges : []),
  ].filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  return { nodes, edges };
}
