import { describe, expect, it } from 'vitest';
import { straightenEndpointJogs } from './graphRouting';

const route = [
  { x: 596, y: 516 },
  { x: 596, y: 492 },
  { x: 597, y: 492 },
  { x: 597, y: 324 },
  { x: 445, y: 324 },
  { x: 445, y: 252 },
];

describe('Graph endpoint routing', () => {
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
