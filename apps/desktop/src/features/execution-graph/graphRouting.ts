import type { GraphPosition } from './graphLayout';

interface GraphObstacle extends GraphPosition {
  width: number;
  height: number;
}

function clearsObstacles(
  from: GraphPosition,
  to: GraphPosition,
  obstacles: GraphObstacle[],
) {
  return !obstacles.some(
    (obstacle) =>
      Math.max(from.x, to.x) > obstacle.x - 12 &&
      Math.min(from.x, to.x) < obstacle.x + obstacle.width + 12 &&
      Math.max(from.y, to.y) > obstacle.y - 12 &&
      Math.min(from.y, to.y) < obstacle.y + obstacle.height + 12,
  );
}

export function retargetRoute(
  points: GraphPosition[],
  source: GraphPosition,
  target: GraphPosition,
  obstacles: GraphObstacle[],
): GraphPosition[] | null {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return null;
  let shifted: GraphPosition[];
  if (points.every((point) => point.x === first.x)) {
    const middleY = (source.y + target.y) / 2;
    shifted = [
      source,
      { x: source.x, y: middleY },
      { x: target.x, y: middleY },
      target,
    ];
  } else {
    shifted = points.map((point) => ({ ...point }));
    for (
      let index = 0;
      index < points.length && points[index]?.x === first.x;
      index += 1
    ) {
      const point = shifted[index];
      if (point) point.x = source.x;
    }
    for (
      let index = points.length - 1;
      index >= 0 && points[index]?.x === last.x;
      index -= 1
    ) {
      const point = shifted[index];
      if (point) point.x = target.x;
    }
    shifted[0] = source;
    shifted[shifted.length - 1] = target;
  }
  shifted = shifted.filter(
    (point, index) =>
      point.x !== shifted[index - 1]?.x || point.y !== shifted[index - 1]?.y,
  );
  const departure = shifted[1];
  const arrival = shifted.at(-2);
  if (
    !departure ||
    !arrival ||
    departure.y >= source.y ||
    arrival.y <= target.y
  )
    return null;
  for (let index = 1; index < shifted.length; index += 1) {
    const start = shifted[index - 1];
    const end = shifted[index];
    if (
      !start ||
      !end ||
      (start.x !== end.x && start.y !== end.y) ||
      !clearsObstacles(start, end, obstacles)
    )
      return null;
  }
  return shifted;
}

export function parallelRoute(
  points: GraphPosition[],
  spacing: number,
  obstacles: GraphObstacle[],
): GraphPosition[] | null {
  const normals = points.slice(1).map((end, index) => {
    const start = points[index];
    if (!start || (start.x !== end.x && start.y !== end.y)) return null;
    return { x: -Math.sign(end.y - start.y), y: Math.sign(end.x - start.x) };
  });
  if (!normals.length || normals.some((normal) => !normal)) return null;
  const shifted = points.map((point, index) => {
    const before = normals[index - 1];
    const after = normals[index];
    return {
      x: point.x + spacing * (before?.x || after?.x || 0),
      y: point.y + spacing * (before?.y || after?.y || 0),
    };
  });
  for (let index = 1; index < shifted.length; index += 1) {
    const start = shifted[index - 1];
    const end = shifted[index];
    const originalStart = points[index - 1];
    const originalEnd = points[index];
    if (!start || !end || !originalStart || !originalEnd) return null;
    const direction =
      (end.x - start.x) * (originalEnd.x - originalStart.x) +
      (end.y - start.y) * (originalEnd.y - originalStart.y);
    if (
      (start.x !== end.x && start.y !== end.y) ||
      direction <= 0 ||
      !clearsObstacles(start, end, obstacles)
    )
      return null;
  }
  return shifted;
}

function straightenStart(points: GraphPosition[], obstacles: GraphObstacle[]) {
  const [start, first, second, third, fourth] = points;
  if (!start || !first || !second || !third || !fourth) return points;
  const along = start.x === first.x ? 'y' : 'x';
  const across = along === 'y' ? 'x' : 'y';
  const jog = Math.abs(first[across] - second[across]);
  if (
    jog === 0 ||
    jog > 2 ||
    start[across] !== first[across] ||
    first[along] !== second[along] ||
    second[across] !== third[across] ||
    third[along] !== fourth[along] ||
    (first[along] - start[along]) * (third[along] - second[along]) <= 0
  )
    return points;
  const corner = { ...third, [across]: start[across] };
  for (const [from, to] of [
    [start, corner],
    [corner, fourth],
  ]) {
    if (!clearsObstacles(from, to, obstacles)) return points;
  }
  return [start, corner, ...points.slice(4)];
}

export function straightenEndpointJogs(
  points: GraphPosition[],
  obstacles: GraphObstacle[],
) {
  const fromSource = straightenStart(points, obstacles);
  return straightenStart([...fromSource].reverse(), obstacles).reverse();
}
