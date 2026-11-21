/**
 * Planar motorcycle kinematics (ARCHITECTURE §7.7, research 08 §4.1–4.4): one 1-DOF mechanism per end, tabulated over
 * vertical wheel travel w (vehicle frame, + bump, 0 = static ride height as drawn in the definition).
 *
 * Mechanisms (coordinate q):
 * - telescopic: prismatic along the steering axis u = (−sin ε, cos ε); q = fork stroke (+ compression).
 * - telelever: A-arm about `armPivot`, ball joint `armJoint` on the fork; the fork is the line steeringHead → armJoint
 *   (head ball joint), so the lower fork body rotates as the joint swings; q = arm angle (+ = joint up).
 * - swingarm: arm about `pivot`, shock from `shockTop` (frame) to `shockLower` (arm); q = arm angle (+ = axle up).
 * - swingarm-linkage: 4-bar (research 08 §4.3): dog-bone `swingarmLink`→`rockerLink`, rocker about `rockerPivot`,
 *   shock `shockTop`→`rockerShock`; circle–circle with the assembly branch of the drawn design.
 *
 * Per grid node the table holds: wheel centre, shock (spring) length, motion ratio MR = d(spring compression)/dw,
 * `kx` = d(x of the tyre's lowest point, fixed in the wheel carrier)/dw — the brake-force coupling (callipers sit on the
 * slider / swingarm), `chi` = chain coupling (rear: d(top-run tangent point, arm-fixed)/dw projected on the chain
 * direction), the instant centre used by the overlays, the steering-axis direction (front) and every named point.
 * Point meanings (for the visuals): `crownTop` = top of the fork leg in the upper yoke (offset from the steering axis),
 * `forkBottom` = the sliding joint of the leg (moves with the wheel, SLIDER above the axle along the leg),
 * `contactPatch` = the tyre's lowest point (the model replaces it by the leaned crown contact at sample time).
 */
import type { LinkageRear, MotorcycleSuspensionDefinition, SwingarmRear, TeleleverFront, TelescopicFront } from '../../contracts/suspension';
import type { Vec3 } from '../../contracts/units';
import type { MotorcycleDefinition } from '../../contracts/vehicle';
import { findInterval } from '../math/interp';
import { dasin, datan2, dcos, dsin } from '../math/det';
import { hypot2 } from '../math/vec3';

/** Distance from the axle to the sliding joint along the fork leg, m (drawing convention, not physics). */
export const SLIDER = 0.34;
/** Grid step in wheel travel, m. */
const STEP = 0.001;
/** The table extends this far beyond the full travel at both ends (stops), m. */
const MARGIN = 0.03;
/** Instant centres further than this from the contact point are drawn at this distance (parallel lines), m. */
const IC_MAX = 5;

// Channel layout of a table row.
export const WX = 0;
export const WZ = 1;
export const LEN = 2;
export const MR = 3;
export const KX = 4;
export const CHI = 5;
export const ICX = 6;
export const ICZ = 7;
export const DX = 8;
export const DZ = 9;
export const PX = 10;
export const PZ = 11;
export const POINTS = 12;

export const POINT_ORDER = {
  telescopic: ['steeringHead', 'crownTop', 'forkBottom', 'axle', 'contactPatch'],
  telelever: ['steeringHead', 'crownTop', 'forkBottom', 'axle', 'contactPatch', 'armPivot', 'armJoint', 'shockTop', 'shockArm'],
  swingarm: ['pivot', 'axle', 'shockTop', 'shockLower', 'contactPatch'],
  'swingarm-linkage': ['pivot', 'axle', 'rockerPivot', 'swingarmLink', 'rockerLink', 'rockerShock', 'shockTop', 'contactPatch'],
} as const;

export interface EndTable {
  readonly pointOrder: readonly string[];
  /** y of each point (visuals only; the planar model ignores it). */
  readonly pointY: Float64Array;
  /** 1 where the point turns with the handlebars (front fork assembly). */
  readonly steered: Uint8Array;
  readonly stride: number;
  /** Ascending wheel-travel grid, m. */
  readonly w: Float64Array;
  /** Row-major channels (see layout constants). */
  readonly rows: Float64Array;
  /** Total vertical wheel travel, m (telescopic: stroke · cos ε). */
  readonly travel: number;
  /** Number of shocks sharing the wheel load. */
  readonly shocks: number;
  /** Interpolates every channel at w (clamped to the grid) into out (length >= stride). */
  sample(w: number, out: Float64Array): Float64Array;
}

/** Mechanism: writes the pose for coordinate q into out (channels WX..PZ unused for derivatives, points from POINTS). */
interface Mechanism {
  readonly order: readonly string[];
  readonly y: readonly number[];
  readonly steered: readonly number[];
  readonly shocks: number;
  readonly travel: number;
  /** q range that certainly covers the travel grid. */
  readonly qMax: number;
  pose(q: number, out: Float64Array): void;
  /** Rear only: CCW arm angle per unit q (for the chain coupling). */
  readonly armRate: number;
  readonly pivot?: Vec3;
}

const rotX = (x: number, z: number, c: number, s: number): number => x * c - z * s;
const rotZ = (x: number, z: number, c: number, s: number): number => x * s + z * c;

/** Writes point k of a pose. */
function put(out: Float64Array, k: number, x: number, z: number): void {
  out[POINTS + 2 * k] = x;
  out[POINTS + 2 * k + 1] = z;
}

function telescopic(f: TelescopicFront, axle: readonly [number, number], radius: number): Mechanism {
  const sn = dsin(f.rake);
  const cs = dcos(f.rake);
  const [ax, az] = axle;
  const h = f.steeringHead;
  const crownX = h[0] + f.offset * cs;
  const crownZ = h[2] + f.offset * sn;
  return {
    order: POINT_ORDER.telescopic,
    y: [0, 0, 0, 0, 0],
    steered: [0, 1, 1, 1, 1],
    shocks: 1,
    travel: f.travel * cs,
    qMax: f.travel + 0.1,
    armRate: 0,
    pose(q, out) {
      const wx = ax - q * sn;
      const wz = az + q * cs;
      out[WX] = wx;
      out[WZ] = wz;
      out[PX] = wx;
      out[PZ] = wz - radius;
      out[DX] = -sn;
      out[DZ] = cs;
      const bx = wx - SLIDER * sn;
      const bz = wz + SLIDER * cs;
      out[LEN] = hypot2(crownX - bx, crownZ - bz);
      put(out, 0, h[0], h[2]);
      put(out, 1, crownX, crownZ);
      put(out, 2, bx, bz);
      put(out, 3, wx, wz);
      put(out, 4, wx, wz - radius);
    },
  };
}

function telelever(f: TeleleverFront, axle: readonly [number, number], radius: number): Mechanism {
  const [hx, , hz] = f.steeringHead;
  const [px, , pz] = f.armPivot;
  const [jx0, , jz0] = f.armJoint;
  const [sx0, , sz0] = f.shockArm;
  const [tx, , tz] = f.shockTop;
  const [ax, az] = axle;
  const alpha0 = datan2(hz - jz0, hx - jx0);
  // Lower fork body points relative to the joint at design: wheel centre, tyre bottom, sliding joint of the leg.
  const d0x = dcos(alpha0);
  const d0z = dsin(alpha0);
  const rel = [ax - jx0, az - jz0, ax - jx0, az - radius - jz0, ax + SLIDER * d0x - jx0, az + SLIDER * d0z - jz0];
  return {
    order: POINT_ORDER.telelever,
    y: [0, 0, 0, 0, 0, f.armPivot[1], f.armJoint[1], f.shockTop[1], f.shockArm[1]],
    steered: [0, 1, 1, 1, 1, 0, 0, 0, 0],
    shocks: 1,
    travel: f.travel,
    qMax: 0.8,
    armRate: 0,
    pose(q, out) {
      const c = dcos(q);
      const s = dsin(q);
      const jx = px + rotX(jx0 - px, jz0 - pz, c, s);
      const jz = pz + rotZ(jx0 - px, jz0 - pz, c, s);
      const alpha = datan2(hz - jz, hx - jx);
      const dc = dcos(alpha - alpha0);
      const ds = dsin(alpha - alpha0);
      const wx = jx + rotX(rel[0]!, rel[1]!, dc, ds);
      const wz = jz + rotZ(rel[0]!, rel[1]!, dc, ds);
      out[WX] = wx;
      out[WZ] = wz;
      out[PX] = jx + rotX(rel[2]!, rel[3]!, dc, ds);
      out[PZ] = jz + rotZ(rel[2]!, rel[3]!, dc, ds);
      const dx = dcos(alpha);
      const dz = dsin(alpha);
      out[DX] = dx;
      out[DZ] = dz;
      const sax = px + rotX(sx0 - px, sz0 - pz, c, s);
      const saz = pz + rotZ(sx0 - px, sz0 - pz, c, s);
      out[LEN] = hypot2(tx - sax, tz - saz);
      put(out, 0, hx, hz);
      put(out, 1, hx + f.offset * dz, hz - f.offset * dx);
      put(out, 2, jx + rotX(rel[4]!, rel[5]!, dc, ds), jz + rotZ(rel[4]!, rel[5]!, dc, ds));
      put(out, 3, wx, wz);
      put(out, 4, out[PX], out[PZ]);
      put(out, 5, px, pz);
      put(out, 6, jx, jz);
      put(out, 7, tx, tz);
      put(out, 8, sax, saz);
    },
  };
}

/** Rear mechanisms: arm angle q (+ = axle up, i.e. clockwise seen from the left for an arm trailing the pivot). */
function swingarm(r: SwingarmRear, radius: number): Mechanism {
  const [px, , pz] = r.pivot;
  const [ax0, , az0] = r.axle;
  const [lx0, , lz0] = r.shockLower;
  const [tx, , tz] = r.shockTop;
  return {
    order: POINT_ORDER.swingarm,
    y: [r.pivot[1], 0, r.shockTop[1], r.shockLower[1], 0],
    steered: [0, 0, 0, 0, 0],
    shocks: r.shocks,
    travel: r.travel,
    qMax: 0.8,
    armRate: -1,
    pivot: r.pivot,
    pose(q, out) {
      const c = dcos(-q);
      const s = dsin(-q);
      const wx = px + rotX(ax0 - px, az0 - pz, c, s);
      const wz = pz + rotZ(ax0 - px, az0 - pz, c, s);
      out[WX] = wx;
      out[WZ] = wz;
      out[PX] = px + rotX(ax0 - px, az0 - radius - pz, c, s);
      out[PZ] = pz + rotZ(ax0 - px, az0 - radius - pz, c, s);
      const lx = px + rotX(lx0 - px, lz0 - pz, c, s);
      const lz = pz + rotZ(lx0 - px, lz0 - pz, c, s);
      out[LEN] = hypot2(tx - lx, tz - lz);
      put(out, 0, px, pz);
      put(out, 1, wx, wz);
      put(out, 2, tx, tz);
      put(out, 3, lx, lz);
      put(out, 4, out[PX], out[PZ]);
    },
  };
}

function linkage(r: LinkageRear, radius: number): Mechanism {
  const [px, , pz] = r.pivot;
  const [ax0, , az0] = r.axle;
  const [bx, , bz] = r.rockerPivot;
  const [sx0, , sz0] = r.swingarmLink;
  const [qx0, , qz0] = r.rockerLink;
  const [cx0, , cz0] = r.rockerShock;
  const [tx, , tz] = r.shockTop;
  const rq = hypot2(qx0 - bx, qz0 - bz);
  const link = hypot2(qx0 - sx0, qz0 - sz0);
  const beta0 = datan2(qz0 - bz, qx0 - bx);
  // Assembly branch: the side of line B->S the rocker point lies on in the drawn design.
  const branch = Math.sign((sx0 - bx) * (qz0 - bz) - (sz0 - bz) * (qx0 - bx)) || 1;
  return {
    order: POINT_ORDER['swingarm-linkage'],
    y: [r.pivot[1], 0, r.rockerPivot[1], r.swingarmLink[1], r.rockerLink[1], r.rockerShock[1], r.shockTop[1], 0],
    steered: [0, 0, 0, 0, 0, 0, 0, 0],
    shocks: 1,
    travel: r.travel,
    qMax: 0.6,
    armRate: -1,
    pivot: r.pivot,
    pose(q, out) {
      const c = dcos(-q);
      const s = dsin(-q);
      const wx = px + rotX(ax0 - px, az0 - pz, c, s);
      const wz = pz + rotZ(ax0 - px, az0 - pz, c, s);
      out[WX] = wx;
      out[WZ] = wz;
      out[PX] = px + rotX(ax0 - px, az0 - radius - pz, c, s);
      out[PZ] = pz + rotZ(ax0 - px, az0 - radius - pz, c, s);
      const sx = px + rotX(sx0 - px, sz0 - pz, c, s);
      const sz = pz + rotZ(sx0 - px, sz0 - pz, c, s);
      // Circle (B, rq) ∩ circle (S, link).
      const ex = sx - bx;
      const ez = sz - bz;
      const d = hypot2(ex, ez);
      const a = (rq * rq - link * link + d * d) / (2 * d);
      const hh = Math.sqrt(Math.max(0, rq * rq - a * a));
      const qx = bx + (a * ex - branch * hh * ez) / d;
      const qz = bz + (a * ez + branch * hh * ex) / d;
      const db = datan2(qz - bz, qx - bx) - beta0;
      const rc = dcos(db);
      const rs = dsin(db);
      const kx = bx + rotX(cx0 - bx, cz0 - bz, rc, rs);
      const kz = bz + rotZ(cx0 - bx, cz0 - bz, rc, rs);
      out[LEN] = hypot2(tx - kx, tz - kz);
      put(out, 0, px, pz);
      put(out, 1, wx, wz);
      put(out, 2, bx, bz);
      put(out, 3, sx, sz);
      put(out, 4, qx, qz);
      put(out, 5, kx, kz);
      put(out, 6, tx, tz);
      put(out, 7, out[PX], out[PZ]);
    },
  };
}

/** Top run of the chain: unit direction (rear tangent -> front tangent) and the rear tangent point. */
function chainTopRun(ax: number, az: number, ex: number, ez: number, rr: number, rf: number, out: Float64Array): void {
  const dx = ex - ax;
  const dz = ez - az;
  const dist = hypot2(dx, dz);
  const th = datan2(dz, dx) - dasin((rr - rf) / dist);
  out[0] = dcos(th);
  out[1] = dsin(th);
  // Upward normal of the run.
  out[2] = ax - rr * out[1];
  out[3] = az + rr * out[0];
}

/** Line–line intersection of P1 + t·D1 and P2 + u·D2; NaN when parallel. */
function intersect(p1x: number, p1z: number, d1x: number, d1z: number, p2x: number, p2z: number, d2x: number, d2z: number, out: Float64Array): void {
  const det = d1x * -d2z + d2x * d1z;
  if (Math.abs(det) < 1e-9) {
    out[0] = out[1] = NaN;
    return;
  }
  const t = ((p2x - p1x) * -d2z + d2x * (p2z - p1z)) / det;
  out[0] = p1x + t * d1x;
  out[1] = p1z + t * d1z;
}

/** Keeps an instant centre within IC_MAX of the contact point (direction kept); NaN -> IC_MAX along `fx, fz`. */
function clampIc(row: Float64Array, cx: number, cz: number, fx: number, fz: number): void {
  let dx = row[ICX]! - cx;
  let dz = row[ICZ]! - cz;
  const atInfinity = !Number.isFinite(dx) || !Number.isFinite(dz);
  if (atInfinity) {
    dx = fx;
    dz = fz;
  }
  const d = hypot2(dx, dz);
  // An IC at infinity (parallel links, telescopic fork) sits at IC_MAX so overlays read it as "far", not near.
  const k = atInfinity || d > IC_MAX ? IC_MAX / d : 1;
  row[ICX] = cx + dx * k;
  row[ICZ] = cz + dz * k;
}

/** Builds the travel table of one end. `axle` = the static wheel centre (vehicle frame x, z). */
function buildTable(m: Mechanism, end: 'front' | 'rear', vehicle: MotorcycleDefinition): EndTable {
  const nP = m.order.length;
  const stride = POINTS + 2 * nP;
  const a = new Float64Array(stride);
  const b = new Float64Array(stride);
  const z0 = (m.pose(0, a), a[WZ]!);
  const wOf = (q: number): number => (m.pose(q, b), b[WZ]! - z0);
  const sign = wOf(1e-4) > 0 ? 1 : -1;
  /** q with wheel travel w (bisection; w(q) is monotonic over the mechanism's range). */
  const qOf = (w: number): number => {
    let lo = -m.qMax;
    let hi = m.qMax;
    for (let k = 0; k < 80; k++) {
      const mid = (lo + hi) / 2;
      if (sign * wOf(mid) < sign * w) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const n = Math.round((2 * m.travel + 2 * MARGIN) / STEP) + 1;
  const w = new Float64Array(n);
  const rows = new Float64Array(n * stride);
  const chain = new Float64Array(4);
  const ic = new Float64Array(2);
  const { sprocketCentre, frontRadius, rearRadius } = vehicle.chain;
  const h = 1e-5;
  for (let i = 0; i < n; i++) {
    const wi = -m.travel - MARGIN + i * STEP;
    w[i] = wi;
    const q = qOf(wi);
    const row = rows.subarray(i * stride, (i + 1) * stride);
    m.pose(q, row);
    m.pose(q + h, a);
    m.pose(q - h, b);
    const dw = a[WZ]! - b[WZ]!;
    row[MR] = -(a[LEN]! - b[LEN]!) / dw;
    row[KX] = (a[PX]! - b[PX]!) / dw;
    const cpx = row[PX]!;
    const cpz = row[PZ]!;
    if (end === 'rear') {
      const piv = m.pivot!;
      const ax = row[WX]!;
      const az = row[WZ]!;
      chainTopRun(ax, az, sprocketCentre[0], sprocketCentre[1], rearRadius, frontRadius, chain);
      // Arm-fixed tangent point velocity per unit wheel travel (CCW rate · perp of the radius).
      const rate = (m.armRate * 2 * h) / dw;
      const rx = chain[2]! - piv[0];
      const rz = chain[3]! - piv[2];
      row[CHI] = rate * (chain[0]! * -rz + chain[1]! * rx);
      // Anti-squat instant centre: swingarm line ∩ chain top run.
      intersect(piv[0], piv[2], ax - piv[0], az - piv[2], chain[2]!, chain[3]!, chain[0]!, chain[1]!, ic);
      row[ICX] = ic[0]!;
      row[ICZ] = ic[1]!;
      clampIc(row, cpx, cpz, 1, 0);
    } else {
      // Instant centre of the wheel carrier relative to the frame, from two carrier points' velocities.
      const vwx = (a[WX]! - b[WX]!) / dw;
      const vwz = 1;
      const vpx = row[KX]!;
      const vpz = (a[PZ]! - b[PZ]!) / dw;
      intersect(row[WX]!, row[WZ]!, -vwz, vwx, cpx, cpz, -vpz, vpx, ic);
      const rotating = Math.abs(vwx - vpx) > 1e-6;
      row[ICX] = rotating ? ic[0]! : NaN;
      row[ICZ] = rotating ? ic[1]! : NaN;
      // Parallel motion: the centre is at infinity on the normal to the path, drawn rearward.
      const nx = vpz > 0 ? -vpz : vpz;
      clampIc(row, cpx, cpz, nx, vpz > 0 ? vpx : -vpx);
      row[CHI] = 0;
    }
  }
  const pointY = Float64Array.from(m.y);
  const steered = Uint8Array.from(m.steered);
  return {
    pointOrder: m.order,
    pointY,
    steered,
    stride,
    w,
    rows,
    travel: m.travel,
    shocks: m.shocks,
    sample(x, out) {
      const i = findInterval(w, x);
      let t = (x - w[i]!) / STEP;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const o = i * stride;
      for (let k = 0; k < stride; k++) out[k] = rows[o + k]! + (rows[o + stride + k]! - rows[o + k]!) * t;
      return out;
    },
  };
}

export interface MotoTables {
  readonly front: EndTable;
  readonly rear: EndTable;
}

/** Static wheel centres of the vehicle (front axle at x = cgToFront, rear at cgToFront - wheelbase; z = tyre radius). */
export function axlePositions(v: MotorcycleDefinition): { front: [number, number]; rear: [number, number] } {
  return { front: [v.cgToFront, v.front.tyre.radius], rear: [v.cgToFront - v.wheelbase, v.rear.tyre.radius] };
}

export function buildMotoTables(vehicle: MotorcycleDefinition, s: MotorcycleSuspensionDefinition): MotoTables {
  const axles = axlePositions(vehicle);
  const rf = vehicle.front.tyre.radius;
  const rr = vehicle.rear.tyre.radius;
  const front = s.front.kind === 'telescopic' ? telescopic(s.front, axles.front, rf) : telelever(s.front, axles.front, rf);
  const rear = s.rear.kind === 'swingarm' ? swingarm(s.rear, rr) : linkage(s.rear, rr);
  return { front: buildTable(front, 'front', vehicle), rear: buildTable(rear, 'rear', vehicle) };
}
