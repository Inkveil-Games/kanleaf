import { describe, expect, it, vi } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';
import { graphTask } from './testFixtures';
import { projectExecutionGraph, visibleGraph } from './graphProjection';
import { defaultGraphViewSettings } from './types';
import { layoutExecutionGraph } from './graphLayout';

vi.mock('./graphLayoutWorker', () => ({
  createGraphLayoutEngine: () => new ELK(),
}));

describe('Execution Graph projection', () => {
  it('projects one node per task, independent parent edges and directed many-to-many blocks', () => {
    const tasks = [
      graphTask('api', {
        relations: [
          {
            task: { id: 'backend', reference: '#2', title: 'Backend' },
            relation_type: 'blocking',
          },
          {
            task: { id: 'frontend', reference: '#3', title: 'Frontend' },
            relation_type: 'blocking',
          },
        ],
      }),
      graphTask('backend', {
        parent: { id: 'release', reference: '#4', title: 'Release' },
      }),
      graphTask('frontend', {
        relations: [
          {
            task: { id: 'design', reference: '#5', title: 'Design' },
            relation_type: 'blocked_by',
            task_system_role: 'todo',
          },
        ],
      }),
      graphTask('release'),
      graphTask('design'),
    ];
    const original = JSON.stringify(tasks);
    const graph = projectExecutionGraph(tasks);
    expect(graph.nodes).toHaveLength(5);
    expect(graph.dependencyEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'api', target: 'backend' }),
        expect.objectContaining({ source: 'api', target: 'frontend' }),
        expect.objectContaining({ source: 'design', target: 'frontend' }),
      ]),
    );
    expect(graph.hierarchyEdges).toEqual([
      expect.objectContaining({ source: 'backend', target: 'release' }),
    ]);
    expect(
      graph.nodes.find((node) => node.id === 'release')?.executionState,
    ).toBe('ready');
    expect(
      graph.nodes.find((node) => node.id === 'frontend')?.executionState,
    ).toBe('blocked');
    expect(JSON.stringify(tasks)).toBe(original);
  });

  it('uses stable workflow roles and hydrated blockers even when outside the query', () => {
    const done = graphTask('done', {}, 'done');
    const cancelled = graphTask('cancelled', {}, 'cancelled');
    const ready = graphTask('ready', {
      relations: [
        {
          task: { id: 'outside', reference: '#9', title: 'Hidden' },
          relation_type: 'blocked_by',
          task_system_role: 'cancelled',
        },
      ],
    });
    const blocked = graphTask(
      'blocked',
      {
        relations: [
          {
            task: { id: 'outside', reference: '#9', title: 'Hidden' },
            relation_type: 'blocked_by',
            task_system_role: 'in_progress',
          },
        ],
      },
      'in_progress',
    );
    const graph = projectExecutionGraph([
      done,
      cancelled,
      ready,
      blocked,
      graphTask('working', {}, 'in_progress'),
    ]);
    expect(graph.nodes.map((node) => node.executionState)).toEqual([
      'blocked',
      'cancelled',
      'done',
      'ready',
      'in_progress',
    ]);
    expect(graph.dependencyEdges).toEqual([]);
    expect(graph.completion).toEqual({ completed: 2, total: 5 });
    const hidden = visibleGraph(graph, {
      ...defaultGraphViewSettings,
      showCompleted: false,
    });
    expect(hidden.nodes).toHaveLength(3);
    expect(graph.completion.completed).toBe(2);
    expect(projectExecutionGraph([ready, blocked]).completion.completed).toBe(
      0,
    );
  });

  it('ignores invalid/self/out-of-scope references and deduplicates both hydrated directions', () => {
    const source = graphTask('a', {
      parent: { id: 'missing', reference: '#9', title: 'Missing' },
      relations: [
        {
          task: { id: 'a', reference: '#1', title: 'A' },
          relation_type: 'blocking',
        },
        {
          task: { id: 'b', reference: '#2', title: 'B' },
          relation_type: 'blocking',
        },
        {
          task: { id: 'missing', reference: '#9', title: 'Missing' },
          relation_type: 'relates_to',
        },
      ],
    });
    const target = graphTask('b', {
      relations: [
        {
          task: { id: 'a', reference: '#1', title: 'A' },
          relation_type: 'blocked_by',
        },
      ],
    });
    const graph = projectExecutionGraph([source, target, source]);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.dependencyEdges).toHaveLength(1);
    expect(graph.hierarchyEdges).toHaveLength(0);
    expect(
      visibleGraph(graph, {
        ...defaultGraphViewSettings,
        showBlockEdges: false,
      }).edges,
    ).toEqual([]);
  });

  it('lays out bottom-up, zones completion, and does not depend on selection/title or edge visibility', async () => {
    const tasks = [
      graphTask(
        'prerequisite',
        {
          relations: [
            {
              task: { id: 'target', reference: '#2', title: 'Target' },
              relation_type: 'blocking',
            },
          ],
        },
        'done',
      ),
      graphTask('target'),
    ];
    const graph = projectExecutionGraph(tasks);
    const layout = await layoutExecutionGraph(graph);
    expect(layout.positions.prerequisite?.y).toBeGreaterThan(layout.frontierY);
    expect(layout.positions.target?.y).toBeLessThan(layout.frontierY);
    expect(
      await layoutExecutionGraph(
        projectExecutionGraph(
          tasks.map((task) => ({ ...task, title: 'Changed' })),
        ),
      ),
    ).toEqual(layout);
    expect(
      visibleGraph(graph, { ...defaultGraphViewSettings, showCompleted: false })
        .edges,
    ).toHaveLength(0);
  });

  it('handles independent hierarchy/dependency cycles and a 250-node synthetic graph without overlap', async () => {
    const tasks = Array.from({ length: 250 }, (_, index) =>
      graphTask(
        `task-${String(index).padStart(3, '0')}`,
        index
          ? {
              relations: [
                {
                  task: {
                    id: `task-${String(index - 1).padStart(3, '0')}`,
                    reference: `#${index}`,
                    title: 'Previous',
                  },
                  relation_type: 'blocked_by',
                },
              ],
            }
          : {},
      ),
    );
    const layout = await layoutExecutionGraph(projectExecutionGraph(tasks));
    expect(Object.keys(layout.positions)).toHaveLength(250);
    expect(
      new Set(Object.values(layout.positions).map(({ x, y }) => `${x},${y}`))
        .size,
    ).toBe(250);
    const mixed = projectExecutionGraph([
      graphTask('a', {
        parent: { id: 'b', reference: '#2', title: 'B' },
        relations: [
          {
            task: { id: 'b', reference: '#2', title: 'B' },
            relation_type: 'blocked_by',
          },
        ],
      }),
      graphTask('b'),
    ]);
    expect(
      Object.keys((await layoutExecutionGraph(mixed)).positions),
    ).toHaveLength(2);
  });
});
