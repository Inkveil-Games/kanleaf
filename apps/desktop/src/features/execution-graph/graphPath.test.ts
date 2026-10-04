import { describe, expect, it } from 'vitest';
import { pairedCornerRadii, roundedGraphPath } from './graphPath';
import { parallelRoute } from './graphRouting';

describe('Concentric graph corners', () => {
  it.each([-100, 100])(
    'uses concentric inner and outer arcs when turning toward %s',
    (targetX) => {
      const base = [
        { x: 0, y: 200 },
        { x: 0, y: 100 },
        { x: targetX, y: 100 },
        { x: targetX, y: 0 },
      ];
      const paired = parallelRoute(base, 12, []);
      if (!paired) throw new Error('Missing paired route');
      const radii = pairedCornerRadii(base, paired, 12);
      if (!radii) throw new Error('Missing corner radii');
      expect(radii.base[1]).toBe(24);
      expect(radii.paired[1]).toBe(targetX > 0 ? 12 : 36);
      expect(radii.paired[2]).toBe(targetX > 0 ? 36 : 12);
      const sign = Math.sign(targetX);
      const baseCenter = { x: sign * radii.base[1], y: 100 + radii.base[1] };
      const pairedCenter = {
        x: 12 + sign * radii.paired[1],
        y: 100 + sign * 12 + radii.paired[1],
      };
      expect(pairedCenter).toEqual(baseCenter);
      expect(roundedGraphPath(base, radii.base)).toContain(' A 24 24 ');
      expect(roundedGraphPath(base, radii.base)).not.toContain(' Q ');
    },
  );

  it('reduces both radii together on short segments without losing their offset', () => {
    const base = [
      { x: 0, y: 36 },
      { x: 0, y: 0 },
      { x: -100, y: 0 },
      { x: -100, y: -36 },
    ];
    const paired = parallelRoute(base, 12, []);
    if (!paired) throw new Error('Missing route');
    const radii = pairedCornerRadii(base, paired, 12);
    if (!radii) throw new Error('Missing radii');
    expect(radii.paired[1] - radii.base[1]).toBe(12);
    expect(radii.base[1]).toBeLessThanOrEqual(18);
    expect(radii.paired[1]).toBeLessThanOrEqual(24);
  });
});
