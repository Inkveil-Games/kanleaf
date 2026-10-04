import type { ElkNode, ElkPort } from 'elkjs/lib/elk-api.js';
import { createGraphLayoutEngine } from './graphLayoutWorker';
import { parallelRoute, straightenEndpointJogs } from './graphRouting';
import type { ExecutionGraphProjection } from './types';

export const GRAPH_NODE_WIDTH = 252;
export const GRAPH_NODE_HEIGHT = 72;
const GRAPH_LANE_SPACING = 12;

export interface GraphPosition {
  x: number;
  y: number;
}
export interface GraphLayout {
  positions: Record<string, GraphPosition>;
  routes: Record<string, GraphPosition[]>;
  frontierY: number;
  width: number;
}

let engine: ReturnType<typeof createGraphLayoutEngine> | undefined;

export function graphLayoutKey(graph: ExecutionGraphProjection) {
  return JSON.stringify([
    graph.nodes.map((node) => [node.id, node.completed]),
    [...graph.hierarchyEdges, ...graph.dependencyEdges]
      .map((edge) => [edge.id, edge.source, edge.target])
      .sort(),
  ]);
}

export async function layoutExecutionGraph(
  projection: ExecutionGraphProjection,
): Promise<GraphLayout> {
  const edges = [
    ...projection.hierarchyEdges,
    ...projection.dependencyEdges,
  ].sort((left, right) => left.id.localeCompare(right.id));
  const ports = new Map<string, ElkPort[]>();
  const portOrder = new Map<string, string>();
  for (const edge of edges) {
    for (const [id, suffix, side] of [
      [edge.source, 'source', 'NORTH'],
      [edge.target, 'target', 'SOUTH'],
    ] as const) {
      const list = ports.get(id) ?? [];
      const portId =
        suffix === 'target' ? `${id}:${edge.kind}:target` : `${edge.id}:source`;
      if (list.some((port) => port.id === portId)) continue;
      portOrder.set(
        portId,
        `${suffix === 'source' ? edge.target : ''}:${edge.kind === 'blocks' ? '0' : '1'}`,
      );
      list.push({
        id: portId,
        width: 0,
        height: 0,
        layoutOptions: { 'elk.port.side': side },
      });
      ports.set(id, list);
    }
  }
  for (const list of ports.values()) {
    for (const side of ['NORTH', 'SOUTH']) {
      const group = list
        .filter((port) => port.layoutOptions?.['elk.port.side'] === side)
        .sort((left, right) =>
          (portOrder.get(left.id) ?? '').localeCompare(
            portOrder.get(right.id) ?? '',
          ),
        );
      const spacing = Math.min(
        GRAPH_LANE_SPACING,
        (GRAPH_NODE_WIDTH - 32) / Math.max(1, group.length - 1),
      );
      group.forEach((port, index) => {
        port.x =
          GRAPH_NODE_WIDTH / 2 + (index - (group.length - 1) / 2) * spacing;
        port.y = side === 'NORTH' ? 0 : GRAPH_NODE_HEIGHT;
      });
    }
  }
  const input: ElkNode = {
    id: 'execution-graph',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'UP',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.partitioning.activate': 'true',
      'elk.separateConnectedComponents': 'false',
      'elk.layered.mergeEdges': 'false',
      'elk.layered.layering.strategy': 'LONGEST_PATH',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
      'elk.layered.nodePlacement.favorStraightEdges': 'false',
      'elk.spacing.nodeNode': '48',
      'elk.layered.spacing.nodeNodeBetweenLayers': '72',
      'elk.spacing.edgeNode': '24',
      'elk.layered.spacing.edgeNodeBetweenLayers': '24',
      'elk.spacing.edgeEdge': String(GRAPH_LANE_SPACING),
      'elk.layered.spacing.edgeEdgeBetweenLayers': String(GRAPH_LANE_SPACING),
      'elk.padding': '[top=32,left=32,bottom=32,right=32]',
      'elk.randomSeed': '1',
    },
    children: projection.nodes.map((node) => ({
      id: node.id,
      width: GRAPH_NODE_WIDTH,
      height: GRAPH_NODE_HEIGHT,
      ports: ports.get(node.id) ?? [],
      layoutOptions: {
        'elk.partitioning.partition': node.completed ? '0' : '1',
        'elk.portConstraints': 'FIXED_POS',
      },
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: [`${edge.id}:source`],
      targets: [`${edge.target}:${edge.kind}:target`],
    })),
  };
  engine ??= createGraphLayoutEngine();
  const result = await engine.layout(input);
  const positions: GraphLayout['positions'] = {};
  const routes: GraphLayout['routes'] = {};
  for (const node of result.children ?? []) {
    if (node.x === undefined || node.y === undefined)
      throw new Error('Missing graph position');
    positions[node.id] = { x: node.x, y: node.y };
  }
  const relations = new Map(edges.map((edge) => [edge.id, edge]));
  const rectangles = Object.entries(positions).map(([id, position]) => ({
    id,
    ...position,
    width: GRAPH_NODE_WIDTH,
    height: GRAPH_NODE_HEIGHT,
  }));
  for (const edge of result.edges ?? []) {
    const section = edge.sections?.[0];
    if (!section) throw new Error('Missing graph route');
    const relation = relations.get(edge.id);
    const obstacles = rectangles.filter(
      ({ id }) => id !== relation?.source && id !== relation?.target,
    );
    routes[edge.id] = straightenEndpointJogs(
      [section.startPoint, ...(section.bendPoints ?? []), section.endPoint],
      obstacles,
    );
  }
  for (const parent of projection.hierarchyEdges) {
    const dependency = routes[`blocks:${parent.source}:${parent.target}`];
    const original = routes[parent.id];
    if (!dependency || !original) continue;
    const candidate = parallelRoute(
      dependency,
      GRAPH_LANE_SPACING,
      rectangles.filter(
        ({ id }) => id !== parent.source && id !== parent.target,
      ),
    );
    if (
      candidate &&
      [0, -1].every(
        (index) =>
          candidate.at(index)?.x === original.at(index)?.x &&
          candidate.at(index)?.y === original.at(index)?.y,
      )
    ) {
      routes[parent.id] = candidate;
    }
  }
  const activeBottom = Math.max(
    0,
    ...projection.nodes
      .filter((node) => !node.completed)
      .map((node) => (positions[node.id]?.y ?? 0) + GRAPH_NODE_HEIGHT),
  );
  const completedTop = Math.min(
    ...projection.nodes
      .filter((node) => node.completed)
      .map((node) => positions[node.id]?.y ?? 0),
  );
  return {
    positions,
    routes,
    frontierY: Number.isFinite(completedTop)
      ? (activeBottom + completedTop) / 2
      : activeBottom + 48,
    width: Math.max(600, result.width ?? 0),
  };
}
