/**
 * Wheel metrics from a solved upright pose (research 03 §3.3). Rates (camber gain, instant centre, steer axis,
 * anti-pitch, motion ratio) use the exact solution tangent from the implicit-function theorem,
 * J dx/ds = -dr/ds, instead of re-solving at neighbouring poses.
 */
import * as m3 from '../math/mat';
import { solveInPlace } from '../math/linsolve';
import { hypot2, hypot3, type V3 } from '../math/vec3';
import type { LmSolver } from './lm';
import type { Spatial } from './spatial';
import { dasin, datan2 } from '../math/det';

/** Parameter a tangent is taken with respect to. 'toe' shifts the steer/toe-link inner point in Y. */
export type TangentParam = 'travel' | 'rack' | 'toe';

export interface WheelState {
  camber: number;
  toe: number;
  readonly R: m3.Mat3;
  /** Spin axis (left wheel, outward). */
  readonly axle: V3;
  readonly wc: V3;
  /** Contact patch: lowest point of the tyre circle. */
  readonly cp: V3;
}

/** Rigid-body velocity of the upright per unit parameter: wheel-centre velocity v and angular velocity w. */
export interface Twist {
  readonly v: V3;
  readonly w: V3;
}

export const createWheelState = (): WheelState => ({ camber: 0, toe: 0, R: m3.create(), axle: [0, 0, 0], wc: [0, 0, 0], cp: [0, 0, 0] });
export const createTwist = (): Twist => ({ v: [0, 0, 0], w: [0, 0, 0] });

export function wheelState(sp: Spatial, x: Float64Array, out: WheelState): WheelState {
  const R = sp.rotation(x, out.R);
  const [a0x, a0y, a0z] = sp.axle0;
  const a = out.axle;
  a[0] = R[0] * a0x + R[1] * a0y + R[2] * a0z;
  a[1] = R[3] * a0x + R[4] * a0y + R[5] * a0z;
  a[2] = R[6] * a0x + R[7] * a0y + R[8] * a0z;
  out.camber = -dasin(a[2]);
  out.toe = datan2(a[0], a[1]);
  const wc = out.wc;
  wc[0] = sp.wc0[0] + x[0]!;
  wc[1] = sp.wc0[1] + x[1]!;
  wc[2] = sp.wc0[2] + x[2]!;
  const ux = a[2] * a[0];
  const uy = a[2] * a[1];
  const uz = -1 + a[2] * a[2];
  const k = sp.tyreRadius / hypot3(ux, uy, uz);
  out.cp[0] = wc[0] + ux * k;
  out.cp[1] = wc[1] + uy * k;
  out.cp[2] = wc[2] + uz * k;
  return out;
}

export interface TangentTools {
  /** dx/ds at a converged pose x (x unchanged). False if the linkage is singular there. */
  tangent(x: Float64Array, param: TangentParam, out: Float64Array): boolean;
  /** Upright twist for a pose x moving along dx (from `tangent`). */
  twist(x: Float64Array, dx: Float64Array, out: Twist): Twist;
}

export function createTangentTools(sp: Spatial, lm: LmSolver): TangentTools {
  const rp = new Float64Array(6);
  const rm = new Float64Array(6);
  const A = new Float64Array(36);
  const xp = new Float64Array(6);
  const Rp = m3.create();
  const Rm = m3.create();
  const R = m3.create();
  const H = 1e-6;
  const shift = (param: TangentParam, d: number): void => {
    if (param === 'travel') sp.travel += d;
    else if (param === 'rack') sp.rack += d;
    else sp.toeShift += d;
  };
  return {
    tangent(x, param, out) {
      lm.jacobian(sp.residuals, x);
      shift(param, H);
      sp.residuals(x, rp);
      shift(param, -2 * H);
      sp.residuals(x, rm);
      shift(param, H);
      for (let i = 0; i < 6; i++) out[i] = -(rp[i]! - rm[i]!) / (2 * H);
      A.set(lm.J);
      return solveInPlace(A, out, 6);
    },
    twist(x, dx, out) {
      const e = 1e-6;
      for (let i = 0; i < 6; i++) xp[i] = x[i]! + e * dx[i]!;
      sp.rotation(xp, Rp);
      for (let i = 0; i < 6; i++) xp[i] = x[i]! - e * dx[i]!;
      sp.rotation(xp, Rm);
      sp.rotation(x, R);
      // dR/ds R^T = skew(w)
      for (let i = 0; i < 9; i++) Rp[i] = (Rp[i]! - Rm[i]!) / (2 * e);
      m3.transpose(Rm, R);
      m3.multiply(R, Rp, Rm);
      out.w[0] = (R[7] - R[5]) / 2;
      out.w[1] = (R[2] - R[6]) / 2;
      out.w[2] = (R[3] - R[1]) / 2;
      out.v[0] = dx[0]!;
      out.v[1] = dx[1]!;
      out.v[2] = dx[2]!;
      return out;
    },
  };
}

/** Velocity (per unit parameter) of the upright material point currently at p. */
export function pointVelocity(tw: Twist, wc: V3, p: V3, out: V3): V3 {
  const rx = p[0] - wc[0];
  const ry = p[1] - wc[1];
  const rz = p[2] - wc[2];
  const [wx, wy, wz] = tw.w;
  out[0] = tw.v[0] + wy * rz - wz * ry;
  out[1] = tw.v[1] + wz * rx - wx * rz;
  out[2] = tw.v[2] + wx * ry - wy * rx;
  return out;
}

/** Instantaneous screw axis of a twist: unit direction k (k_z >= 0) and the point p on it closest to the wheel centre. */
export function screwAxis(tw: Twist, wc: V3, k: V3, p: V3): void {
  const [wx, wy, wz] = tw.w;
  const w2 = wx * wx + wy * wy + wz * wz;
  const [vx, vy, vz] = tw.v;
  p[0] = wc[0] + (wy * vz - wz * vy) / w2;
  p[1] = wc[1] + (wz * vx - wx * vz) / w2;
  p[2] = wc[2] + (wx * vy - wy * vx) / w2;
  const s = (wz < 0 ? -1 : 1) / Math.sqrt(w2);
  k[0] = wx * s;
  k[1] = wy * s;
  k[2] = wz * s;
}

export interface SteerAxisMetrics {
  /** Kingpin inclination, rad (top leaning inboard positive). */
  kpi: number;
  /** Caster, rad (top leaning rearward positive). */
  caster: number;
  /** Ground offset, m (positive when the axis meets the ground inboard of the contact patch). */
  scrub: number;
  /** Mechanical trail, m (positive when the axis meets the ground ahead of the contact patch). */
  trail: number;
}

/** Steering (or virtual toe) axis metrics from the 'rack'/'toe' twist at a pose. */
export function steerAxisMetrics(tw: Twist, ws: WheelState, groundZ: number): SteerAxisMetrics {
  const k: V3 = [0, 0, 0];
  const p: V3 = [0, 0, 0];
  screwAxis(tw, ws.wc, k, p);
  const t = (groundZ - p[2]) / k[2];
  const gx = p[0] + t * k[0];
  const gy = p[1] + t * k[1];
  return {
    kpi: datan2(-k[1], k[2]),
    caster: datan2(-k[0], k[2]),
    scrub: ws.cp[1] - gy,
    trail: gx - ws.cp[0],
  };
}

/** Front-view IC farther than this (parallel arms) is placed at this distance along its line, m. */
export const IC_FAR = 1000;

/**
 * Front-view instant centre of the contact patch, IC = cp + (-v_z, v_y)/w_x (research 03 §3.3), written to
 * ic (x = cp x). dir gets the unit (y, z) direction from the patch toward the IC: the line is perpendicular to
 * the patch velocity, so it stays defined for parallel arms (IC at infinity, clamped to IC_FAR).
 */
export function instantCentre(vcp: V3, wx: number, cp: V3, ic: V3, dir: V3): void {
  const l = hypot2(vcp[2], vcp[1]);
  const s = wx < 0 ? -1 : 1;
  dir[0] = (-vcp[2] / l) * s;
  dir[1] = (vcp[1] / l) * s;
  dir[2] = 0;
  const d = Math.min(l / Math.abs(wx), IC_FAR);
  ic[0] = cp[0];
  ic[1] = cp[1] + dir[0] * d;
  ic[2] = cp[2] + dir[1] * d;
}
