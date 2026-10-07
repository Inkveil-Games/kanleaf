import { describe, expect, it } from 'vitest';
import { graphRows } from './graphRows';

describe('Graph row spacing', () => {
  it('uses a uniform rank formula without scaling task heights or crossing routes', () => {
    const rows = graphRows([32, 176, 176, 352], 72, 72);
    expect(rows.step).toBe(176);
    expect([32, 176, 352].map(rows.mapY)).toEqual([32, 208, 384]);
    expect([104, 248, 424].map(rows.mapY)).toEqual([104, 280, 456]);
    expect(rows.mapY(140)).toBe(156);
    expect(rows.mapY(300)).toBe(332);
  });

  it('leaves empty and single-row layouts unchanged', () => {
    expect(graphRows([], 72, 72).mapY(100)).toBe(100);
    expect(graphRows([32], 72, 72).mapY(104)).toBe(104);
  });
});
