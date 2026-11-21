/**
 * Tyre force model for the plant (ARCHITECTURE-M2 §7.4; research m2/04 §4–§8, m2/12 §3). The signature is frozen.
 *
 * One normalised combined-slip curve (research m2/04 §6.1, similarity method): the unit-slope Magic Formula
 *   f(s) = sin(C atan(B s - E (B s - atan(B s)))), B = 1/C  (f(0) = 0, f'(0) = 1)
 * on the normalised slip s = |(C_kappa kappa, C_alpha tan(alpha)) / D|, D = peakMu(load, camber to road) * muScale * load
 * (the SAME peak as Auto's gripUse). It peaks at f = 1 (|F| = D) near s = 3.2 for C = 1.35 and falls towards
 * sin(C pi/2) (0.85 D) when sliding: a locked or spinning wheel loses grip, and the resultant never leaves the circle.
 * Camber thrust enters as an equivalent slip: tan(alpha_eq) = uy / sigmaY - camberRatio * inclination (a wheel whose
 * top leans left pushes left). C_alpha(N), C_kappa(N) follow g(x) = 2x / (1 + x^2) (rise, flatten, fall past k*N0).
 *
 * Inputs are contact-patch DEFLECTIONS (ux, uy, m; the relaxation-lag state kept by the plant), so slip is
 * kappa = ux / sigmaX and tan(alpha) = uy / sigmaY: non-singular at v = 0 (research m2/12 §3.2); `relax` is the
 * plant's backward-Euler update of that state. Low speed (|vx| < 1.5 m/s): a damper on the patch slip velocity
 * (critical for the patch spring on the corner mass) fades in, so the patch holds like a stiff bristle at standstill.
 * Signs (§4): fx + = driving (forward), slipVx = R*omega - vx; fy restores against uy (+ uy = patch sliding left).
 *
 * Ideas (no code) from Project Chrono's ChPac02Tire (BSD-3-Clause): MF curve shape, the epsilon-free deflection form.
 */
import { G } from '../../contracts/units';
import type { TyreHandling, TyreParams } from '../../contracts/vehicle';
import { datan, dsin, dtan } from '../math/det';
import { peakMu } from '../ride/tyre';

export interface TyreCoefficients {
  readonly c0Alpha: number;
  readonly c0Kappa: number;
  readonly g0: number;
  readonly loadShape: number;
  readonly sigmaY: number;
  readonly sigmaX: number;
  readonly shape: number;
  readonly curvature: number;
  readonly camberRatio: number;
  /** Normalised slip s at the curve's peak (f = 1); Infinity when the curve has no peak (shape <= 1). */
  readonly peakSlip: number;
}

/** One preallocated record per wheel; inputs then outputs. */
export interface TyreIo {
  load: number;
  ux: number;
  uy: number;
  vx: number;
  /** R*omega - vx, m/s. */
  slipVx: number;
  vy: number;
  inclination: number;
  camberToRoad: number;
  muScale: number;
  fx: number;
  fy: number;
  capacity: number;
  slipAngle: number;
  slipRatio: number;
  /** Secant dFx/dux, N/m, floored at 0.05 * C_kappa / sigmaX (implicit spin update). */
  slopeX: number;
  /** Low-speed damping coefficient on slipVx actually applied, N s/m. */
  dampX: number;
}

export const createTyreIo = (): TyreIo => ({
  load: 0,
  ux: 0,
  uy: 0,
  vx: 0,
  slipVx: 0,
  vy: 0,
  inclination: 0,
  camberToRoad: 0,
  muScale: 1,
  fx: 0,
  fy: 0,
  capacity: 0,
  slipAngle: 0,
  slipRatio: 0,
  slopeX: 0,
  dampX: 0,
});

/**
 * The stored deflection of a sliding patch is bounded at this multiple of the peak slip. There the curve has fallen
 * most of the way to its sliding level (C = 1.35: f = 0.92 vs 0.85 at infinite slip), so a locked or spinning wheel
 * at speed still sees the falling branch and the force hardly depends on dt; at standstill (no relaxation) a spun
 * wheel cannot wind up unbounded deflection that keeps pushing after the spin stops.
 */
export const SLIDE_BOUND = 4;

/** g(x) = 2x / (1 + x^2) (= sin(2 atan x), no trig). */
const gShape = (x: number): number => (2 * x) / (1 + x * x);

/** The unit-slope Magic Formula curve f(s) (s >= 0). */
export function slipCurve(s: number, shape: number, curvature: number): number {
  const bs = s / shape;
  return dsin(shape * datan(bs - curvature * (bs - datan(bs))));
}

/** Peak of f: solves B s - E (B s - atan(B s)) = tan(pi / (2 C)) by bisection (once per axle, monotone for E < 1). */
function peakSlipOf(shape: number, curvature: number): number {
  if (!(shape > 1)) return Infinity;
  const target = dtan(Math.PI / (2 * shape));
  const phi = (s: number): number => {
    const bs = s / shape;
    return bs - curvature * (bs - datan(bs));
  };
  let lo = 0;
  let hi = 1;
  while (phi(hi) < target) hi *= 2;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (phi(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Per-axle constants (once): nominal stiffnesses N/rad and N/unit slip at the nominal load. */
export function tyreCoefficients(params: TyreParams, handling: TyreHandling): TyreCoefficients {
  const n0 = params.nominalLoad;
  return {
    c0Alpha: handling.corneringStiffness * n0,
    c0Kappa: handling.slipStiffness * n0,
    g0: gShape(1 / handling.stiffnessLoadShape),
    loadShape: handling.stiffnessLoadShape,
    sigmaY: handling.relaxationLateral,
    sigmaX: handling.relaxationLongitudinal,
    shape: handling.shape,
    curvature: handling.curvature,
    camberRatio: handling.camberRatio,
    peakSlip: peakSlipOf(handling.shape, handling.curvature),
  };
}

/**
 * Relaxation lag of one deflection state, backward Euler (unconditionally stable, non-singular at v = 0):
 * u' = rate - |vx| / sigma * u  ->  u_new = (u + dt * rate) / (1 + dt * |vx| / sigma). Steady state u = sigma * rate / |vx|.
 */
export const relax = (u: number, rate: number, vx: number, sigma: number, dt: number): number =>
  (u + dt * rate) / (1 + (dt * Math.abs(vx)) / sigma);

/** Low-speed blend: 1 below 0.5 m/s, 0 above 1.5 m/s. */
function lowSpeed(v: number): number {
  const t = Math.min(1, Math.max(0, (Math.abs(v) - 0.5) / 1.0));
  return 1 - t * t * (3 - 2 * t);
}

export function evaluateTyre(params: TyreParams, c: TyreCoefficients, io: TyreIo): void {
  const load = io.load;
  const tanA = io.uy / c.sigmaY - c.camberRatio * io.inclination;
  const kap = io.ux / c.sigmaX;
  io.slipAngle = tanA;
  io.slipRatio = kap;
  if (!(load > 0)) {
    io.fx = 0;
    io.fy = 0;
    io.capacity = 0;
    io.slopeX = (0.05 * c.c0Kappa) / c.sigmaX;
    io.dampX = 0;
    return;
  }
  const D = peakMu(load, io.camberToRoad, params) * io.muScale * load;
  const shape = gShape(load / (c.loadShape * params.nominalLoad)) / c.g0;
  const ca = c.c0Alpha * shape;
  const ck = c.c0Kappa * shape;
  let fx: number;
  let fy: number;
  let ratio: number; // f(s) / s
  if (D > 0) {
    const sx = (ck * kap) / D;
    const sy = (ca * tanA) / D;
    const s = Math.sqrt(sx * sx + sy * sy);
    ratio = s < 1e-6 ? 1 : slipCurve(s, c.shape, c.curvature) / s;
    fx = D * sx * ratio;
    fy = -D * sy * ratio;
  } else {
    ratio = 0;
    fx = 0;
    fy = 0;
  }
  const w = lowSpeed(io.vx);
  let dampX = 0;
  if (w > 0) {
    const m = load / G;
    dampX = w * 2 * Math.sqrt((ck / c.sigmaX) * m);
    fx += dampX * io.slipVx;
    fy -= w * 2 * Math.sqrt((ca / c.sigmaY) * m) * io.vy;
  }
  const f2 = fx * fx + fy * fy;
  if (f2 > D * D) {
    const k = D / Math.sqrt(f2);
    fx *= k;
    fy *= k;
  }
  io.fx = fx;
  io.fy = fy;
  io.capacity = D;
  io.slopeX = (ck / c.sigmaX) * Math.max(0.05, ratio);
  io.dampX = dampX;
}

/**
 * A sliding patch cannot store more deflection than its slide bound (SLIDE_BOUND x the peak slip, where the curve is
 * close to its sliding level): scales the stored (ux, uy) back onto that boundary. Camber thrust is part of the
 * equivalent slip, so the bound applies to (kappa, tan(alpha) incl. the camber term) and the camber offset is kept.
 */
export function limitDeflection(params: TyreParams, c: TyreCoefficients, io: TyreIo): void {
  const load = io.load;
  if (!(load > 0) || !(c.peakSlip < Infinity)) return;
  const D = peakMu(load, io.camberToRoad, params) * io.muScale * load;
  if (!(D > 0)) return;
  const shape = gShape(load / (c.loadShape * params.nominalLoad)) / c.g0;
  const camber = c.camberRatio * io.inclination;
  const sx = (c.c0Kappa * shape * io.ux) / (c.sigmaX * D);
  const sy = (c.c0Alpha * shape * (io.uy / c.sigmaY - camber)) / D;
  const s2 = sx * sx + sy * sy;
  const bound = SLIDE_BOUND * c.peakSlip;
  if (s2 > bound * bound) {
    const k = bound / Math.sqrt(s2);
    io.ux *= k;
    io.uy = c.sigmaY * (camber + (io.uy / c.sigmaY - camber) * k);
  }
}

/** Cornering and slip stiffness (N/rad, N/unit slip) and peak force (N) at a load: for steady-state seeding. */
export function stiffnessAt(params: TyreParams, c: TyreCoefficients, load: number, out: Float64Array): Float64Array {
  if (!(load > 0)) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    return out;
  }
  const shape = gShape(load / (c.loadShape * params.nominalLoad)) / c.g0;
  out[0] = c.c0Alpha * shape;
  out[1] = c.c0Kappa * shape;
  out[2] = peakMu(load, 0, params) * load;
  return out;
}
