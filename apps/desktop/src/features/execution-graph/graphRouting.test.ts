import { describe, expect, it } from 'vitest';
import { parallelRoute, straightenEndpointJogs } from './graphRouting';

const route = [
  { x: 596, y: 516 },
  { x: 596, y: 492 },
  { x: 597, y: 492 },
  { x: 597, y: 324 },
  { x: 445, y: 324 },
  { x: 445, y: 252 },
];

describe('Graph endpoint routing', () => {
  it('keeps paired lanes parallel around left and right bends', () => {
    for (const targetX of [-100, 100]) {
      const points = [
        { x: 0, y: 200 },
        { x: 0, y: 100 },
        { x: targetX, y: 100 },
        { x: targetX, y: 0 },
      ];
      expect(parallelRoute(points, 12, [])).toEqual([
        { x: 12, y: 200 },
        { x: 12, y: 100 + Math.sign(targetX) * 12 },
        { x: targetX + 12, y: 100 + Math.sign(targetX) * 12 },
        { x: targetX + 12, y: 0 },
      ]);
    }
  });

  it('rejects a parallel lane if it would cross another task or reverse a short segment', () => {
    expect(
      parallelRoute(
        [
          { x: 0, y: 100 },
          { x: 0, y: 0 },
        ],
        12,
        [{ x: 10, y: 40, width: 10, height: 10 }],
      ),
    ).toBeNull();
    expect(
      parallelRoute(
        [
          { x: 0, y: 100 },
          { x: 0, y: 90 },
          { x: 100, y: 90 },
          { x: 100, y: 0 },
        ],
        12,
        [],
      ),
    ).toBeNull();
  });
  it('removes a one-pixel endpoint dogleg without moving either port', () => {
    expect(straightenEndpointJogs(route, [])).toEqual([
      { x: 596, y: 516 },
      { x: 596, y: 324 },
      { x: 445, y: 324 },
      { x: 445, y: 252 },
    ]);
    expect(route).toHaveLength(6);
    expect(route[3]?.x).toBe(597);
  });

  it('handles mirrored, horizontal and target-side doglegs', () => {
    for (const transform of [
      (point: { x: number; y: number }) => ({ x: -point.x, y: point.y }),
      (point: { x: number; y: number }) => ({ x: point.y, y: point.x }),
    ]) {
      expect(straightenEndpointJogs(route.map(transform), [])).toEqual(
        straightenEndpointJogs(route, []).map(transform),
      );
    }
    expect(straightenEndpointJogs([...route].reverse(), [])).toEqual(
      straightenEndpointJogs(route, []).reverse(),
    );
  });

  it('preserves intentional lane changes and routes whose straightening would approach another task', () => {
    const intentional = route.map((point) => ({
      ...point,
      x: point.x === 597 ? 612 : point.x,
    }));
    expect(straightenEndpointJogs(intentional, [])).toEqual(intentional);
    expect(
      straightenEndpointJogs(route, [
        { x: 570, y: 380, width: 15, height: 40 },
      ]),
    ).toEqual(route);
  });

  it('does not move terminal points to straighten a short four-point path', () => {
    const short = route.slice(0, 4);
    expect(straightenEndpointJogs(short, [])).toEqual(short);
  });
});
