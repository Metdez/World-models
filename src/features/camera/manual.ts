/**
 * Manual Drive chase target (ARCHITECTURE-M2 §10.3, research m2/08 §3.2). The future path is unknown, so the target
 * heading is PREDICTED from the velocity direction (at speed), the measured yaw rate and the commanded steer.
 * Every number in MANUAL is an engineering estimate (research [E]) kept in this one block for tuning on a real GPU.
 * Exponential decay and a look point that leads the eye follow icurtis1/raycast-vehicle (MIT, (c) 2026 Ian Curtis) in
 * idea only; no code is copied.
 */
import type { DriveFrame } from '../../contracts/drive';
import { clamp, wrapAngle } from './damp';

const DEG = Math.PI / 180;

export const MANUAL = {
  /** Auto <-> Manual target cross-fade, s. */
  blendS: 0.8,
  /** The velocity direction is followed only within this angle of the heading, rad (a spin never swings the camera
   * past it). */
  slipMax: 30 * DEG,
  /** Past slipMax the car is spinning, not drifting: the slip offset and the steer-based yaw prediction fade out
   * between these sideslips, rad, so the camera returns to the heading gradually (no snap when the speed drops or the
   * car turns backwards). */
  slipFade: [30 * DEG, 90 * DEG] as const,
  /** Forward speed band over which the velocity direction takes over from the heading, m/s (0 below and in reverse). */
  velBlend: [3, 10] as const,
  /** Prediction horizon for the yaw lead, s, and its clamp, rad. */
  tau: 0.35,
  leadMax: 18 * DEG,
  /** Offsets of the target from the heading below this are ignored (bumps and steering micro-corrections), rad. */
  deadZone: 1.5 * DEG,
  /** Look-ahead distance along the target heading for a 2.8 m wheelbase, m (scales with the wheelbase). */
  aheadM: 5,
  refWheelbase: 2.8,
  /** Heading lag (camera vs target) at which the follow rate has doubled, rad; past `hardLag` it is clamped. */
  softLag: 0.55,
  hardLag: 1.2,
  /** Vertical anchor smoothing (body height: crests and dips yes, kerb chatter no), 1/s. */
  zLambda: 12,
  /** Eye clearance over the ground under it, m. */
  clearance: 0.7,
  /** The anchor moving farther than this between frames is a teleport: cut, m. */
  cutJumpM: 15,
} as const;

/** Hermite smoothstep of x over [e0, e1]. */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Target camera heading (sim yaw, rad) for a driven car: heading + weighted sideslip + yaw lead, with a dead zone.
 * Reverse and standstill are heading-based (the camera stays behind the car; no flip at v ~ 0).
 */
export function manualHeading(d: DriveFrame, yawRate: number, steer: number, wheelbase: number): number {
  const raw = Math.atan2(d.v, d.u);
  // 1 while the tyres roll roughly along the heading, 0 in a spin or sliding backwards.
  const rolling = 1 - smoothstep(MANUAL.slipFade[0], MANUAL.slipFade[1], Math.abs(raw));
  const slip = clamp(raw, -MANUAL.slipMax, MANUAL.slipMax) * rolling;
  const wVel = d.u > 0 ? smoothstep(MANUAL.velBlend[0], MANUAL.velBlend[1], d.u) : 0;
  // Steady-state yaw rate from the commanded steer leads the measured one (the body responds later); it means
  // nothing once the car spins, so it fades out with `rolling`.
  const rSteady = (rolling * d.u * Math.tan(steer)) / wheelbase;
  const lead = clamp(MANUAL.tau * 0.5 * (yawRate + rSteady), -MANUAL.leadMax, MANUAL.leadMax);
  const off = wVel * slip + lead;
  const mag = Math.abs(off) - MANUAL.deadZone;
  return wrapAngle(d.yaw + (mag > 0 ? Math.sign(off) * mag : 0));
}

/**
 * Exponential smoothing toward a target that moved linearly from `prev` to `target` during `dt` (exact solution of
 * x' = lambda (T - x)). Unlike damp() it has no frame-rate dependent lag while the target moves.
 */
export function dampRamp(x: number, prev: number, target: number, lambda: number, dt: number): number {
  if (!(dt > 0)) return x;
  const lead = (target - prev) / (dt * lambda);
  return target - lead + (x - prev + lead) * Math.exp(-lambda * dt);
}

/** dampRamp() for angles (rad): shortest arcs, result wrapped. */
export function dampAngleRamp(a: number, prev: number, target: number, lambda: number, dt: number): number {
  const p = a + wrapAngle(prev - a);
  return wrapAngle(dampRamp(a, p, p + wrapAngle(target - prev), lambda, dt));
}
