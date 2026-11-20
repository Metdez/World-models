/**
 * 04-04 teaching overlays: geometry helpers, construction lines from live simulation frames (all three car types,
 * true scale and amplified), far / non-finite instant centres, a 2-corner motorcycle frame, and zero allocation.
 */
import { describe, expect, it } from 'vitest';
import type { SimCatalog } from '../../src/contracts/sim';
import type { MotorcycleSuspensionDefinition } from '../../src/contracts/suspension';
import { createTelemetryFrame, type TelemetryFrame } from '../../src/contracts/telemetry';
import type { MotorcycleDefinition } from '../../src/contracts/vehicle';
import { buildRig, closestT, createConstruction, fadeAt, LINE_MAX, planeIntersection, type OverlaySim } from '../../src/features/teaching-overlays/construction';
import { createLineBatch, type LineBatch } from '../../src/features/teaching-overlays/lines';
import { drawNumber, plotOf, plotRange } from '../../src/features/teaching-overlays/trace';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { doubleWishbone } from '../../src/sim-core/content/susp-double-wishbone';
import { macpherson } from '../../src/sim-core/content/susp-macpherson';
import { multilink } from '../../src/sim-core/content/susp-multilink';
import { createSimulation } from '../../src/sim-core/index';

const catalog: SimCatalog = { track: () => undefined, vehicle: () => undefined, suspension: () => undefined };
const v = (x: number, y: number, z: number) => Float64Array.of(x, y, z);
const batches = () => ({
  main: createLineBatch({ capacity: 1600, width: 2, casing: 5, renderOrder: 1, name: 'main' }),
  ghost: createLineBatch({ capacity: 600, width: 1.5, casing: 0, opacity: 0.5, renderOrder: 0, name: 'ghost' }),
});
const allFinite = (b: LineBatch) => b.positions.subarray(0, b.count * 6).every(Number.isFinite);

describe('geometry helpers', () => {
  it('intersects two planes and rejects parallel ones', () => {
    const p = v(0, 0, 0);
    const d = v(0, 0, 0);
    // z = 1 and x = 2 meet in the line (2, t, 1)
    expect(planeIntersection(v(0, 0, 1), 1, v(1, 0, 0), 2, p, d)).toBe(true);
    expect(Math.abs(d[1]!)).toBeCloseTo(1);
    expect(p[0]).toBeCloseTo(2);
    expect(p[2]).toBeCloseTo(1);
    expect(planeIntersection(v(0, 0, 1), 1, v(0, 0, 2), 5, p, d)).toBe(false);
    expect(closestT(v(0, 0, 0), v(1, 0, 0), v(3, 4, 0))).toBe(3);
  });

  it('fades only the end of a clamped line', () => {
    expect(fadeAt(1, 2, false)).toBe(1);
    expect(fadeAt(0.5, 2, true)).toBe(1);
    expect(fadeAt(2, 2, true)).toBe(0);
    expect(fadeAt(1.8, 2, true)).toBeGreaterThan(0);
  });

  it('draws numbers glyph by glyph with a true minus and no -0', () => {
    const out: string[] = [];
    const g = { fillText: (s: string) => void out.unshift(s) };
    drawNumber(g, -12.34, 1, 100, 0, 6);
    expect(out.join('')).toBe('−12.3');
    out.length = 0;
    drawNumber(g, -0.04, 1, 100, 0, 6);
    expect(out.join('')).toBe('0.0');
    out.length = 0;
    drawNumber(g, 106.4, 0, 100, 0, 6);
    expect(out.join('')).toBe('106');
    out.length = 0;
    drawNumber(g, Number.NaN, 0, 100, 0, 6);
    expect(out.join('')).toBe('—');
  });

  it('plot range covers current and previous curves and survives empty/NaN input', () => {
    const sim = createSimulation({ catalog, trackId: 'proving-loop', vehicleId: gtCoupe.id, suspensionId: 'macpherson' });
    const a = plotOf(sim.kinematics().rear.curves, 'camber');
    sim.setSuspension('double-wishbone');
    const b = plotOf(sim.kinematics().rear.curves, 'camber');
    const [x0, x1, y0, y1] = plotRange([a, b], 1);
    expect(x0).toBeLessThan(0);
    expect(x1).toBeGreaterThan(0);
    for (const p of [a, b]) for (const y of p.value) if (Number.isFinite(y)) expect(y >= y0 && y <= y1).toBe(true);
    expect(y1 - y0).toBeGreaterThanOrEqual(1);
    expect(plotRange([null, { travel: Float64Array.of(Number.NaN), value: Float64Array.of(Number.NaN) }], 1).every(Number.isFinite)).toBe(true);
  });
});

describe('construction from live frames', () => {
  const DEFS = [macpherson, doubleWishbone, multilink] as const;

  it.each(DEFS.map((d) => [d.id] as const))('%s: finite lines, arm planes meet the instant centre (true scale and x2.5)', (id) => {
    const sim = createSimulation({ catalog, trackId: 'proving-loop', vehicleId: gtCoupe.id, suspensionId: id });
    const { main, ghost } = batches();
    const c = createConstruction(main, ghost);
    let worstMiss = 0;
    for (const amp of [1, 2.5]) {
      for (const lt of [5, 9.75, 20, 51.65]) {
        sim.seek(lt);
        for (let k = 0; k < 24; k++) sim.step(1 / 240);
        const t = sim.sample(1, amp);
        c.draw(t, sim, 1 / 60);
        expect(main.count).toBeGreaterThan(40);
        expect(ghost.count).toBeGreaterThan(40);
        expect(allFinite(main) && allFinite(ghost)).toBe(true);
        worstMiss = Math.max(worstMiss, armMiss(t, sim));
      }
    }
    console.log(`${id}: worst arm-plane line miss from the sim IC: ${(worstMiss * 1000).toFixed(1)} mm`);
    // A-arm / strut planes cut the front-view plane in lines through the IC (the sim's IC is the velocity solution).
    expect(worstMiss).toBeLessThan(0.02);
  });

  it('clamps far instant centres and skips non-finite ones without NaN', () => {
    const sim = createSimulation({ catalog, trackId: 'proving-loop', vehicleId: gtCoupe.id, suspensionId: 'double-wishbone' });
    const { main, ghost } = batches();
    const c = createConstruction(main, ghost);
    const t = sim.sample(1, 1);
    const fl = t.corners[0]!;
    const cp = { ...fl.contactPatch };
    Object.assign(fl.instantCentre, { x: cp.x, y: cp.y - 1000, z: cp.z + 0.3 }); // parallel arms: IC at IC_FAR
    c.draw(t, sim, 1 / 60);
    expect(allFinite(main)).toBe(true);
    // every vertex stays near the car (no 1000 m line)
    const b = t.bodyPosition;
    for (let i = 0; i < main.count * 2; i++) {
      const x = main.positions[3 * i]!;
      const z = -main.positions[3 * i + 2]!;
      expect(Math.hypot(x - b.x, z - b.y)).toBeLessThan(LINE_MAX + 2);
    }
    Object.assign(fl.instantCentre, { x: Number.NaN, y: Number.POSITIVE_INFINITY, z: 0 });
    Object.assign(t.axles[0]!.rollCentre, { x: Number.NaN });
    c.draw(t, sim, 1 / 60);
    expect(allFinite(main) && allFinite(ghost)).toBe(true);
    expect(main.count).toBeGreaterThan(20);
  });

  it('draws a 2-corner (motorcycle) frame: force lines, load arrows, rest-point markers, no roll centre', () => {
    const frame = motoFrame();
    const sim = motoSim();
    const { main, ghost } = batches();
    const c = createConstruction(main, ghost);
    c.draw(frame, sim, 1 / 60);
    expect(main.count).toBeGreaterThan(10);
    expect(ghost.count).toBe(2 * 2 * 3); // 3 rest points per corner, a cross each
    expect(allFinite(main) && allFinite(ghost)).toBe(true);
  });

  it('draw() allocates nothing', () => {
    const gc = (globalThis as { gc?: () => void }).gc;
    if (!gc) return;
    const sim = createSimulation({ catalog, trackId: 'proving-loop', vehicleId: gtCoupe.id, suspensionId: 'multilink' });
    const { main, ghost } = batches();
    const c = createConstruction(main, ghost);
    sim.seek(20);
    const t = sim.sample(1, 2.5);
    const restPose = sim.restPose.bind(sim);
    const view: OverlaySim = { suspension: sim.suspension, vehicle: sim.vehicle, restPose };
    for (let i = 0; i < 3000; i++) c.draw(t, view, 1 / 60);
    gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 20000; i++) c.draw(t, view, 1 / 60);
    gc();
    const delta = process.memoryUsage().heapUsed - before;
    console.log(`construction.draw(): heap delta over 20000 calls ${delta} B`);
    expect(delta).toBeLessThan(64 * 1024);
  });
});

/** Worst distance (any corner) between the sim's IC and an A-arm / strut plane line in the front-view plane. */
function armMiss(t: TelemetryFrame, sim: OverlaySim): number {
  let worst = 0;
  const q = t.bodyRotation;
  const ex = v(1 - 2 * (q.y * q.y + q.z * q.z), 2 * (q.x * q.y + q.w * q.z), 2 * (q.x * q.z - q.w * q.y));
  for (const fc of t.corners) {
    const rig = rigOf(fc, sim);
    const P = (i: number) => v(fc.points[3 * i]!, fc.points[3 * i + 1]!, fc.points[3 * i + 2]!);
    const cp = v(fc.contactPatch.x, fc.contactPatch.y, fc.contactPatch.z);
    const ic = v(fc.instantCentre.x, fc.instantCentre.y, fc.instantCentre.z);
    const icDist = Math.hypot(ic[0]! - cp[0]!, ic[1]! - cp[1]!, ic[2]! - cp[2]!);
    if (icDist > 50) continue; // near-parallel planes: direction matters, not the far point
    for (let k = 0; k < rig.planeCount; k++) {
      const [kind, a, b, c] = rig.planes.subarray(4 * k, 4 * k + 4);
      let n: Float64Array;
      let pt: Float64Array;
      if (kind === 0) {
        const A = P(a!);
        const u = P(b!).map((x, j) => x - A[j]!);
        const w = P(c!).map((x, j) => x - A[j]!);
        n = v(u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!);
        pt = A;
      } else {
        const L = P(a!);
        pt = P(b!);
        n = pt.map((x, j) => x - L[j]!);
      }
      const p = v(0, 0, 0);
      const d = v(0, 0, 0);
      const h1 = n[0]! * pt[0]! + n[1]! * pt[1]! + n[2]! * pt[2]!;
      const h2 = ex[0]! * cp[0]! + ex[1]! * cp[1]! + ex[2]! * cp[2]!;
      expect(planeIntersection(n, h1, ex, h2, p, d)).toBe(true);
      const s = closestT(p, d, ic);
      const miss = Math.hypot(p[0]! + d[0]! * s - ic[0]!, p[1]! + d[1]! * s - ic[1]!, p[2]! + d[2]! * s - ic[2]!);
      worst = Math.max(worst, miss / Math.max(1, icDist)); // relative beyond 1 m
    }
  }
  return worst;
}

type Rig = Parameters<typeof buildRig>[0];
function rigOf(fc: TelemetryFrame['corners'][number], sim: OverlaySim): Rig {
  const rig = {
    order: null,
    suspension: null,
    wheel: -1,
    frame: new Int32Array(3),
    planes: new Int32Array(16),
    planeCount: 0,
    links: new Int32Array(24),
    linkCount: 0,
    spring: new Int32Array(4),
    springFraction: 0,
    tyreRadius: 0,
    tyreWidth: 0,
    nominalLoad: 0,
  } as Rig;
  buildRig(rig, fc, sim);
  return rig;
}

function motoFrame(): TelemetryFrame {
  const t = createTelemetryFrame('motorcycle', [
    { id: 'f', axle: 'front', side: 0 },
    { id: 'r', axle: 'rear', side: 0 },
  ]);
  t.corners.forEach((c, i) => {
    const x = i === 0 ? 0.7 : -0.7;
    c.pointOrder = ['wheelCentre', 'pivot', 'axle'];
    c.points.set([x, 0, 0.3, x * 0.2, 0, 0.45, x, 0, 0.3]);
    Object.assign(c.contactPatch, { x, y: 0, z: 0 });
    Object.assign(c.wheelPosition, { x, y: 0, z: 0.3 });
    Object.assign(c.instantCentre, i === 0 ? { x: Number.NaN, y: 0, z: 0 } : { x: -0.1, y: 0, z: 0.45 });
    c.load = 900;
    c.gripUse = 0.9;
  });
  return t;
}

function motoSim(): OverlaySim {
  const tyre = { radius: 0.3, width: 0.15, verticalStiffness: 2e5, verticalDamping: 100, mu: 1.2, loadSensitivity: -1e-5, nominalLoad: 1000 };
  return {
    suspension: { vehicleClass: 'motorcycle' } as MotorcycleSuspensionDefinition,
    vehicle: { class: 'motorcycle', front: { tyre }, rear: { tyre } } as unknown as MotorcycleDefinition,
    restPose: (i, out) => {
      out.set(motoFrame().corners[i]!.points.subarray(0, 9));
      return out;
    },
  };
}
