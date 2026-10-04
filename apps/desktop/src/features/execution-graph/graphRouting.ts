import type { GraphPosition } from './graphLayout';

interface GraphObstacle extends GraphPosition {
  width: number;
  height: number;
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
    const blocked = obstacles.some((obstacle) => {
      const left = obstacle.x - 12;
      const right = obstacle.x + obstacle.width + 12;
      const top = obstacle.y - 12;
      const bottom = obstacle.y + obstacle.height + 12;
      return (
        Math.max(from.x, to.x) > left &&
        Math.min(from.x, to.x) < right &&
        Math.max(from.y, to.y) > top &&
        Math.min(from.y, to.y) < bottom
      );
    });
    if (blocked) return points;
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
