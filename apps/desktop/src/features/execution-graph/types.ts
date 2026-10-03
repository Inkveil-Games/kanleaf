import type { Task } from '../workspace/types';

export interface GraphViewSettings {
  direction: 'vertical';
  showParentEdges: boolean;
  showBlockEdges: boolean;
  showCompleted: boolean;
}

export const defaultGraphViewSettings: GraphViewSettings = {
  direction: 'vertical',
  showParentEdges: true,
  showBlockEdges: true,
  showCompleted: true,
};

export type TaskExecutionState =
  'ready' | 'blocked' | 'in_progress' | 'done' | 'cancelled';

export interface GraphTaskNode {
  id: string;
  task: Task;
  executionState: TaskExecutionState;
  completed: boolean;
}

export interface GraphRelationEdge {
  id: string;
  source: string;
  target: string;
  kind: 'parent' | 'blocks';
}

export interface ExecutionGraphProjection {
  nodes: GraphTaskNode[];
  hierarchyEdges: GraphRelationEdge[];
  dependencyEdges: GraphRelationEdge[];
  completion: { completed: number; total: number };
}
