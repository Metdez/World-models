import { describe, expect, it } from 'vitest';
import { DEG_TO_RAD } from '../../src/contracts/units';
import { camberToRoad, gripUse, peakMu } from '../../src/sim-core/ride/tyre';
import { TYRE, syntheticCurves } from '../fixtures/02-03-ride';

describe('tyre grip-use indicator (model)', () => {
  it('is |F| / (mu(Fz) * Fz): 0 without demand, 1 at the modelled peak', () => {
    expect(gripUse(4200, 0, 0, 0, TYRE)).toBe(0);
    expect(gripUse(4200, 1.1 * 4200, 0, 0, TYRE)).toBeCloseTo(1, 12);
    expect(gripUse(4200, 3000, 4000, 0, TYRE)).toBeCloseTo(5000 / (1.1 * 4200), 12);
  });

  it('is monotone in |fy| and symmetric in sign', () => {
    let prev = -1;
    for (let fy = 0; fy <= 8000; fy += 250) {
      const u = gripUse(4000, fy, 500, -0.02, TYRE);
      expect(u).toBeGreaterThan(prev);
      expect(gripUse(4000, -fy, 500, -0.02, TYRE)).toBe(u);
      prev = u;
    }
  });

  it('peak mu falls with load (load sensitivity) and with |camber to road| beyond 3°, flat within ±3°', () => {
    expect(peakMu(6200, 0, TYRE)).toBeCloseTo(1.1 - 5e-5 * 2000, 12);
    expect(peakMu(2200, 0, TYRE)).toBeGreaterThan(peakMu(4200, 0, TYRE));
    expect(peakMu(4200, 3 * DEG_TO_RAD, TYRE)).toBe(peakMu(4200, 0, TYRE));
    expect(peakMu(4200, -2.5 * DEG_TO_RAD, TYRE)).toBe(peakMu(4200, 0, TYRE));
    expect(peakMu(4200, 5 * DEG_TO_RAD, TYRE)).toBeCloseTo(1.1 * (1 - 0.04), 12);
    let prev = Infinity;
    for (let deg = 3.5; deg <= 10; deg += 0.5) {
      const u = gripUse(4200, 3000, 0, -deg * DEG_TO_RAD, TYRE);
      expect(u).toBeLessThan(Infinity);
      expect(peakMu(4200, deg * DEG_TO_RAD, TYRE)).toBeLessThan(prev);
      prev = peakMu(4200, deg * DEG_TO_RAD, TYRE);
    }
    expect(gripUse(4200, 3000, 0, 6 * DEG_TO_RAD, TYRE)).toBeGreaterThan(gripUse(4200, 3000, 0, 0, TYRE));
  });

  it('an unloaded tyre asked for force is beyond its limit; mu never collapses under huge load', () => {
    expect(gripUse(0, 100, 0, 0, TYRE)).toBe(Infinity);
    expect(gripUse(0, 0, 0, 0, TYRE)).toBe(0);
    expect(peakMu(1e6, 0, TYRE)).toBeCloseTo(0.11, 12);
  });

  it('camber to road from per-type curves: roll + (left up) adds negative camber on the left, positive on the right', () => {
    const curves = syntheticCurves(-0.4 * DEG_TO_RAD / 0.01, 0.1);
    const roll = 1 * DEG_TO_RAD;
    // Left turn: outer (right) wheel in bump 20 mm, inner (left) in droop 20 mm.
    const right = camberToRoad(curves, 0.02, roll, false);
    const left = camberToRoad(curves, -0.02, roll, true);
    expect(right).toBeCloseTo(-0.026 - 0.8 * DEG_TO_RAD + roll, 12);
    expect(left).toBeCloseTo(-0.026 + 0.8 * DEG_TO_RAD - roll, 12);
  });
});
