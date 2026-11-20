/**
 * Front-view construction (research 21 §2 items 1, 2, 9, 12), drawn from live POSE fields only:
 * - per corner: contact patch → instant centre "force line", IC ring, and for every A-arm / strut the line where its
 *   instantaneous plane cuts the front-view plane (these meet at the IC: that is what the IC IS);
 * - per axle: ground line, centreline, roll-centre ring and a short trail kept in the body frame;
 * - ghost rest pose from `sim.restPose()`: linkage skeleton + tyre outline moved by the upright's rigid transform;
 * - load arrow + contact-patch ring per tyre, coloured by grip use (model estimate, no number shown).
 * Everything is in the sim frame; the line batches convert to three. Nothing here allocates per frame.
 */
import type { CarSuspensionDefinition, SuspensionDefinition } from '../../contracts/suspension';
import type { CornerFrame, TelemetryFrame } from '../../contracts/telemetry';
import type { XYZ } from '../../contracts/units';
import type { VehicleDefinition } from '../../contracts/vehicle';
import type { LineBatch } from './lines';

/** What the overlay needs from the simulation (the live `Simulation` satisfies it). */
export interface OverlaySim {
  readonly suspension: SuspensionDefinition;
  readonly vehicle: VehicleDefinition;
  restPose(cornerIndex: number, out: Float64Array): Float64Array;
}

/** Construction lines are clamped to this length from where they start, m (ICs can sit at 1000 m). */
export const LINE_MAX = 2.6;
/** Length of arm-plane lines when the IC is out of reach, m. */
const ARM_HINT = 0.9;
/** The last part of a clamped line fades out over this fraction of LINE_MAX. */
const FADE = 0.35;
const RC_TRAIL = 28;
const RC_TRAIL_DT = 1 / 24;
/** Load arrow length per newton, m/N (static corner load ≈ 0.3 m). */
const LOAD_SCALE = 0.3 / 4000;

// Linear-rgb stroke colours (additive layer: values > 1 survive the AgX tone map as clean, bright strokes).
const FORCE = [0.36, 1.9, 1.4] as const; // accent mint: contact patch → IC → RC
const IC = [1.5, 0.36, 0.26] as const; // coral: arm planes → IC
const RC = [1.5, 1.5, 1.5] as const;
const GUIDE = [0.55, 0.58, 0.64] as const; // ground line, centreline
const GHOST = [0.3, 0.38, 0.48] as const; // additive ghost layer
const GRIP_OK = [0.7, 0.85, 0.95] as const;
const GRIP_WARN = [1.6, 0.72, 0.16] as const; // --warn
const GRIP_OVER = [1.7, 0.2, 0.16] as const;

// ---------------------------------------------------------------- tiny vector maths on scratch arrays

type V = Float64Array;
const v3 = (): V => new Float64Array(3);
const set = (o: V, x: number, y: number, z: number): V => {
  o[0] = x;
  o[1] = y;
  o[2] = z;
  return o;
};
const sub = (o: V, a: V, b: V): V => set(o, a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
const dot = (a: V, b: V): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const cross = (o: V, a: V, b: V): V => set(o, a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!);
const len = (a: V): number => Math.hypot(a[0]!, a[1]!, a[2]!);
const norm = (o: V, a: V): V => {
  const l = len(a);
  return l > 1e-12 ? set(o, a[0]! / l, a[1]! / l, a[2]! / l) : set(o, 0, 0, 0);
};
const fromPoints = (o: V, p: ArrayLike<number>, i: number): V => set(o, p[3 * i]!, p[3 * i + 1]!, p[3 * i + 2]!);
const finite3 = (a: V): boolean => Number.isFinite(a[0]! + a[1]! + a[2]!);

/**
 * Line where plane (n1·p = h1) meets plane (n2·p = h2): point `p` and unit direction `d`.
 * Returns false for (near-)parallel planes.
 */
export function planeIntersection(n1: V, h1: number, n2: V, h2: number, p: V, d: V): boolean {
  cross(d, n1, n2);
  const det = dot(d, d);
  if (!(det > 1e-12 * dot(n1, n1) * dot(n2, n2))) return false;
  // p = ((h1 n2 - h2 n1) × d) / |d|²  — the point of the line closest to the origin
  const ax = h1 * n2[0]! - h2 * n1[0]!;
  const ay = h1 * n2[1]! - h2 * n1[1]!;
  const az = h1 * n2[2]! - h2 * n1[2]!;
  set(p, (ay * d[2]! - az * d[1]!) / det, (az * d[0]! - ax * d[2]!) / det, (ax * d[1]! - ay * d[0]!) / det);
  norm(d, d);
  return finite3(p);
}

/** Parameter of the point on the line (p, unit d) closest to q. */
export const closestT = (p: V, d: V, q: V): number => (q[0]! - p[0]!) * d[0]! + (q[1]! - p[1]!) * d[1]! + (q[2]! - p[2]!) * d[2]!;

/** Fade factor at distance s along a stroke that was clamped at `max` (1 when not clamped). */
export function fadeAt(s: number, max: number, clamped: boolean): number {
  if (!clamped) return 1;
  const from = max * (1 - FADE);
  return s <= from ? 1 : Math.max(0, 1 - (s - from) / (max - from));
}

// ---------------------------------------------------------------- per-corner rig (resolved on layout change)

const MAX_PLANES = 4;
const MAX_LINKS = 12;

interface CornerRig {
  order: readonly string[] | null;
  suspension: SuspensionDefinition | null;
  wheel: number;
  /** Upright frame points (3 indices) for the ghost tyre transform; -1 when unavailable. */
  frame: Int32Array;
  /** [kind (0 arm, 1 strut), a, b, c] × planes. arm: pivots a, b + joint c. strut: lower a, top b. */
  planes: Int32Array;
  planeCount: number;
  /** Ghost skeleton point-index pairs. */
  links: Int32Array;
  linkCount: number;
  /** Spring lower end: [kind (0 point, 1 link fraction, -1 none), i, j], fraction, upper index. */
  spring: Int32Array;
  springFraction: number;
  tyreRadius: number;
  tyreWidth: number;
  nominalLoad: number;
}

const newRig = (): CornerRig => ({
  order: null,
  suspension: null,
  wheel: -1,
  frame: new Int32Array(3).fill(-1),
  planes: new Int32Array(MAX_PLANES * 4),
  planeCount: 0,
  links: new Int32Array(MAX_LINKS * 2),
  linkCount: 0,
  spring: new Int32Array(4).fill(-1),
  springFraction: 0,
  tyreRadius: 0.33,
  tyreWidth: 0.25,
  nominalLoad: 4000,
});

/** Resolves point names to indices for one corner. Runs only when the layout changes (allowed to allocate). */
export function buildRig(rig: CornerRig, c: CornerFrame, sim: OverlaySim): void {
  const order = c.pointOrder;
  rig.order = order;
  rig.suspension = sim.suspension;
  const at = (name: string): number => order.indexOf(name);
  rig.wheel = at('wheelCentre');
  rig.planeCount = 0;
  rig.linkCount = 0;
  rig.frame.fill(-1);
  rig.spring.fill(-1);
  const v = sim.vehicle;
  const tyre = v.class === 'car' ? v[c.axle].tyre : c.axle === 'front' ? v.front.tyre : v.rear.tyre;
  rig.tyreRadius = tyre.radius;
  rig.tyreWidth = tyre.width;
  rig.nominalLoad = tyre.nominalLoad;
  if (sim.suspension.vehicleClass !== 'car') return;
  const axle = (sim.suspension as CarSuspensionDefinition).axles[c.axle];

  const link = (a: number, b: number): void => {
    if (a < 0 || b < 0 || rig.linkCount >= MAX_LINKS) return;
    rig.links[2 * rig.linkCount] = a;
    rig.links[2 * rig.linkCount + 1] = b;
    rig.linkCount++;
  };
  const plane = (kind: number, a: number, b: number, cc: number): void => {
    if (a < 0 || b < 0 || (kind === 0 && cc < 0) || rig.planeCount >= MAX_PLANES) return;
    rig.planes.set([kind, a, b, cc], 4 * rig.planeCount++);
  };
  const members = new Map<string, { chassis: number[]; upright: number }>();
  for (const k of axle.constraints) {
    link(at(k.chassis), at(k.upright));
    if (k.kind === 'strut') {
      plane(1, at(k.upright), at(k.chassis), -1);
      continue;
    }
    const m = members.get(k.member) ?? { chassis: [], upright: at(k.upright) };
    m.chassis.push(at(k.chassis));
    members.set(k.member, m);
  }
  // Two distances sharing a member and a ball joint = an A-arm: a rigid plane through both pivots and the joint.
  for (const m of members.values()) if (m.chassis.length === 2) plane(0, m.chassis[0]!, m.chassis[1]!, m.upright);
  // Upright spokes: wheel centre to every other upright point.
  const up = axle.uprightPoints.map(at).filter((i) => i >= 0 && i !== rig.wheel);
  for (const i of up) link(rig.wheel, i);
  if (rig.wheel >= 0 && up.length >= 2) rig.frame.set([rig.wheel, up[0]!, up[1]!]);
  // Spring (ghost): upper mount to the lower seat.
  const lower = axle.spring.lower;
  rig.spring[3] = at(axle.spring.upper);
  if (lower.on === 'link') {
    const k = axle.constraints.find((x) => x.kind === 'distance' && x.member === lower.member);
    if (k) rig.spring.set([1, at(k.chassis), at(k.upright)]);
    rig.springFraction = lower.fraction;
  } else rig.spring.set([0, at(lower.point), -1]);
}

// ---------------------------------------------------------------- drawing

export interface Construction {
  /** Clears the RC trails (vehicle/suspension change, seek). */
  reset(): void;
  /**
   * `eye` (sim frame, optional): the axle nearer the camera is drawn at full strength, the other one dimmed down to
   * `farFloor` (0.22; 0 hides it, e.g. in the close-up where the focused wheel is the hero).
   * `focus` (a corner id, close-up; unknown = corner 0): only that corner's construction (a car: and its axle's ground
   * line up to the centreline), so the other wheels' lines do not cross the frame.
   */
  draw(t: TelemetryFrame, sim: OverlaySim, dt: number, eye?: XYZ, farFloor?: number, focus?: string | null): void;
}

export function createConstruction(main: LineBatch, ghost: LineBatch): Construction {
  const rigs: CornerRig[] = [];
  let rest = new Float64Array(0);
  /** Batch that stroke()/ray() write to: `main` for primary strokes, `ghost` (thin, no casing) for secondary ones. */
  let out = main;
  // body basis (sim frame)
  const ex = v3();
  const ey = v3();
  const ez = v3();
  const org = v3();
  // scratch
  const a = v3();
  const b = v3();
  const c = v3();
  const d = v3();
  const p = v3();
  const n1 = v3();
  const cp = v3();
  const ic = v3();
  const q = v3();
  const f1 = [v3(), v3(), v3()] as const;
  const f2 = [v3(), v3(), v3()] as const;
  const trail = [new Float64Array(RC_TRAIL * 3), new Float64Array(RC_TRAIL * 3)] as const;
  const trailLen = [0, 0];
  const trailHead = [0, 0];
  let trailClock = 0;

  /** Stroke from s0 to s1 along (o, unit dir); `dash` 0 = solid; fades when the line was clamped at `max`. */
  const stroke = (o: V, dir: V, s0: number, s1: number, col: readonly number[], dash: number, max: number, clamped: boolean, gap = 0.7): void => {
    if (!(s1 > s0)) return;
    const step = dash > 0 ? Math.max(dash, (s1 - s0) / 48) : (s1 - s0) / (clamped ? 6 : 1);
    for (let s = s0; s < s1 - 1e-6; s += step * (dash > 0 ? 1 + gap : 1)) {
      const e = Math.min(s + step, s1);
      const fa = fadeAt(s, max, clamped);
      const fb = fadeAt(e, max, clamped);
      out.seg(
        o[0]! + dir[0]! * s, o[1]! + dir[1]! * s, o[2]! + dir[2]! * s,
        o[0]! + dir[0]! * e, o[1]! + dir[1]! * e, o[2]! + dir[2]! * e,
        col[0]! * fa, col[1]! * fa, col[2]! * fa, col[0]! * fb, col[1]! * fb, col[2]! * fb,
      );
    }
  };

  /** Ring of radius r around centre in the plane spanned by u, w. */
  const ring = (batch: LineBatch, centre: V, u: V, w: V, r: number, col: readonly number[], k = 1, segs = 14, ru = r): void => {
    let px = centre[0]! + u[0]! * ru;
    let py = centre[1]! + u[1]! * ru;
    let pz = centre[2]! + u[2]! * ru;
    for (let i = 1; i <= segs; i++) {
      const th = (i / segs) * Math.PI * 2;
      const cu = Math.cos(th) * ru;
      const sw = Math.sin(th) * r;
      const x = centre[0]! + u[0]! * cu + w[0]! * sw;
      const y = centre[1]! + u[1]! * cu + w[1]! * sw;
      const z = centre[2]! + u[2]! * cu + w[2]! * sw;
      batch.seg(px, py, pz, x, y, z, col[0]! * k, col[1]! * k, col[2]! * k, col[0]! * k, col[1]! * k, col[2]! * k);
      px = x;
      py = y;
      pz = z;
    }
  };

  /** Ray from `from` toward `to`, clamped at LINE_MAX (faded). Solid up to `solid` (distance), dashed beyond. */
  const ray = (from: V, to: V, col: readonly number[], dashFrom: number, dash = 0.03, gap = 0.7, max = LINE_MAX): void => {
    sub(d, to, from);
    const l = len(d);
    if (!(l > 1e-4) || !Number.isFinite(l)) return;
    norm(d, d);
    const clamped = l > max;
    const end = Math.min(l, max);
    const split = Math.min(dashFrom, end);
    stroke(from, d, 0, split, col, 0, max, clamped);
    stroke(from, d, split, end, col, dash, max, clamped, gap);
  };

  const frame3 = (f: readonly [V, V, V], pts: ArrayLike<number>, i0: number, i1: number, i2: number): boolean => {
    fromPoints(a, pts, i0);
    sub(f[0], fromPoints(b, pts, i1), a);
    norm(f[0], f[0]);
    sub(c, fromPoints(c, pts, i2), a);
    cross(f[2], f[0], c);
    norm(f[2], f[2]);
    cross(f[1], f[2], f[0]);
    return len(f[2]) > 0.5;
  };

  const drawCorner = (i: number, fc: CornerFrame, rig: CornerRig, sim: OverlaySim, t: TelemetryFrame): void => {
    const pts = fc.points;
    set(cp, fc.contactPatch.x, fc.contactPatch.y, fc.contactPatch.z);
    set(ic, fc.instantCentre.x, fc.instantCentre.y, fc.instantCentre.z);
    const hasIc = finite3(ic) && finite3(cp);

    // Arm / strut planes cut by the front-view plane (normal = body forward, through the contact patch).
    if (hasIc) {
      const h2 = dot(ex, cp);
      // An IC beyond reach cannot show convergence: its arm lines only hint at the direction (short, faded).
      const armMax = Math.hypot(ic[0]! - cp[0]!, ic[1]! - cp[1]!, ic[2]! - cp[2]!) > LINE_MAX ? ARM_HINT : LINE_MAX;
      for (let k = 0; k < rig.planeCount; k++) {
        const o = 4 * k;
        const kind = rig.planes[o]!;
        let from: V;
        if (kind === 0) {
          fromPoints(a, pts, rig.planes[o + 1]!);
          fromPoints(b, pts, rig.planes[o + 2]!);
          fromPoints(c, pts, rig.planes[o + 3]!);
          cross(n1, sub(p, b, a), sub(q, c, a));
          from = c; // ball joint
        } else {
          fromPoints(a, pts, rig.planes[o + 1]!); // strut lower (upright)
          fromPoints(c, pts, rig.planes[o + 2]!); // top mount
          sub(n1, c, a); // plane through the top mount, normal to the strut axis
          from = c;
        }
        const h1 = dot(n1, kind === 0 ? a : c);
        if (!planeIntersection(n1, h1, ex, h2, p, d)) continue;
        const t0 = closestT(p, d, from);
        const t1 = closestT(p, d, ic);
        set(a, p[0]! + d[0]! * t0, p[1]! + d[1]! * t0, p[2]! + d[2]! * t0);
        set(b, p[0]! + d[0]! * t1, p[1]! + d[1]! * t1, p[2]! + d[2]! * t1);
        out = ghost;
        ray(a, b, IC, 0, 0.016, 1.6, armMax);
        out = main;
      }
      // Contact patch → IC: solid; the roll centre lies on its continuation (dashed past the IC).
      const ax = t.axles[fc.axle === 'front' ? 0 : 1];
      const icDist = Math.hypot(ic[0]! - cp[0]!, ic[1]! - cp[1]!, ic[2]! - cp[2]!);
      let target: V = ic;
      if (ax && Number.isFinite(ax.rollCentreHeight)) {
        set(q, ax.rollCentre.x, ax.rollCentre.y, ax.rollCentre.z);
        sub(d, ic, cp);
        const tq = icDist > 1e-6 ? closestT(cp, norm(d, d), q) : 0;
        if (tq > icDist) target = q;
      }
      ray(cp, target, FORCE, icDist);
      if (icDist < LINE_MAX) ring(main, ic, ey, ez, 0.022, IC);
    }

    // Load arrow (road pushes up on the tyre) + contact-patch ring, coloured by modelled grip use.
    if (finite3(cp) && fc.load > 0) {
      const g = fc.gripUse;
      const col = g > 1 ? GRIP_OVER : g > 0.8 ? GRIP_WARN : GRIP_OK;
      const l = Math.min(fc.load * LOAD_SCALE, 0.9);
      const k = 0.7;
      main.seg(cp[0]!, cp[1]!, cp[2]!, cp[0]! + ez[0]! * l, cp[1]! + ez[1]! * l, cp[2]! + ez[2]! * l, col[0]! * k, col[1]! * k, col[2]! * k, col[0]! * k, col[1]! * k, col[2]! * k);
      const h = Math.min(0.04, l * 0.3);
      for (let s = 1; s >= -1; s -= 2) {
        const tx = cp[0]! + ez[0]! * l;
        const ty = cp[1]! + ez[1]! * l;
        const tz = cp[2]! + ez[2]! * l;
        main.seg(tx, ty, tz, tx - ez[0]! * h + s * ey[0]! * h * 0.6, ty - ez[1]! * h + s * ey[1]! * h * 0.6, tz - ez[2]! * h + s * ey[2]! * h * 0.6, col[0]! * k, col[1]! * k, col[2]! * k, col[0]! * k, col[1]! * k, col[2]! * k);
      }
      // visual only: patch length grows with the square root of load (no tyre pressure is modelled)
      const half = rig.tyreWidth / 2;
      ring(main, cp, ex, ey, half, col, 0.55, 18, half * 0.7 * Math.sqrt(Math.max(0, fc.load) / rig.nominalLoad));
    }

    // Ghost rest pose.
    if (rest.length < pts.length) rest = new Float64Array(pts.length); // only on a layout change
    sim.restPose(i, rest);
    for (let l = 0; l < rig.linkCount; l++) {
      const i0 = rig.links[2 * l]!;
      const i1 = rig.links[2 * l + 1]!;
      ghost.seg(rest[3 * i0]!, rest[3 * i0 + 1]!, rest[3 * i0 + 2]!, rest[3 * i1]!, rest[3 * i1 + 1]!, rest[3 * i1 + 2]!, GHOST[0], GHOST[1], GHOST[2], GHOST[0], GHOST[1], GHOST[2]);
    }
    if (rig.spring[3]! >= 0 && rig.spring[0]! >= 0) {
      fromPoints(a, rest, rig.spring[3]!);
      if (rig.spring[0] === 0) fromPoints(b, rest, rig.spring[1]!);
      else {
        fromPoints(b, rest, rig.spring[1]!);
        fromPoints(c, rest, rig.spring[2]!);
        const f = rig.springFraction;
        set(b, b[0]! + (c[0]! - b[0]!) * f, b[1]! + (c[1]! - b[1]!) * f, b[2]! + (c[2]! - b[2]!) * f);
      }
      ghost.seg(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, GHOST[0], GHOST[1], GHOST[2], GHOST[0], GHOST[1], GHOST[2]);
    }
    if (rig.frame[0]! >= 0) drawGhostTyre(fc, rig, pts);
    else if (rig.linkCount === 0) {
      // No linkage topology (motorcycle): a small cross at every rest point.
      const nPts = fc.pointOrder.length;
      for (let j = 0; j < nPts; j++) {
        fromPoints(a, rest, j);
        const s = 0.025;
        ghost.seg(a[0]! - ex[0]! * s, a[1]! - ex[1]! * s, a[2]! - ex[2]! * s, a[0]! + ex[0]! * s, a[1]! + ex[1]! * s, a[2]! + ex[2]! * s, GHOST[0], GHOST[1], GHOST[2], GHOST[0], GHOST[1], GHOST[2]);
        ghost.seg(a[0]! - ez[0]! * s, a[1]! - ez[1]! * s, a[2]! - ez[2]! * s, a[0]! + ez[0]! * s, a[1]! + ez[1]! * s, a[2]! + ez[2]! * s, GHOST[0], GHOST[1], GHOST[2], GHOST[0], GHOST[1], GHOST[2]);
      }
    }
  };

  // Wheel basis from CornerFrame.wheelRotation (x fwd, y axle, z up in the wheel's own frame).
  const wx = v3();
  const wy = v3();
  const wz = v3();
  const wc = v3();
  const ghostPoint = (lx: number, ly: number, lz: number, out: V): V => {
    // live wheel point → upright-local (live frame f1 at live wheel centre) → rest frame f2 at rest wheel centre
    set(q, wc[0]! + wx[0]! * lx + wy[0]! * ly + wz[0]! * lz, wc[1]! + wx[1]! * lx + wy[1]! * ly + wz[1]! * lz, wc[2]! + wx[2]! * lx + wy[2]! * ly + wz[2]! * lz);
    sub(q, q, a);
    const u0 = dot(q, f1[0]);
    const u1 = dot(q, f1[1]);
    const u2 = dot(q, f1[2]);
    return set(out, b[0]! + f2[0][0]! * u0 + f2[1][0]! * u1 + f2[2][0]! * u2, b[1]! + f2[0][1]! * u0 + f2[1][1]! * u1 + f2[2][1]! * u2, b[2]! + f2[0][2]! * u0 + f2[1][2]! * u1 + f2[2][2]! * u2);
  };
  const g0 = v3();
  const g1 = v3();
  const drawGhostTyre = (fc: CornerFrame, rig: CornerRig, pts: Float64Array): void => {
    const i0 = rig.frame[0]!;
    const i1 = rig.frame[1]!;
    const i2 = rig.frame[2]!;
    if (!frame3(f1, pts, i0, i1, i2) || !frame3(f2, rest, i0, i1, i2)) return;
    const qr = fc.wheelRotation;
    const { x, y, z, w } = qr;
    set(wx, 1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y));
    set(wy, 2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x));
    set(wz, 2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y));
    set(wc, fc.wheelPosition.x, fc.wheelPosition.y, fc.wheelPosition.z);
    fromPoints(a, pts, i0); // live wheel centre (frame origin)
    fromPoints(b, rest, i0); // rest wheel centre
    const R = rig.tyreRadius;
    const hw = rig.tyreWidth / 2;
    const N = 20;
    for (let side = 1; side >= -1; side -= 2) {
      ghostPoint(R, side * hw, 0, g0);
      for (let s = 1; s <= N; s++) {
        const th = (s / N) * Math.PI * 2;
        ghostPoint(R * Math.cos(th), side * hw, R * Math.sin(th), g1);
        ghost.seg(g0[0]!, g0[1]!, g0[2]!, g1[0]!, g1[1]!, g1[2]!, GHOST[0], GHOST[1], GHOST[2], GHOST[0], GHOST[1], GHOST[2]);
        set(g0, g1[0]!, g1[1]!, g1[2]!);
      }
    }
    // Tread lines at top, bottom, front and back close the front-view rectangle.
    for (let s = 0; s < 4; s++) {
      const th = (s / 4) * Math.PI * 2;
      ghostPoint(R * Math.cos(th), hw, R * Math.sin(th), g0);
      ghostPoint(R * Math.cos(th), -hw, R * Math.sin(th), g1);
      ghost.seg(g0[0]!, g0[1]!, g0[2]!, g1[0]!, g1[1]!, g1[2]!, GHOST[0], GHOST[1], GHOST[2], GHOST[0], GHOST[1], GHOST[2]);
    }
  };

  /** `half`: 0 = whole ground line, 1 = left patch → centre only, -1 = right patch → centre only. */
  const drawAxle = (ai: number, cl: CornerFrame, cr: CornerFrame, t: TelemetryFrame, sampleTrail: boolean, half = 0): void => {
    const ax = t.axles[ai];
    // Ground line between the contact patches, centreline from the ground up through the roll centre.
    set(a, cl.contactPatch.x, cl.contactPatch.y, cl.contactPatch.z);
    set(b, cr.contactPatch.x, cr.contactPatch.y, cr.contactPatch.z);
    if (!finite3(a) || !finite3(b)) return;
    const gk = 0.8;
    set(c, (a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2, (a[2]! + b[2]!) / 2);
    const g0 = half < 0 ? c : a;
    const g1 = half > 0 ? c : b;
    ghost.seg(g0[0]!, g0[1]!, g0[2]!, g1[0]!, g1[1]!, g1[2]!, GUIDE[0] * gk, GUIDE[1] * gk, GUIDE[2] * gk, GUIDE[0] * gk, GUIDE[1] * gk, GUIDE[2] * gk);
    if (!ax || !Number.isFinite(ax.rollCentreHeight)) return;
    set(q, ax.rollCentre.x, ax.rollCentre.y, ax.rollCentre.z);
    if (!finite3(q)) return;
    // centreline: dashed from the ground to a little above the RC (or above the ground, whichever is higher)
    const top = Math.max(dot(sub(p, q, c), ez), 0) + 0.12;
    out = ghost;
    stroke(c, ez, 0, top, GUIDE, 0.025, LINE_MAX, false);
    out = main;
    ring(main, q, ey, ez, 0.034, RC, 1, 16);
    ring(main, q, ey, ez, 0.012, RC, 1, 8);
    // trail in the body frame, re-posed every frame so it shows RC migration relative to the car
    const tr = trail[ai]!;
    sub(p, q, org);
    if (sampleTrail) {
      const h = trailHead[ai]!;
      tr[3 * h] = dot(p, ex);
      tr[3 * h + 1] = dot(p, ey);
      tr[3 * h + 2] = dot(p, ez);
      trailHead[ai] = (h + 1) % RC_TRAIL;
      trailLen[ai] = Math.min(RC_TRAIL, trailLen[ai]! + 1);
    }
    const n = trailLen[ai]!;
    let px = q[0]!;
    let py = q[1]!;
    let pz = q[2]!;
    for (let j = 1; j < n; j++) {
      const h = (trailHead[ai]! - 1 - j + 2 * RC_TRAIL) % RC_TRAIL;
      const lx = tr[3 * h]!;
      const ly = tr[3 * h + 1]!;
      const lz = tr[3 * h + 2]!;
      const x = org[0]! + ex[0]! * lx + ey[0]! * ly + ez[0]! * lz;
      const y = org[1]! + ex[1]! * lx + ey[1]! * ly + ez[1]! * lz;
      const z = org[2]! + ex[2]! * lx + ey[2]! * ly + ez[2]! * lz;
      const k0 = 0.9 * (1 - (j - 1) / n);
      const k1 = 0.9 * (1 - j / n);
      main.seg(px, py, pz, x, y, z, FORCE[0] * k0, FORCE[1] * k0, FORCE[2] * k0, FORCE[0] * k1, FORCE[1] * k1, FORCE[2] * k1);
      px = x;
      py = y;
      pz = z;
    }
  };

  const gain = [1, 1];
  const centre = new Float64Array(6);
  const axleGains = (cs: readonly CornerFrame[], eye: XYZ | undefined, floor: number): void => {
    gain[0] = gain[1] = 1;
    if (!eye) return;
    centre.fill(0);
    for (let i = 0; i < cs.length; i++) {
      const o = cs[i]!.axle === 'front' ? 0 : 3;
      const w = cs[i]!.wheelPosition;
      centre[o] = centre[o]! + w.x;
      centre[o + 1] = centre[o + 1]! + w.y;
      centre[o + 2] = centre[o + 2]! + w.z;
    }
    // equal corner counts per axle, so the sums compare like the means
    const d0 = Math.hypot(centre[0]! - eye.x * cs.length / 2, centre[1]! - eye.y * cs.length / 2, centre[2]! - eye.z * cs.length / 2);
    const d1 = Math.hypot(centre[3]! - eye.x * cs.length / 2, centre[4]! - eye.y * cs.length / 2, centre[5]! - eye.z * cs.length / 2);
    if (!(d0 > 0 && d1 > 0)) return;
    // the far axle fades with the distance ratio: both full from the side, ~0.3 from straight ahead / behind
    const far = floor + (1 - floor) * Math.min(d0, d1) ** 6 / Math.max(d0, d1) ** 6;
    gain[d0 <= d1 ? 1 : 0] = far;
  };

  return {
    reset() {
      trailLen[0] = trailLen[1] = 0;
      trailHead[0] = trailHead[1] = 0;
    },
    draw(t, sim, dt, eye, farFloor = 0.22, focus = null) {
      const { x, y, z, w } = t.bodyRotation;
      set(ex, 1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y));
      set(ey, 2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x));
      set(ez, 2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y));
      set(org, t.bodyPosition.x, t.bodyPosition.y, t.bodyPosition.z);
      main.begin();
      ghost.begin();
      const cs = t.corners;
      while (rigs.length < cs.length) rigs.push(newRig()); // grows once per layout
      axleGains(cs, eye, farFloor);
      let focused = -1;
      if (focus != null) {
        focused = 0; // an unknown id films corner 0, as the camera does
        for (let i = 0; i < cs.length; i++) if (cs[i]!.id === focus) focused = i;
      }
      for (let i = 0; i < cs.length; i++) {
        const fc = cs[i]!;
        const rig = rigs[i]!;
        main.gain = ghost.gain = gain[fc.axle === 'front' ? 0 : 1]!;
        if (rig.order !== fc.pointOrder || rig.suspension !== sim.suspension) buildRig(rig, fc, sim);
        if (focused < 0 || focused === i) drawCorner(i, fc, rig, sim, t);
      }
      trailClock += dt;
      const sampleTrail = trailClock >= RC_TRAIL_DT;
      if (sampleTrail) trailClock = 0;
      if (cs.length === 4) {
        // corners are [fl, fr, rl, rr]: a focused left corner keeps the left half of its axle's ground line
        const half = focused < 0 ? 0 : focused % 2 === 0 ? 1 : -1;
        main.gain = ghost.gain = gain[0]!;
        if (focused < 2) drawAxle(0, cs[0]!, cs[1]!, t, sampleTrail, half);
        main.gain = ghost.gain = gain[1]!;
        if (focused < 0 || focused >= 2) drawAxle(1, cs[2]!, cs[3]!, t, sampleTrail, half);
      }
      main.gain = ghost.gain = 1;
      main.end();
      ghost.end();
    },
  };
}
