import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, it, vi } from 'vitest';
import { graphTask } from './testFixtures';
import { projectExecutionGraph } from './graphProjection';
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
  it('routes every edge outside unrelated task rectangles and gives each dependency its own endpoint', async () => {
    const projection = fixture();
    const layout = await layoutExecutionGraph(projection);
    const edges = [...projection.hierarchyEdges, ...projection.dependencyEdges];
    const sources = new Map<string, Set<string>>();
    const targets = new Map<string, Set<string>>();
    for (const edge of edges) {
      const points = layout.routes[edge.id];
      expect(points?.length).toBeGreaterThanOrEqual(2);
      if (!points) throw new Error('Missing edge route');
      for (const [nodeId, endpoint, groups] of [
        [edge.source, points[0], sources],
        [edge.target, points.at(-1), targets],
      ] as const) {
        const used = groups.get(nodeId) ?? new Set<string>();
        const key = JSON.stringify(endpoint);
        expect(used.has(key)).toBe(false);
        used.add(key);
        groups.set(nodeId, used);
      }
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
