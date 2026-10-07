import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, it, vi } from 'vitest';
import { graphTask } from './testFixtures';
import { projectExecutionGraph } from './graphProjection';
import { parallelRoute } from './graphRouting';
import { pairedCornerRadii } from './graphPath';
import {
  GRAPH_NODE_HEIGHT,
  GRAPH_NODE_WIDTH,
  layoutExecutionGraph,
} from './graphLayout';

vi.mock('./graphLayoutWorker', () => ({
  createGraphLayoutEngine: () => new ELK(),
}));

function fixture() {
  const pairs = [
    ['db', 'api'],
    ['research', 'api'],
    ['api', 'backend'],
    ['api', 'frontend'],
    ['design', 'frontend'],
    ['backend', 'frontend'],
    ['frontend', 'integration'],
    ['backend', 'integration'],
    ['integration', 'release'],
    ['notes', 'release'],
  ];
  return projectExecutionGraph(
    [
      'release',
      'integration',
      'backend',
      'frontend',
      'api',
      'notes',
      'db',
      'research',
      'design',
    ].map((id) =>
      graphTask(
        id,
        {
          parent: ['frontend', 'backend'].includes(id)
            ? { id: 'integration', reference: '#1', title: 'Integration' }
            : ['integration', 'notes'].includes(id)
              ? { id: 'release', reference: '#2', title: 'Release' }
              : null,
          relations: pairs
            .filter(([source]) => source === id)
            .map(([, target]) => ({
              task: { id: target ?? '', reference: '#3', title: target ?? '' },
              relation_type: 'blocking' as const,
            })),
        },
        ['db', 'research', 'design'].includes(id) ? 'done' : 'todo',
      ),
    ),
  );
}

describe('Graph placement and edge routing', () => {
  it('aligns task centers to shared columns rather than their offset ports', async () => {
    const { positions } = await layoutExecutionGraph(fixture());
    expect(positions.api?.x).toBe(positions.backend?.x);
    const origin = Math.min(
      ...Object.values(positions).map((point) => point.x),
    );
    for (const point of Object.values(positions)) {
      const column = (point.x - origin) / ((GRAPH_NODE_WIDTH + 32) / 2);
      expect(column).toBeCloseTo(Math.round(column));
    }
  });

  it('leaves breathing room around the frontier without horizontal routes crowding it', async () => {
    const layout = await layoutExecutionGraph(fixture());
    for (const points of Object.values(layout.routes)) {
      for (let index = 1; index < points.length; index += 1) {
        const start = points[index - 1];
        const end = points[index];
        if (start && end && start.y === end.y) {
          expect(Math.abs(start.y - layout.frontierY)).toBeGreaterThanOrEqual(
            32,
          );
        }
      }
    }
  });

  it('keeps paired relation ports one routing lane apart, centered on each task', async () => {
    const projection = fixture();
    const layout = await layoutExecutionGraph(projection);
    for (const parent of projection.hierarchyEdges) {
      const blocks = projection.dependencyEdges.find(
        (edge) =>
          edge.source === parent.source && edge.target === parent.target,
      );
      if (!blocks) throw new Error('Missing paired relation');
      const parentRoute = layout.routes[parent.id];
      const blockRoute = layout.routes[blocks.id];
      if (!parentRoute || !blockRoute) throw new Error('Missing route');
      for (const index of [0, -1]) {
        const parentPort = parentRoute.at(index);
        const blockPort = blockRoute.at(index);
        if (!parentPort || !blockPort) throw new Error('Missing port');
        expect(parentPort.x - blockPort.x).toBeCloseTo(12);
        expect(parentPort.y).toBe(blockPort.y);
      }
      const target = layout.positions[parent.target];
      if (!target) throw new Error('Missing target');
      expect(
        ((parentRoute.at(-1)?.x ?? 0) + (blockRoute.at(-1)?.x ?? 0)) / 2,
      ).toBeCloseTo(target.x + GRAPH_NODE_WIDTH / 2);
    }
  });

  it('keeps a short branch next to its goal instead of stretching it from the bottom rank', async () => {
    const { positions } = await layoutExecutionGraph(fixture());
    expect(positions.notes?.y).toBe(positions.integration?.y);
    expect(positions.release?.y).toBeLessThan(positions.notes?.y ?? 0);
  });

  it('balances a symmetric branching graph around its goal instead of pinning it to one branch', async () => {
    const projection = projectExecutionGraph([
      graphTask('goal'),
      ...['left', 'right'].map((id) =>
        graphTask(id, {
          parent: { id: 'goal', reference: '#1', title: 'Goal' },
          relations: [
            {
              task: { id: 'goal', reference: '#1', title: 'Goal' },
              relation_type: 'blocking',
            },
          ],
        }),
      ),
    ]);
    const { positions, routes, cornerRadii } =
      await layoutExecutionGraph(projection);
    const { goal, left, right } = positions;
    if (!goal || !left || !right) throw new Error('Missing positions');
    expect(left.y).toBe(right.y);
    expect(Math.abs(left.x - right.x) - GRAPH_NODE_WIDTH).toBe(32);
    expect(goal.x).toBeCloseTo((left.x + right.x) / 2);
    expect(goal.y).toBeLessThan(left.y);
    for (const source of ['left', 'right']) {
      const dependency = routes[`blocks:${source}:goal`];
      if (!dependency) throw new Error('Missing dependency route');
      const paired = parallelRoute(dependency, 12, []);
      expect(paired).not.toBeNull();
      expect(routes[`parent:${source}:goal`]).toEqual(paired);
      if (!paired) throw new Error('Missing paired route');
      const radii = pairedCornerRadii(dependency, paired, 12);
      expect(cornerRadii[`parent:${source}:goal`]).toEqual(radii?.paired);
      expect(cornerRadii[`blocks:${source}:goal`]).toEqual(radii?.base);
    }
  });

  it('routes outside tasks, merges same-kind incoming branches, and separates relation types', async () => {
    const projection = fixture();
    const layout = await layoutExecutionGraph(projection);
    const edges = [...projection.hierarchyEdges, ...projection.dependencyEdges];
    const sources = new Map<string, Set<string>>();
    const targets = new Map<string, string>();
    for (const edge of edges) {
      const points = layout.routes[edge.id];
      expect(points?.length).toBeGreaterThanOrEqual(2);
      if (!points) throw new Error('Missing edge route');
      for (const [nodeId, endpoint, groups] of [
        [edge.source, points[0], sources],
      ] as const) {
        const used = groups.get(nodeId) ?? new Set<string>();
        const key = JSON.stringify(endpoint);
        expect(used.has(key)).toBe(false);
        used.add(key);
        groups.set(nodeId, used);
      }
      const targetKey = `${edge.target}:${edge.kind}`;
      const endpoint = JSON.stringify(points.at(-1));
      const previous = targets.get(targetKey);
      if (previous) expect(endpoint).toBe(previous);
      targets.set(targetKey, endpoint);
      const otherKind = edge.kind === 'parent' ? 'blocks' : 'parent';
      expect(endpoint).not.toBe(targets.get(`${edge.target}:${otherKind}`));
      for (let index = 1; index < points.length; index += 1) {
        const start = points[index - 1];
        const end = points[index];
        if (!start || !end) throw new Error('Missing segment');
        expect(start.x === end.x || start.y === end.y).toBe(true);
        for (const [id, node] of Object.entries(layout.positions)) {
          if (id === edge.source || id === edge.target) continue;
          const crosses =
            start.x === end.x
              ? start.x > node.x &&
                start.x < node.x + GRAPH_NODE_WIDTH &&
                Math.max(start.y, end.y) > node.y &&
                Math.min(start.y, end.y) < node.y + GRAPH_NODE_HEIGHT
              : start.y > node.y &&
                start.y < node.y + GRAPH_NODE_HEIGHT &&
                Math.max(start.x, end.x) > node.x &&
                Math.min(start.x, end.x) < node.x + GRAPH_NODE_WIDTH;
          expect(crosses, `${edge.id} crosses ${id}`).toBe(false);
        }
      }
    }
    for (const node of projection.nodes) {
      const position = layout.positions[node.id];
      if (!position) throw new Error('Missing node');
      if (node.completed) expect(position.y).toBeGreaterThan(layout.frontierY);
      else
        expect(position.y + GRAPH_NODE_HEIGHT).toBeLessThan(layout.frontierY);
    }
    const segments = Object.entries(layout.routes).flatMap(([id, points]) =>
      points.slice(1).flatMap((end, index) => {
        const start = points[index];
        return start ? [{ id, start, end }] : [];
      }),
    );
    for (const [index, segment] of segments.entries()) {
      for (const other of segments.slice(index + 1)) {
        if (segment.id === other.id) continue;
        const relation = edges.find((edge) => edge.id === segment.id);
        const otherRelation = edges.find((edge) => edge.id === other.id);
        if (
          relation?.kind === otherRelation?.kind &&
          relation?.target === otherRelation?.target
        )
          continue;
        const vertical = segment.start.x === segment.end.x;
        const sameAxis = vertical
          ? other.start.x === other.end.x && segment.start.x === other.start.x
          : other.start.y === other.end.y && segment.start.y === other.start.y;
        if (!sameAxis) continue;
        const axis = vertical ? 'y' : 'x';
        const overlap =
          Math.min(
            Math.max(segment.start[axis], segment.end[axis]),
            Math.max(other.start[axis], other.end[axis]),
          ) -
          Math.max(
            Math.min(segment.start[axis], segment.end[axis]),
            Math.min(other.start[axis], other.end[axis]),
          );
        expect(
          overlap,
          `${segment.id} overlaps ${other.id}`,
        ).toBeLessThanOrEqual(0);
      }
    }
    expect(await layoutExecutionGraph(projection)).toEqual(layout);
  });
});
