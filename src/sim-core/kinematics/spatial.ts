/**
 * Compiles a declarative `AxleLinkage` (contracts/suspension.ts) into residuals over the upright pose, and
 * places every named point for a pose (research 03 §3.1, §4.1, §4.3). One code path for every layout:
 * a suspension type is only data.
 *
 * Pose x = (t, w): t = wheel-centre displacement from design, w = rotation vector of the upright about the
 * design wheel centre. Upright point P = R(w) (p0 - wc0) + wc0 + t. AXLE frame, LEFT side.
 */
import type { AxleLinkage } from '../../contracts/suspension';
import * as m3 from '../math/mat';
import { hypot3, type V3 } from '../math/vec3';
import type { ResidualFn } from './lm';
import { datan2, dcos, dsin } from '../math/det';

/** Derived point appended to every point order: the spring/damper lower mount, wherever it is attached. */
export const SPRING_LOWER = 'springLower';

const CHASSIS = 0;
const UPRIGHT = 1;
/** Rigid with an A-arm: rotates about the arm's chassis pivot axis. */
const ARM = 2;
/** Rigid with a single rod: minimal (swing) rotation of the rod about its chassis end. */
const SWING = 3;
/** At a fixed fraction along a single rod. */
const FRACTION = 4;

export interface Spatial {
  readonly names: readonly string[];
  /** Design positions of `names`, 3 per point. */
  readonly p0: Float64Array;
  readonly wc0: V3;
  /** Design spin axis of the left wheel (outward), from the static alignment. */
  readonly axle0: V3;
  readonly tyreRadius: number;
  /** z of the design contact patch (ground plane). */
  readonly groundZ: number;
  /** Index of the chassis point moved by +rack in Y, or -1. */
  readonly steerIdx: number;
  /** Chassis point whose Y shift defines the steering (or virtual toe) axis: steer, else the tie-rod/toe-link inner. */
  readonly toeIdx: number;
  readonly springUpperIdx: number;
  readonly springLowerIdx: number;
  /** Parameters read by `residuals` (set before solving). */
  travel: number;
  rack: number;
  /** Extra Y shift of `toeIdx` (steer-axis metrics only). */
  toeShift: number;
  readonly residuals: ResidualFn;
  /** Rotation matrix of a pose. */
  rotation(x: Float64Array, out: m3.Mat3): m3.Mat3;
  /** All points (order `names`) for pose x at the current rack/toeShift. */
  pointsAt(x: Float64Array, out: Float64Array): Float64Array;
}

const sub3 = (a: Float64Array | V3, i: number, b: Float64Array | V3, j: number, out: V3): V3 => {
  out[0] = a[i]! - b[j]!;
  out[1] = a[i + 1]! - b[j + 1]!;
  out[2] = a[i + 2]! - b[j + 2]!;
  return out;
};

function unit(out: V3, x: number, y: number, z: number): V3 {
  const l = hypot3(x, y, z);
  out[0] = x / l;
  out[1] = y / l;
  out[2] = z / l;
  return out;
}

/** Rotates v (3 at vi) by angle about unit axis n (Rodrigues), writes at oi. */
function rotateAbout(n: V3, angle: number, v: V3, out: Float64Array, oi: number): void {
  const c = dcos(angle);
  const s = dsin(angle);
  const d = (n[0] * v[0] + n[1] * v[1] + n[2] * v[2]) * (1 - c);
  out[oi] = v[0] * c + (n[1] * v[2] - n[2] * v[1]) * s + n[0] * d;
  out[oi + 1] = v[1] * c + (n[2] * v[0] - n[0] * v[2]) * s + n[1] * d;
  out[oi + 2] = v[2] * c + (n[0] * v[1] - n[1] * v[0]) * s + n[2] * d;
}

export function compileLinkage(axle: AxleLinkage, tyreRadius: number): Spatial {
  const keys = Object.keys(axle.points);
  if (keys.includes(SPRING_LOWER)) throw new Error(`point name '${SPRING_LOWER}' is reserved`);
  const names = [...keys, SPRING_LOWER];
  const idx = (name: string, what: string): number => {
    const i = keys.indexOf(name);
    if (i < 0) throw new Error(`${what}: unknown point '${name}'`);
    return i;
  };
  const count = names.length;
  const p0 = new Float64Array(count * 3);
  keys.forEach((k, i) => p0.set(axle.points[k]!, i * 3));

  const kind = new Int8Array(count);
  const ka = new Int32Array(count).fill(-1); // chassis pivot F / rod chassis end
  const kb = new Int32Array(count).fill(-1); // chassis pivot B
  const ku = new Int32Array(count).fill(-1); // upright (ball joint) point
  const kf = new Float64Array(count);
  const wcIdx = idx('wheelCentre', 'wheelCentre');
  if (!axle.uprightPoints.includes('wheelCentre')) throw new Error("uprightPoints must include 'wheelCentre'");
  for (const n of axle.uprightPoints) kind[idx(n, 'uprightPoints')] = UPRIGHT;

  // Constraints.
  const du: number[] = [];
  const dc: number[] = [];
  const dL2: number[] = [];
  const members = new Map<string, number[]>(); // member -> distance constraint indices
  let strut: { s: number; t: number; e1: V3; e2: V3 } | null = null;
  let toeIdx = -1;
  for (const c of axle.constraints) {
    const u = idx(c.upright, 'constraint upright');
    const ch = idx(c.chassis, 'constraint chassis');
    if (kind[u] !== UPRIGHT) throw new Error(`constraint upright point '${c.upright}' is not in uprightPoints`);
    if (kind[ch] === UPRIGHT) throw new Error(`constraint chassis point '${c.chassis}' is an upright point`);
    if (c.kind === 'distance') {
      const d = sub3(p0, u * 3, p0, ch * 3, [0, 0, 0]);
      members.set(c.member, [...(members.get(c.member) ?? []), du.length]);
      du.push(u);
      dc.push(ch);
      dL2.push(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
      if (c.role === 'tie-rod' && toeIdx < 0) toeIdx = ch;
    } else {
      if (strut) throw new Error('only one strut constraint is supported');
      const d0 = unit([0, 0, 0], p0[ch * 3]! - p0[u * 3]!, p0[ch * 3 + 1]! - p0[u * 3 + 1]!, p0[ch * 3 + 2]! - p0[u * 3 + 2]!);
      // Upright-fixed basis perpendicular to the strut axis (x-hat is never near a strut axis).
      const e1 = unit([0, 0, 0], 0, d0[2], -d0[1]); // d0 x x-hat
      const e2 = unit([0, 0, 0], d0[1] * e1[2] - d0[2] * e1[1], d0[2] * e1[0] - d0[0] * e1[2], d0[0] * e1[1] - d0[1] * e1[0]);
      strut = { s: u, t: ch, e1, e2 };
    }
  }
  const equations = du.length + (strut ? 2 : 0);
  if (equations !== 5) throw new Error(`a car linkage needs exactly 5 constraint equations, got ${equations}`);

  const steerIdx = axle.steer === undefined ? -1 : idx(axle.steer, 'steer');
  if (steerIdx >= 0) {
    if (kind[steerIdx] === UPRIGHT) throw new Error('steer must be a chassis point');
    toeIdx = steerIdx;
  }

  // Points carried by arms/links.
  const attach = (point: string, member: string, what: string): number => {
    const i = idx(point, what);
    if (kind[i] === UPRIGHT) throw new Error(`${what}: '${point}' is an upright point`);
    const cons = members.get(member);
    if (!cons) throw new Error(`${what}: unknown member '${member}'`);
    if (cons.length === 1) {
      kind[i] = SWING;
      ka[i] = dc[cons[0]!]!;
      ku[i] = du[cons[0]!]!;
    } else if (cons.length === 2 && du[cons[0]!] === du[cons[1]!]) {
      kind[i] = ARM;
      ka[i] = dc[cons[0]!]!;
      kb[i] = dc[cons[1]!]!;
      ku[i] = du[cons[0]!]!;
    } else throw new Error(`${what}: member '${member}' is neither a rod nor an A-arm`);
    return i;
  };
  const springLowerIdx = count - 1;
  const lower = axle.spring.lower;
  if (lower.on === 'upright') {
    const i = idx(lower.point, 'spring');
    if (kind[i] !== UPRIGHT) throw new Error(`spring lower point '${lower.point}' is not an upright point`);
    kind[springLowerIdx] = UPRIGHT;
  } else if (lower.on === 'arm') {
    attach(lower.point, lower.member, 'spring');
  } else {
    const cons = members.get(lower.member);
    if (!cons || cons.length !== 1) throw new Error(`spring: member '${lower.member}' must be a single rod`);
    kind[springLowerIdx] = FRACTION;
    ka[springLowerIdx] = dc[cons[0]!]!;
    ku[springLowerIdx] = du[cons[0]!]!;
    kf[springLowerIdx] = lower.fraction;
  }
  if (axle.antiRollBarMount) attach(axle.antiRollBarMount.point, axle.antiRollBarMount.member, 'antiRollBarMount');
  // Spring lower design position.
  if (lower.on === 'link') {
    const c = ka[springLowerIdx]! * 3;
    const u = ku[springLowerIdx]! * 3;
    for (let k = 0; k < 3; k++) p0[springLowerIdx * 3 + k] = p0[c + k]! + kf[springLowerIdx]! * (p0[u + k]! - p0[c + k]!);
  } else {
    const src = idx(lower.point, 'spring');
    p0.copyWithin(springLowerIdx * 3, src * 3, src * 3 + 3);
    if (kind[springLowerIdx] !== UPRIGHT) {
      kind[springLowerIdx] = kind[src]!;
      ka[springLowerIdx] = ka[src]!;
      kb[springLowerIdx] = kb[src]!;
      ku[springLowerIdx] = ku[src]!;
    }
  }
  const springUpperIdx = idx(axle.spring.upper, 'spring upper');
  if (kind[springUpperIdx] !== CHASSIS) throw new Error('spring upper must be a chassis point');

  const wc0: V3 = [p0[wcIdx * 3]!, p0[wcIdx * 3 + 1]!, p0[wcIdx * 3 + 2]!];
  const { camber, toe } = axle.alignment;
  const axle0: V3 = [dsin(toe) * dcos(camber), dcos(toe) * dcos(camber), -dsin(camber)];
  // Lowest point of the tyre circle at design.
  const ux = -(-axle0[2]) * axle0[0];
  const uy = -(-axle0[2]) * axle0[1];
  const uz = -1 + axle0[2] * axle0[2];
  const groundZ = wc0[2] + (tyreRadius * uz) / hypot3(ux, uy, uz);

  // Scratch (allocation-free residuals / placement).
  const R = m3.create();
  const v: V3 = [0, 0, 0];
  const w: V3 = [0, 0, 0];
  const n: V3 = [0, 0, 0];
  const q0: V3 = [0, 0, 0];
  const q: V3 = [0, 0, 0];
  const nDist = du.length;
  const duA = Int32Array.from(du);
  const dcA = Int32Array.from(dc);
  const dL2A = Float64Array.from(dL2);

  const sp: Spatial = {
    names,
    p0,
    wc0,
    axle0,
    tyreRadius,
    groundZ,
    steerIdx,
    toeIdx,
    springUpperIdx,
    springLowerIdx,
    travel: 0,
    rack: 0,
    toeShift: 0,
    rotation(x, out) {
      w[0] = x[3]!;
      w[1] = x[4]!;
      w[2] = x[5]!;
      return m3.fromRotationVector(out, w);
    },
    residuals(x, r) {
      sp.rotation(x, R);
      let k = 0;
      for (let c = 0; c < nDist; c++) {
        const u = duA[c]! * 3;
        const ch = dcA[c]!;
        sub3(p0, u, wc0, 0, v);
        const px = R[0] * v[0] + R[1] * v[1] + R[2] * v[2] + wc0[0] + x[0]! - p0[ch * 3]!;
        let py = R[3] * v[0] + R[4] * v[1] + R[5] * v[2] + wc0[1] + x[1]! - p0[ch * 3 + 1]!;
        const pz = R[6] * v[0] + R[7] * v[1] + R[8] * v[2] + wc0[2] + x[2]! - p0[ch * 3 + 2]!;
        if (ch === steerIdx) py -= sp.rack;
        if (ch === toeIdx) py -= sp.toeShift;
        r[k++] = px * px + py * py + pz * pz - dL2A[c]!;
      }
      if (strut) {
        const s = strut.s * 3;
        const t = strut.t * 3;
        sub3(p0, s, wc0, 0, v);
        const dx = p0[t]! - (R[0] * v[0] + R[1] * v[1] + R[2] * v[2] + wc0[0] + x[0]!);
        const dy = p0[t + 1]! - (R[3] * v[0] + R[4] * v[1] + R[5] * v[2] + wc0[1] + x[1]!);
        const dz = p0[t + 2]! - (R[6] * v[0] + R[7] * v[1] + R[8] * v[2] + wc0[2] + x[2]!);
        const { e1, e2 } = strut;
        r[k++] = dx * (R[0] * e1[0] + R[1] * e1[1] + R[2] * e1[2]) + dy * (R[3] * e1[0] + R[4] * e1[1] + R[5] * e1[2]) + dz * (R[6] * e1[0] + R[7] * e1[1] + R[8] * e1[2]);
        r[k++] = dx * (R[0] * e2[0] + R[1] * e2[1] + R[2] * e2[2]) + dy * (R[3] * e2[0] + R[4] * e2[1] + R[5] * e2[2]) + dz * (R[6] * e2[0] + R[7] * e2[1] + R[8] * e2[2]);
      }
      r[k] = x[2]! - sp.travel; // wheel-centre z = z0 + travel
    },
    pointsAt(x, out) {
      sp.rotation(x, R);
      for (let i = 0; i < count; i++) {
        const o = i * 3;
        if (kind[i] === CHASSIS) {
          out[o] = p0[o]!;
          out[o + 1] = p0[o + 1]! + (i === steerIdx ? sp.rack : 0) + (i === toeIdx ? sp.toeShift : 0);
          out[o + 2] = p0[o + 2]!;
        } else if (kind[i] === UPRIGHT) {
          sub3(p0, o, wc0, 0, v);
          out[o] = R[0] * v[0] + R[1] * v[1] + R[2] * v[2] + wc0[0] + x[0]!;
          out[o + 1] = R[3] * v[0] + R[4] * v[1] + R[5] * v[2] + wc0[1] + x[1]!;
          out[o + 2] = R[6] * v[0] + R[7] * v[1] + R[8] * v[2] + wc0[2] + x[2]!;
        }
      }
      // Arm/link points depend on chassis + upright points placed above.
      for (let i = 0; i < count; i++) {
        const o = i * 3;
        const k = kind[i];
        if (k === CHASSIS || k === UPRIGHT) continue;
        const a = ka[i]! * 3;
        const u = ku[i]! * 3;
        if (k === FRACTION) {
          for (let j = 0; j < 3; j++) out[o + j] = out[a + j]! + kf[i]! * (out[u + j]! - out[a + j]!);
          continue;
        }
        let angle: number;
        if (k === ARM) {
          const b = kb[i]! * 3;
          unit(n, out[b]! - out[a]!, out[b + 1]! - out[a + 1]!, out[b + 2]! - out[a + 2]!);
          sub3(p0, u, out, a, q0);
          sub3(out, u, out, a, q);
          const d0 = q0[0] * n[0] + q0[1] * n[1] + q0[2] * n[2];
          const d1 = q[0] * n[0] + q[1] * n[1] + q[2] * n[2];
          for (let j = 0; j < 3; j++) {
            q0[j] = q0[j]! - d0 * n[j]!;
            q[j] = q[j]! - d1 * n[j]!;
          }
          const cx = q0[1] * q[2] - q0[2] * q[1];
          const cy = q0[2] * q[0] - q0[0] * q[2];
          const cz = q0[0] * q[1] - q0[1] * q[0];
          angle = datan2(n[0] * cx + n[1] * cy + n[2] * cz, q0[0] * q[0] + q0[1] * q[1] + q0[2] * q[2]);
        } else {
          // Swing: rotate the rod from its design direction to the current one about its chassis end.
          sub3(p0, u, p0, a, q0);
          sub3(out, u, out, a, q);
          const cx = q0[1] * q[2] - q0[2] * q[1];
          const cy = q0[2] * q[0] - q0[0] * q[2];
          const cz = q0[0] * q[1] - q0[1] * q[0];
          const s = hypot3(cx, cy, cz);
          angle = datan2(s, q0[0] * q[0] + q0[1] * q[1] + q0[2] * q[2]);
          if (s < 1e-15) n[0] = n[1] = n[2] = 0;
          else unit(n, cx, cy, cz);
        }
        sub3(p0, o, p0, a, v);
        rotateAbout(n, angle, v, out, o);
        for (let j = 0; j < 3; j++) out[o + j]! += out[a + j]!;
      }
      return out;
    },
  };
  return sp;
}
