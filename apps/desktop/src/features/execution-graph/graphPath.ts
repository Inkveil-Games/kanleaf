import type { GraphPosition } from './graphLayout';

export function pairedCornerRadii(
  base: GraphPosition[],
  paired: GraphPosition[],
  spacing: number,
) {
  if (base.length !== paired.length) return null;
  const radii = { base: base.map(() => 0), paired: paired.map(() => 0) };
  for (let index = 1; index < base.length - 1; index += 1) {
    const previous = base[index - 1];
    const corner = base[index];
    const next = base[index + 1];
    const pairedPrevious = paired[index - 1];
    const pairedCorner = paired[index];
    const pairedNext = paired[index + 1];
    if (
      !previous ||
      !corner ||
      !next ||
      !pairedPrevious ||
      !pairedCorner ||
      !pairedNext
    )
      return null;
    const turn = Math.sign(
      (corner.x - previous.x) * (next.y - corner.y) -
        (corner.y - previous.y) * (next.x - corner.x),
    );
    if (!turn) continue;
    const adjustment = -turn * spacing;
    const radius = Math.min(
      24,
      Math.hypot(corner.x - previous.x, corner.y - previous.y) / 2,
      Math.hypot(next.x - corner.x, next.y - corner.y) / 2,
      Math.hypot(
        pairedCorner.x - pairedPrevious.x,
        pairedCorner.y - pairedPrevious.y,
      ) /
        2 -
        adjustment,
      Math.hypot(pairedNext.x - pairedCorner.x, pairedNext.y - pairedCorner.y) /
        2 -
        adjustment,
    );
    if (radius < 0 || radius + adjustment < 0) return null;
    radii.base[index] = radius;
    radii.paired[index] = radius + adjustment;
  }
  return radii;
}

export function roundedGraphPath(
  points: GraphPosition[],
  cornerRadii?: number[],
) {
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
    const radius = Math.min(
      cornerRadii?.[index] ?? 12,
      incoming / 2,
      outgoing / 2,
    );
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
    const turn =
      (corner.x - previous.x) * (next.y - corner.y) -
      (corner.y - previous.y) * (next.x - corner.x);
    path += ` L ${before.x} ${before.y} A ${radius} ${radius} 0 0 ${turn > 0 ? 1 : 0} ${after.x} ${after.y}`;
  }
  return path;
}
