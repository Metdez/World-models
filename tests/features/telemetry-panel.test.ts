/** Telemetry card helpers: history window + same-position ghost, static loads, layout, painters (2 and 4 corners). */
import { describe, expect, it } from 'vitest';
import { createTelemetryFrame, type CornerLayout, type TelemetryFrame } from '../../src/contracts/telemetry';
import { G } from '../../src/contracts/units';
import { drawCorner, drawGg, drawSpark, GgTrail, type Palette, type Surface } from '../../src/features/telemetry-panel/draw';
import { History, METRICS } from '../../src/features/telemetry-panel/history';
import { cornerCell, DISPLAY, interp, staticLoads } from '../../src/features/telemetry-panel/index';

const CAR: CornerLayout[] = [
  { id: 'fl', axle: 'front', side: 1 },
  { id: 'fr', axle: 'front', side: -1 },
  { id: 'rl', axle: 'rear', side: 1 },
  { id: 'rr', axle: 'rear', side: -1 },
];
const MOTO: CornerLayout[] = [
  { id: 'f', axle: 'front', side: 0 },
  { id: 'r', axle: 'rear', side: 0 },
];

function frame(layout: CornerLayout[], s: number, camber: number): TelemetryFrame {
  const t = createTelemetryFrame(layout.length === 2 ? 'motorcycle' : 'car', layout);
  t.s = s;
  t.corners.forEach((c, i) => {
    c.camber = camber + i * 0.001;
    c.travel = 0.01 * i;
    c.load = 3000 + i;
  });
  return t;
}

const CAMBER = METRICS.indexOf('camber');

describe('History', () => {
  it('keeps the newest samples in order and wraps', () => {
    const h = new History(4, 100, 'a', 5, 100);
    for (let i = 0; i < 8; i++) h.push(frame(CAR, i, i));
    expect(h.count).toBe(5);
    expect([0, 1, 2, 3, 4].map((k) => h.liveAt(k, 0, CAMBER))).toEqual([3, 4, 5, 6, 7]);
    h.resetWindow();
    expect(h.count).toBe(0);
  });

  it('ghost = previous suspension at the SAME track position, not the previous seconds', () => {
    const h = new History(4, 100, 'a', 10, 100);
    for (let s = 0; s < 50; s++) h.push(frame(CAR, s, -0.01)); // suspension a drives s = 0..49
    expect(h.hasGhost).toBe(false);
    h.setSuspension('b', 'a');
    expect(h.hasGhost).toBe(true);
    h.resetWindow(); // e.g. a seek back to s = 20
    for (let s = 20; s < 25; s++) h.push(frame(CAR, s, -0.03));
    expect(h.liveAt(4, 0, CAMBER)).toBeCloseTo(-0.03);
    expect(h.ghostAt(4, 0, CAMBER)).toBeCloseTo(-0.01);
    // where suspension a never drove there is no ghost (a gap, never a guess)
    h.resetWindow();
    h.push(frame(CAR, 80, -0.03));
    expect(Number.isNaN(h.ghostAt(0, 0, CAMBER))).toBe(true);
  });

  it('fills small bin gaps at speed and wraps s around the lap', () => {
    const h = new History(2, 100, 'a', 10, 100);
    h.push(frame(MOTO, 10, -0.02));
    h.push(frame(MOTO, 14, -0.02)); // 4 bins skipped -> filled
    h.setSuspension('b', 'a');
    h.push(frame(MOTO, 112, 0)); // s wraps to 12
    expect(h.ghostAt(0, 0, CAMBER)).toBeCloseTo(-0.02);
  });
});

describe('panel helpers', () => {
  it('static loads split weight by CG position and corners per axle', () => {
    const car = staticLoads(frame(CAR, 0, 0), 1000, 2.5, 1);
    expect(car[0]).toBeCloseTo((G * 1000 * 0.6) / 2);
    expect(car[3]).toBeCloseTo((G * 1000 * 0.4) / 2);
    const moto = staticLoads(frame(MOTO, 0, 0), 200, 1.4, 0.7);
    expect(moto[0]! + moto[1]!).toBeCloseTo(G * 200);
  });

  it('interpolates the camber curve at zero travel and clamps outside', () => {
    const xs = Float64Array.of(-0.1, 0, 0.1);
    const ys = Float64Array.of(0.02, -0.01, -0.03);
    expect(interp(xs, ys, 0)).toBeCloseTo(-0.01);
    expect(interp(xs, ys, 0.05)).toBeCloseTo(-0.02);
    expect(interp(xs, ys, 1)).toBeCloseTo(-0.03);
  });

  it('lays corners out as the car seen from above, nose up', () => {
    expect(CAR.map((c) => cornerCell(c.axle, c.side, true))).toEqual([
      { row: 1, col: 1 },
      { row: 1, col: 2 },
      { row: 2, col: 1 },
      { row: 2, col: 2 },
    ]);
    expect(MOTO.map((c) => cornerCell(c.axle, c.side, false))).toEqual([
      { row: 1, col: 1 },
      { row: 2, col: 1 },
    ]);
  });

  it('displays TRUE SI values in readout units', () => {
    expect(DISPLAY.camber.convert(-Math.PI / 180)).toBeCloseTo(-1);
    expect(DISPLAY.travel.convert(0.012)).toBeCloseTo(12);
    expect(DISPLAY.load.convert(4200)).toBeCloseTo(4.2);
  });
});

/** Minimal 2D context: records calls, ignores everything else. */
function fakeSurface(w: number, h: number): Surface & { calls: string[] } {
  const calls: string[] = [];
  const g = new Proxy({} as Record<string, unknown>, {
    get: (target, key: string) => (key in target ? target[key] : (...args: unknown[]) => calls.push(`${key}(${args.map((a) => (typeof a === 'number' ? a.toFixed(1) : '')).join(',')})`)),
    set: (target, key: string, v) => ((target[key] = v), true),
  }) as unknown as CanvasRenderingContext2D;
  const canvas = { width: 0, height: 0 } as HTMLCanvasElement;
  return { canvas, g, w, h, dpr: 0, calls };
}

const P: Palette = { text1: 'a', text2: 'b', text3: 'c', hair: 'd', hairStrong: 'e', accent: 'f', warn: 'g' };

describe('painters', () => {
  it('scale the backing store to DPR 2 and draw g-g, corners and the spark for a 2-corner frame', () => {
    const gg = fakeSurface(84, 84);
    const trail = new GgTrail(5);
    trail.push(0.8, -0.2);
    drawGg(gg, P, 2, trail, true);
    expect(gg.canvas.width).toBe(168);
    expect(gg.calls.filter((c) => c.startsWith('arc')).length).toBe(3); // two rings + the dot

    const corner = fakeSurface(64, 30);
    drawCorner(corner, P, 1, { camber: -0.03, staticCamber: -0.02, side: 0, travel: 0.02, bump: 0.08, droop: 0.08, loadRatio: 1.2, stop: 0 });
    expect(corner.calls).toContain('fillRect(52.5,10.0,10.0,10.0)');

    const h = new History(2, 100, 'a', 10, 100);
    for (let s = 0; s < 10; s++) h.push(frame(MOTO, s, -0.02 - s * 0.001));
    h.setSuspension('b', 'a');
    for (let s = 0; s < 5; s++) h.push(frame(MOTO, s, -0.04));
    const spark = fakeSurface(290, 44);
    const scale = { lo: 0, hi: 0 };
    drawSpark(spark, P, 1, h, 1, CAMBER, -0.02, 0.0175, scale);
    expect(scale.hi).toBeGreaterThan(scale.lo);
    expect(spark.calls.filter((c) => c === 'stroke()').length).toBe(3); // reference, ghost, live
  });
});
