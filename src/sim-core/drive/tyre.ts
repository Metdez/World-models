/**
 * Tyre force model for the plant (ARCHITECTURE-M2 §7.4; research m2/04 §4–§8, m2/12 §3). The signature is frozen;
 * this is the v0 BODY (08-02): the normalised curve is linear + saturation f(s) = min(s, 1) and the camber term is
 * left out (camberRatio treated as 0). 09-01 replaces the body with the unit-slope Magic Formula curve and camber.
 *
 * Inputs are contact-patch DEFLECTIONS (ux, uy, m; state of the relaxation lag kept by the plant), so slip is
 * kappa = ux / sigmaX and tan(alpha) = uy / sigmaY: non-singular at v = 0 (research m2/12 §3.2).
 * Peak force D = peakMu(load, camber to road) * surface muScale * load: the SAME peak as Auto's gripUse.
 * Low speed (|vx| < 1.5 m/s): a damper on the patch slip velocity (critical for the patch spring on the corner mass)
 * fades in, so the patch behaves like a stiff bristle at standstill (holds on a slope, no creep jitter).
 * Signs (§4): fx + = driving (forward), slipVx = R*omega - vx; fy restores against uy (+ uy = patch sliding left).
 */
import { G } from '../../contracts/units';
import type { TyreHandling, TyreParams } from '../../contracts/vehicle';
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

/** g(x) = 2x / (1 + x^2) (= sin(2 atan x), no trig). */
const gShape = (x: number): number => (2 * x) / (1 + x * x);

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
  };
}

/** Low-speed blend: 1 below 0.5 m/s, 0 above 1.5 m/s. */
function lowSpeed(v: number): number {
  const t = Math.min(1, Math.max(0, (Math.abs(v) - 0.5) / 1.0));
  return 1 - t * t * (3 - 2 * t);
}

export function evaluateTyre(params: TyreParams, c: TyreCoefficients, io: TyreIo): void {
  const load = io.load;
  if (!(load > 0)) {
    io.fx = 0;
    io.fy = 0;
    io.capacity = 0;
    io.slipAngle = io.uy / c.sigmaY;
    io.slipRatio = io.ux / c.sigmaX;
    io.slopeX = (0.05 * c.c0Kappa) / c.sigmaX;
    io.dampX = 0;
    return;
  }
  const mu = peakMu(load, io.camberToRoad, params) * io.muScale;
  const D = mu * load;
  const shape = gShape(load / (c.loadShape * params.nominalLoad)) / c.g0;
  const ca = c.c0Alpha * shape;
  const ck = c.c0Kappa * shape;
  // v0: no camber thrust (09-01 adds tanA -= camberRatio * inclination).
  const tanA = io.uy / c.sigmaY;
  const kap = io.ux / c.sigmaX;
  let fx: number;
  let fy: number;
  let ratio: number; // f(s) / s
  if (D > 0) {
    const sx = (ck * kap) / D;
    const sy = (ca * tanA) / D;
    const s = Math.sqrt(sx * sx + sy * sy);
    ratio = s <= 1 ? 1 : 1 / s; // v0 curve f(s) = min(s, 1)
    fx = ck * kap * ratio;
    fy = -ca * tanA * ratio;
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
  io.slipAngle = tanA;
  io.slipRatio = kap;
  io.slopeX = (ck / c.sigmaX) * Math.max(0.05, ratio);
  io.dampX = dampX;
}

/**
 * A sliding patch cannot store more deflection than its elastic limit: scales (ux, uy) back onto the saturation
 * boundary s = 1 of the curve (brush/bristle model). Without it, spinning at standstill would wind up deflection that
 * keeps pushing after the spin stops. v0 boundary; 09-01 moves it to the peak of its curve.
 */
export function limitDeflection(params: TyreParams, c: TyreCoefficients, io: TyreIo): void {
  const load = io.load;
  if (!(load > 0)) return;
  const D = peakMu(load, io.camberToRoad, params) * io.muScale * load;
  const shape = gShape(load / (c.loadShape * params.nominalLoad)) / c.g0;
  const sx = (c.c0Kappa * shape * io.ux) / (c.sigmaX * D);
  const sy = (c.c0Alpha * shape * io.uy) / (c.sigmaY * D);
  const s2 = sx * sx + sy * sy;
  if (s2 > 1) {
    const k = 1 / Math.sqrt(s2);
    io.ux *= k;
    io.uy *= k;
  }
}
