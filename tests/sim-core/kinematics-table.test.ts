/**
 * KIN-02 table properties for every linkage (reference sets + shipped definitions): closure at every grid node,
 * no NaN, smooth (no branch jumps), mirror symmetry, interpolation accuracy against exact solves, steering
 * inverse, allocation-free sampling, and timing.
 */
import { describe, expect, it } from 'vitest';
import type { AxleLinkage } from '../../src/contracts/suspension';
import { RAD_TO_DEG } from '../../src/contracts/units';
import { createLmSolver } from '../../src/sim-core/kinematics/lm';
import { compileLinkage } from '../../src/sim-core/kinematics/spatial';
import { createCornerSolution, solveAxleKinematics, RACK_STEP, TRAVEL_STEP, type KinematicsTable, type SolveOptions } from '../../src/sim-core/kinematics/table';
import * as q from '../../src/sim-core/math/quat';
import { createRng } from '../../src/sim-core/math/rng';
import { macpherson } from '../../src/sim-core/content/susp-macpherson';
import { doubleWishbone } from '../../src/sim-core/content/susp-double-wishbone';
import { multilink } from '../../src/sim-core/content/susp-multilink';
import { GT_GEOMETRY } from '../../src/sim-core/content/gt-geometry';
import { CHRONO_GENERIC_MACPHERSON, CHRONO_SEDAN_DOUBLE_WISHBONE, CHRONO_SEDAN_MULTILINK } from '../fixtures/02-02-chrono-sets';

interface Case {
  readonly name: string;
  readonly linkage: AxleLinkage;
  readonly opts: SolveOptions;
}

const base = { cgHeight: 0.5, wheelbase: GT_GEOMETRY.wheelbase };
const CASES: Case[] = [
  { name: 'chrono-dw', linkage: CHRONO_SEDAN_DOUBLE_WISHBONE.linkage, opts: { ...base, tyreRadius: CHRONO_SEDAN_DOUBLE_WISHBONE.tyreRadius, axle: 'front', maxSteer: 0.35, brakeShare: 0.62 } },
  { name: 'chrono-mp', linkage: CHRONO_GENERIC_MACPHERSON.linkage, opts: { ...base, tyreRadius: CHRONO_GENERIC_MACPHERSON.tyreRadius, axle: 'front', maxSteer: 0.35, brakeShare: 0.62 } },
  { name: 'chrono-ml', linkage: CHRONO_SEDAN_MULTILINK.linkage, opts: { ...base, tyreRadius: CHRONO_SEDAN_MULTILINK.tyreRadius, axle: 'rear', brakeShare: 0.38 } },
  ...[macpherson, doubleWishbone, multilink].flatMap((def) => [
    { name: `${def.id}-front`, linkage: def.axles.front, opts: { ...base, tyreRadius: GT_GEOMETRY.front.tyreRadius, axle: 'front', maxSteer: 0.35, brakeShare: 0.62 } } as Case,
    { name: `${def.id}-rear`, linkage: def.axles.rear, opts: { ...base, tyreRadius: GT_GEOMETRY.rear.tyreRadius, axle: 'rear', brakeShare: 0.38 } } as Case,
  ]),
];

const dist = (p: Float64Array, a: number, b: number) => Math.hypot(p[a * 3]! - p[b * 3]!, p[a * 3 + 1]! - p[b * 3 + 1]!, p[a * 3 + 2]! - p[b * 3 + 2]!);

/** Max constraint violation (m) of a sampled corner: rod lengths and strut alignment. */
function closureError(linkage: AxleLinkage, table: KinematicsTable, pts: Float64Array, rotation: { x: number; y: number; z: number; w: number }): number {
  const ix = (n: string) => table.pointOrder.indexOf(n);
  let err = 0;
  for (const c of linkage.constraints) {
    const u = ix(c.upright);
    const ch = ix(c.chassis);
    const p0u = linkage.points[c.upright]!;
    const p0c = linkage.points[c.chassis]!;
    if (c.kind === 'distance') {
      const L = Math.hypot(p0u[0] - p0c[0], p0u[1] - p0c[1], p0u[2] - p0c[2]);
      err = Math.max(err, Math.abs(dist(pts, u, ch) - L));
    } else {
      // Strut axis is upright-fixed: rotate the design axis and check (T - S) stays parallel to it.
      const axis = q.rotate([0, 0, 0], [rotation.x, rotation.y, rotation.z, rotation.w], [p0c[0] - p0u[0], p0c[1] - p0u[1], p0c[2] - p0u[2]]);
      const l = Math.hypot(...axis);
      const tx = pts[ch * 3]! - pts[u * 3]!;
      const ty = pts[ch * 3 + 1]! - pts[u * 3 + 1]!;
      const tz = pts[ch * 3 + 2]! - pts[u * 3 + 2]!;
      const cx = (ty * axis[2] - tz * axis[1]) / l;
      const cy = (tz * axis[0] - tx * axis[2]) / l;
      const cz = (tx * axis[1] - ty * axis[0]) / l;
      err = Math.max(err, Math.hypot(cx, cy, cz));
    }
  }
  return err;
}

const nodes = (lo: number, hi: number, step: number) => Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => lo + i * step);

describe.each(CASES)('$name', ({ linkage, opts }) => {
  const t0 = performance.now();
  const { table, kinematics } = solveAxleKinematics(linkage, opts);
  const buildMs = performance.now() - t0;
  const s = createCornerSolution(table);
  const travels = nodes(table.travelRange[0], table.travelRange[1], TRAVEL_STEP);
  const racks = table.rackRange[1] > 0 ? nodes(table.rackRange[0], table.rackRange[1], RACK_STEP) : [0];

  it('covers bump/droop + 20 mm and closes every grid node (no NaN, |error| < 1e-9 m)', () => {
    expect(table.travelRange[0]).toBeLessThanOrEqual(-linkage.travel.droop - 0.02 + 1e-12);
    expect(table.travelRange[1]).toBeGreaterThanOrEqual(linkage.travel.bump + 0.02 - 1e-12);
    let worst = 0;
    for (const t of travels) {
      for (const r of racks) {
        table.sample(t, r, s);
        for (const v of s.points) expect(Number.isFinite(v)).toBe(true);
        for (const v of [s.camber, s.toe, s.springLength, s.motionRatio, s.instantCentre.y, s.instantCentre.z]) expect(Number.isFinite(v)).toBe(true);
        expect(s.motionRatio).toBeGreaterThan(0);
        expect(Math.abs(s.wheelCentre.z - linkage.points.wheelCentre![2] - t)).toBeLessThan(1e-9);
        worst = Math.max(worst, closureError(linkage, table, s.points, s.rotation));
      }
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it('is smooth across the grid: no branch jumps (second differences of every point < 0.2 mm)', () => {
    const prev = createCornerSolution(table);
    const next = createCornerSolution(table);
    let worst = 0;
    const scan = (outer: number[], inner: number[], travelOuter: boolean) => {
      for (const a of outer) {
        for (let k = 1; k < inner.length - 1; k++) {
          const at = (b: number, out: typeof s) => (travelOuter ? table.sample(a, b, out) : table.sample(b, a, out));
          at(inner[k - 1]!, prev);
          at(inner[k]!, s);
          at(inner[k + 1]!, next);
          for (let i = 0; i < s.points.length; i++) worst = Math.max(worst, Math.abs(prev.points[i]! - 2 * s.points[i]! + next.points[i]!));
        }
      }
    };
    scan(travels, racks, true);
    scan(racks, travels, false);
    expect(worst).toBeLessThan(2e-4);
  });

  it('gives smooth, finite kinematic curves', () => {
    const c = kinematics.curves;
    for (const arr of [c.camber, c.toe, c.rollCentreHeight, c.motionRatio, c.lateral, c.longitudinal]) {
      expect(arr.length).toBe(c.travel.length);
      for (let i = 1; i < arr.length - 1; i++) {
        expect(Number.isFinite(arr[i]!)).toBe(true);
        // Second difference per 2.5 mm step, relative to the curve's own scale.
        // Floor 1e-3 (0.06 deg / 1 mm): a toe curve nulled to a few hundredths of a degree is noise-scaled otherwise.
        const scale = Math.max(...Array.from(arr, Math.abs), 1e-3);
        expect(Math.abs(arr[i - 1]! - 2 * arr[i]! + arr[i + 1]!) / scale).toBeLessThan(0.02);
      }
    }
  });

  it('interpolates within 0.05 mm / 0.005 deg of an exact warm-started solve (dense random sweep, incl. out of range)', () => {
    const sp = compileLinkage(linkage, opts.tyreRadius);
    const lm = createLmSolver(6, 6);
    const rng = createRng(7);
    const x = new Float64Array(6);
    const pts = new Float64Array(table.pointOrder.length * 3);
    const rv: [number, number, number] = [0, 0, 0];
    let posErr = 0;
    let angErr = 0;
    let linkErr = 0;
    let iters = 0;
    const N = 2000;
    for (let n = 0; n < N; n++) {
      const t = rng.uniform(table.travelRange[0] - 0.01, table.travelRange[1] + 0.01);
      const r = rng.uniform(table.rackRange[0] - 0.005, table.rackRange[1] + 0.005);
      table.sample(t, r, s);
      for (const v of s.points) expect(Number.isFinite(v)).toBe(true);
      linkErr = Math.max(linkErr, closureError(linkage, table, s.points, s.rotation));
      // Exact pose from the sampled one (what a per-frame refinement would do).
      q.toRotationVector(rv, [s.rotation.x, s.rotation.y, s.rotation.z, s.rotation.w]);
      x.set([s.wheelCentre.x - sp.wc0[0], s.wheelCentre.y - sp.wc0[1], s.wheelCentre.z - sp.wc0[2], ...rv]);
      sp.travel = s.travel;
      sp.rack = s.rack;
      const it = lm.solve(sp.residuals, x);
      expect(it).toBeGreaterThanOrEqual(0);
      iters += it;
      sp.pointsAt(x, pts);
      for (let i = 0; i < pts.length; i++) posErr = Math.max(posErr, Math.abs(pts[i]! - s.points[i]!));
      const a = sp.axle0;
      const ax = q.rotate([0, 0, 0], q.fromRotationVector([0, 0, 0, 1], [x[3]!, x[4]!, x[5]!]), a);
      angErr = Math.max(angErr, Math.abs(-Math.asin(ax[2]) - s.camber) * RAD_TO_DEG, Math.abs(Math.atan2(ax[0], ax[1]) - s.toe) * RAD_TO_DEG);
    }
    console.info(`  interpolation vs exact: points ${(posErr * 1e3).toFixed(4)} mm, angles ${angErr.toFixed(5)} deg, link closure ${(linkErr * 1e3).toFixed(4)} mm, refine ${(iters / N).toFixed(2)} iterations`);
    expect(posErr).toBeLessThan(5e-5);
    expect(angErr).toBeLessThan(0.005);
  });

  it('steers symmetrically and inverts the mean road-wheel angle', () => {
    expect(table.rollCentreHeight(0.02, -0.01)).toBeCloseTo(table.rollCentreHeight(-0.01, 0.02), 12);
    if (racks.length === 1) {
      expect(table.rackForSteer(0.2)).toBe(0);
      return;
    }
    expect(table.rackRange[0]).toBe(-table.rackRange[1]);
    for (const steer of [-0.35, -0.2, -0.05, 0.05, 0.2, 0.35]) {
      const r = table.rackForSteer(steer);
      expect(table.rackForSteer(-steer)).toBeCloseTo(-r, 9);
      const left = -table.sample(0, r, s).toe;
      const right = table.sample(0, -r, s).toe;
      expect((left + right) / 2).toBeCloseTo(steer, 3);
    }
  });

  it('samples without allocating; reports timing', () => {
    const rng = createRng(3);
    // Tagged (non-double) arrays hold already-boxed numbers, so passing them to a non-inlined call allocates
    // nothing in the test loop itself; any heap growth is then sample()'s own.
    const tagged = (xs: number[]) => {
      (xs as unknown[]).push('tag');
      xs.pop();
      return xs;
    };
    const ts = tagged(Array.from({ length: 4096 }, () => rng.uniform(table.travelRange[0], table.travelRange[1])));
    const rs = tagged(Array.from({ length: 4096 }, () => rng.uniform(table.rackRange[0], table.rackRange[1])));
    const run = (n: number) => {
      for (let i = 0; i < n; i++) table.sample(ts[i & 4095]!, rs[i & 4095]!, s);
    };
    for (let k = 0; k < 20; k++) run(20000);
    const gc = (globalThis as { gc?: () => void }).gc;
    expect(gc, 'vitest must run with --expose-gc').toBeTypeOf('function');
    const N = 300000;
    let delta = Infinity;
    let sampleNs = Infinity;
    for (let k = 0; k < 3; k++) {
      gc!();
      const before = process.memoryUsage().heapUsed;
      const t1 = performance.now();
      run(N);
      sampleNs = Math.min(sampleNs, ((performance.now() - t1) / N) * 1e6);
      delta = Math.min(delta, process.memoryUsage().heapUsed - before);
    }
    console.info(`  build ${buildMs.toFixed(1)} ms (${travels.length} x ${racks.length} nodes), sample ${sampleNs.toFixed(0)} ns, heap delta ${delta} B over ${N} samples`);
    expect(delta).toBeLessThan(64 * 1024);
  });
});

describe('solver has no left-side assumption', () => {
  it('the mirrored (right-side) linkage solves to the mirrored pose', () => {
    const left = macpherson.axles.front;
    const mirror = (p: readonly [number, number, number]) => [p[0], -p[1], p[2]] as const;
    const right: AxleLinkage = { ...left, points: Object.fromEntries(Object.entries(left.points).map(([k, p]) => [k, mirror(p)])) };
    const spL = compileLinkage(left, 0.38);
    const spR = compileLinkage(right, 0.38);
    const lm = createLmSolver(6, 6);
    const xL = new Float64Array(6);
    const xR = new Float64Array(6);
    const pL = new Float64Array(spL.names.length * 3);
    const pR = new Float64Array(spR.names.length * 3);
    for (const [t, r] of [[0.03, 0.01], [-0.05, -0.02], [0.07, 0.03]] as const) {
      spL.travel = spR.travel = t;
      spL.rack = r;
      spR.rack = -r;
      expect(lm.solve(spL.residuals, xL)).toBeGreaterThanOrEqual(0);
      expect(lm.solve(spR.residuals, xR)).toBeGreaterThanOrEqual(0);
      spL.pointsAt(xL, pL);
      spR.pointsAt(xR, pR);
      for (let i = 0; i < pL.length; i += 3) {
        expect(pR[i]).toBeCloseTo(pL[i]!, 10);
        expect(pR[i + 1]).toBeCloseTo(-pL[i + 1]!, 10);
        expect(pR[i + 2]).toBeCloseTo(pL[i + 2]!, 10);
      }
    }
  });

  it('rejects malformed linkages', () => {
    const l = doubleWishbone.axles.front;
    expect(() => compileLinkage({ ...l, constraints: l.constraints.slice(1) }, 0.38)).toThrow(/exactly 5/);
    expect(() => compileLinkage({ ...l, steer: 'nope' }, 0.38)).toThrow(/unknown point/);
    expect(() => solveAxleKinematics(l, { tyreRadius: 0.38, axle: 'front', cgHeight: 0.5, wheelbase: 2.9, brakeShare: 0.6 })).toThrow(/maxSteer/);
  });
});
