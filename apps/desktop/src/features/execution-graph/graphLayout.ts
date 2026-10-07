import type { ElkNode, ElkPort } from 'elkjs/lib/elk-api.js';
import { createGraphLayoutEngine } from './graphLayoutWorker';
import {
  parallelRoute,
  retargetRoute,
  straightenEndpointJogs,
} from './graphRouting';
import { pairedCornerRadii } from './graphPath';
import { graphRows } from './graphRows';
import type { ExecutionGraphProjection } from './types';

export const GRAPH_NODE_WIDTH = 252;
export const GRAPH_NODE_HEIGHT = 72;
const GRAPH_LANE_SPACING = 12;
const GRAPH_COLUMN_GAP = 32;
const GRAPH_ROW_GAP = 72;
const GRAPH_FRONTIER_GAP = 64;

export interface GraphPosition {
  x: number;
  y: number;
}
export interface GraphLayout {
  positions: Record<string, GraphPosition>;
  routes: Record<string, GraphPosition[]>;
  cornerRadii: Record<string, number[]>;
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
      'elk.layered.nodePlacement.favorStraightEdges': 'true',
      'elk.spacing.nodeNode': String(GRAPH_COLUMN_GAP),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(GRAPH_ROW_GAP),
      'elk.spacing.edgeNode': '16',
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
  const initial = await engine.layout(input);
  const origin = Math.min(
    ...(initial.children ?? []).map((node) => node.x ?? 0),
  );
  const columnStep = (GRAPH_NODE_WIDTH + GRAPH_COLUMN_GAP) / 2;
  const initialPositions = new Map(
    (initial.children ?? []).map((node) => [node.id, node]),
  );
  const alignedNodes = (input.children ?? []).map((node) => {
    const position = initialPositions.get(node.id);
    return {
      ...node,
      x:
        origin +
        Math.round(((position?.x ?? 0) - origin) / columnStep) * columnStep,
      y: position?.y ?? 0,
    };
  });
  const alignedById = new Map(alignedNodes.map((node) => [node.id, node]));
  for (const node of alignedNodes) {
    const connection = edges
      .filter((edge) => {
        const target = alignedById.get(edge.target);
        return (
          edge.source === node.id && target?.x === node.x && target.y < node.y
        );
      })
      .sort(
        (left, right) =>
          (alignedById.get(right.target)?.y ?? 0) -
          (alignedById.get(left.target)?.y ?? 0),
      )[0];
    if (!connection) continue;
    const sourcePort = node.ports?.find(
      (port) => port.id === `${connection.id}:source`,
    );
    const targetPort = alignedById
      .get(connection.target)
      ?.ports?.find(
        (port) => port.id === `${connection.target}:${connection.kind}:target`,
      );
    if (sourcePort?.x === undefined || targetPort?.x === undefined) continue;
    const offset = targetPort.x - sourcePort.x;
    const outgoing =
      node.ports?.filter(
        (port) => port.layoutOptions?.['elk.port.side'] === 'NORTH',
      ) ?? [];
    if (
      outgoing.some(
        (port) =>
          (port.x ?? 0) + offset < 16 ||
          (port.x ?? 0) + offset > GRAPH_NODE_WIDTH - 16,
      )
    )
      continue;
    node.ports = node.ports?.map((port) =>
      port.layoutOptions?.['elk.port.side'] === 'NORTH'
        ? { ...port, x: (port.x ?? 0) + offset }
        : port,
    );
  }
  const result = await engine.layout({
    ...input,
    layoutOptions: {
      ...input.layoutOptions,
      'elk.layered.nodePlacement.strategy': 'INTERACTIVE',
      'elk.layered.crossingMinimization.strategy': 'INTERACTIVE',
    },
    children: alignedNodes,
  });
  const completedIds = new Set(
    projection.nodes.filter((node) => node.completed).map((node) => node.id),
  );
  const initialTops = (initial.children ?? []).map((node) => node.y ?? 0);
  const finalTops = (result.children ?? []).map((node) => node.y ?? 0);
  const rowStep = Math.max(
    graphRows(initialTops, GRAPH_NODE_HEIGHT, GRAPH_ROW_GAP).step,
    graphRows(finalTops, GRAPH_NODE_HEIGHT, GRAPH_ROW_GAP).step,
  );
  const initialRows = graphRows(
    initialTops,
    GRAPH_NODE_HEIGHT,
    rowStep - GRAPH_NODE_HEIGHT,
  );
  const finalRows = graphRows(
    finalTops,
    GRAPH_NODE_HEIGHT,
    rowStep - GRAPH_NODE_HEIGHT,
  );
  const activeBottomBeforeSpacing = Math.max(
    0,
    ...(result.children ?? [])
      .filter((node) => !completedIds.has(node.id))
      .map((node) => finalRows.mapY(node.y ?? 0) + GRAPH_NODE_HEIGHT),
  );
  const completedTopBeforeSpacing = Math.min(
    ...(result.children ?? [])
      .filter((node) => completedIds.has(node.id))
      .map((node) => finalRows.mapY(node.y ?? 0)),
  );
  const frontierCut =
    (activeBottomBeforeSpacing + completedTopBeforeSpacing) / 2;
  const reserveFrontier =
    completedIds.size > 0 &&
    completedIds.size < projection.nodes.length &&
    completedTopBeforeSpacing > activeBottomBeforeSpacing;
  const spaceFrontier = (point: GraphPosition): GraphPosition => ({
    x: point.x,
    y:
      finalRows.mapY(point.y) +
      (reserveFrontier && finalRows.mapY(point.y) >= frontierCut
        ? GRAPH_FRONTIER_GAP
        : 0),
  });
  const positions: GraphLayout['positions'] = {};
  const routes: GraphLayout['routes'] = {};
  const cornerRadii: GraphLayout['cornerRadii'] = {};
  for (const node of result.children ?? []) {
    if (node.x === undefined || node.y === undefined)
      throw new Error('Missing graph position');
    positions[node.id] = spaceFrontier({ x: node.x, y: node.y });
  }
  const relations = new Map(edges.map((edge) => [edge.id, edge]));
  const originalRoutes = new Map(
    (initial.edges ?? []).map((edge) => [edge.id, edge.sections?.[0]]),
  );
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
    const original = originalRoutes.get(edge.id);
    const preserved = original
      ? retargetRoute(
          [
            original.startPoint,
            ...(original.bendPoints ?? []),
            original.endPoint,
          ].map((point) => ({
            x: point.x,
            y:
              initialRows.mapY(point.y) +
              (reserveFrontier && initialRows.mapY(point.y) >= frontierCut
                ? GRAPH_FRONTIER_GAP
                : 0),
          })),
          spaceFrontier(section.startPoint),
          spaceFrontier(section.endPoint),
          obstacles,
        )
      : null;
    routes[edge.id] = straightenEndpointJogs(
      preserved ??
        [
          section.startPoint,
          ...(section.bendPoints ?? []),
          section.endPoint,
        ].map(spaceFrontier),
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
      const radii = pairedCornerRadii(
        dependency,
        candidate,
        GRAPH_LANE_SPACING,
      );
      if (radii) {
        routes[parent.id] = candidate;
        cornerRadii[parent.id] = radii.paired;
        cornerRadii[`blocks:${parent.source}:${parent.target}`] = radii.base;
      }
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
    cornerRadii,
    frontierY: Number.isFinite(completedTop)
      ? (activeBottom + completedTop) / 2
      : activeBottom + 48,
    width: Math.max(600, result.width ?? 0),
  };
}
