import { graphlib, layout } from '@dagrejs/dagre';
import type { ExecutionGraphProjection } from './types';

export const GRAPH_NODE_WIDTH = 252;
export const GRAPH_NODE_HEIGHT = 72;

export interface GraphPosition {
  x: number;
  y: number;
}
export interface GraphLayout {
  positions: Record<string, GraphPosition>;
  frontierY: number;
  width: number;
}

export function graphLayoutKey(graph: ExecutionGraphProjection) {
  return JSON.stringify([
    graph.nodes.map((node) => [node.id, node.completed]),
    [...graph.hierarchyEdges, ...graph.dependencyEdges]
      .map((edge) => [edge.source, edge.target])
      .sort(),
  ]);
}

export function layoutExecutionGraph(
  projection: ExecutionGraphProjection,
): GraphLayout {
  const graph = new graphlib.Graph()
    .setGraph({
      rankdir: 'BT',
      ranksep: 72,
      nodesep: 48,
      marginx: 32,
      marginy: 32,
    })
    .setDefaultEdgeLabel(() => ({}));
  for (const node of projection.nodes)
    graph.setNode(node.id, {
      width: GRAPH_NODE_WIDTH,
      height: GRAPH_NODE_HEIGHT,
    });
  for (const edge of [
    ...projection.hierarchyEdges,
    ...projection.dependencyEdges,
  ])
    graph.setEdge(edge.source, edge.target);
  layout(graph);
  const positions: Record<string, GraphPosition> = {};
  let nextY = 32;
  let frontierY = 0;
  for (const completed of [false, true]) {
    const nodes = projection.nodes.filter(
      (node) => node.completed === completed,
    );
    const ranks = [...new Set(nodes.map((node) => graph.node(node.id).y))].sort(
      (left, right) => left - right,
    );
    const rankY = new Map(
      ranks.map((rank, index) => [
        rank,
        nextY + index * (GRAPH_NODE_HEIGHT + 72),
      ]),
    );
    for (const node of nodes) {
      const position = graph.node(node.id);
      positions[node.id] = {
        x: position.x - GRAPH_NODE_WIDTH / 2,
        y: rankY.get(position.y) ?? nextY,
      };
    }
    nextY += ranks.length * (GRAPH_NODE_HEIGHT + 72);
    if (!completed) {
      frontierY = nextY;
      nextY += 72;
    }
  }
  return {
    positions,
    frontierY,
    width: Math.max(
      600,
      ...Object.values(positions).map(
        (position) => position.x + GRAPH_NODE_WIDTH + 32,
      ),
    ),
  };
}
