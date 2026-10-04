import type { GraphPosition } from './graphLayout';

export function roundedGraphPath(points: GraphPosition[]) {
  const first = points[0];
  if (!first) return '';
  let path = `M ${first.x} ${first.y}`;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];
    if (!previous || !corner) continue;
    const incoming = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const outgoing = next
      ? Math.hypot(next.x - corner.x, next.y - corner.y)
      : 0;
    const radius = Math.min(12, incoming / 2, outgoing / 2);
    if (!next || !radius || previous.x === next.x || previous.y === next.y) {
      path += ` L ${corner.x} ${corner.y}`;
      continue;
    }
    const before = {
      x: corner.x + ((previous.x - corner.x) * radius) / incoming,
      y: corner.y + ((previous.y - corner.y) * radius) / incoming,
    };
    const after = {
      x: corner.x + ((next.x - corner.x) * radius) / outgoing,
      y: corner.y + ((next.y - corner.y) * radius) / outgoing,
    };
    path += ` L ${before.x} ${before.y} Q ${corner.x} ${corner.y} ${after.x} ${after.y}`;
  }
  return path;
}
