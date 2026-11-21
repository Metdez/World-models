/**
 * Driver aids (ARCHITECTURE-M2 §7.8; research m2/06 §5). Every aid is "Assist: simplified model" — a few lines of
 * textbook logic, never a manufacturer's system — individually switchable through DriveAids and reported every step
 * through the DriveFrame flags (absActive, tractionActive, stabilityActive).
 * - ABS: per-wheel pressure factor that drops while the wheel's slip ratio is beyond the brake peak, recovers otherwise
 *   (the pulse idea of Godot-Easy-Vehicle-Physics' wheel.gd, MIT, (c) 2024 David Shoemaker, (c) 2021 Dechode;
 *   re-expressed as a smooth factor, no code copied).
 * - Traction: the engine-torque scale target on the driven wheels' slip speed (applied, low-passed, in powertrain.ts;
 *   GEVP's slip cut made smooth).
 * - Stability: yaw-rate error against a bicycle-model target; corrects by SELECTIVE BRAKING only (oversteer: the outer
 *   front wheel, understeer: the inner rear) plus a throttle cut — no invisible yaw torque on the body.
 * - Steering helpers for keyboards (aids.steering; used by HumanDriver): the speed-dependent grip-limit steering cap
 *   and countersteer help (GEVP's countersteer assist / ArcadeCarPhysics' speed-limited steering, MIT, ideas only).
 */
import type { DriveAids } from '../../contracts/drive';
import type { CarDefinition } from '../../contracts/vehicle';
import { datan } from '../math/det';
import { smoothstep } from '../math/interp';
import type { PlantView } from './types';

export interface AidsIo {
  /** In/out per wheel (FL, FR, RL, RR), N m (>= 0): ABS scales it, stability adds to one wheel. */
  readonly brakeTorque: Float64Array;
  /** In, per wheel (previous step). */
  readonly slipRatio: Float64Array;
  /** Actuator road-wheel angle, rad (+ left). */
  steerAct: number;
  u: number;
  r: number;
  beta: number;
  /** In: handbrake lever 0..1 (ABS releases the rear wheels to it; addition to the §7.1 shape). */
  handbrake: number;
  /** Out: multiplies the throttle (stability). */
  throttleScale: number;
  absActive: boolean;
  stabilityActive: boolean;
}

export interface Aids {
  reset(): void;
  step(dt: number, io: AidsIo, aids: DriveAids, view: PlantView): void;
}

export const createAidsIo = (): AidsIo => ({
  brakeTorque: new Float64Array(4),
  slipRatio: new Float64Array(4),
  steerAct: 0,
  u: 0,
  r: 0,
  beta: 0,
  handbrake: 0,
  throttleScale: 1,
  absActive: false,
  stabilityActive: false,
});

// ---- ABS (§7.8)
const ABS_SLIP = -0.12;
const ABS_RELEASE = 0.04; // s from full pressure to none
const ABS_APPLY = 0.12; // s from none back to full
const ABS_FLOOR = 0.1;
/** Brake torque below this (N m) counts as "not braking". */
const ABS_MIN_TORQUE = 1;

// ---- Stability (§7.8)
const K_REF = 0.0018; // rad s^2/m: mild understeer reference
const ESC_SPEED = 5;
const ESC_DEADBAND = 0.08; // rad/s
const ESC_BETA = 0.1; // rad
const ESC_GAIN = 4; // 1/s
const ESC_MAX_TORQUE = 1500; // N m
const ESC_THROTTLE = 0.5;
/** The flag and the throttle cut stay on this long after the last trigger (no 1/0.5 throttle chatter, readable lamp). */
const ESC_HOLD = 0.25;

/** Persistent state (snapshot-friendly): ABS pressure factors (4), stability hold timer. */
const P = 0;
const HOLD = 4;
export const AIDS_STATE_LENGTH = 5;

export function createAids(vehicle: CarDefinition, frontTrack: number, rearTrack: number): Aids & { readonly state: Float64Array } {
  const st = new Float64Array(AIDS_STATE_LENGTH);
  const iz = vehicle.inertia.yaw;
  // T = gain * Iz * excess yaw-rate error * R / (t/2): the brake torque whose tyre force gives that yaw moment.
  const kFront = (ESC_GAIN * iz * vehicle.front.tyre.radius) / (frontTrack / 2);
  const kRear = (ESC_GAIN * iz * vehicle.rear.tyre.radius) / (rearTrack / 2);
  const reset = (): void => {
    st.fill(1, P, P + 4);
    st[HOLD] = 0;
  };
  reset();
  return {
    state: st,
    reset,
    step(dt, io, aids, view) {
      const bt = io.brakeTorque;
      // Stability first, so ABS also keeps the stability brake from locking its wheel.
      st[HOLD] = Math.max(0, st[HOLD]! - dt);
      const u = io.u;
      const au = Math.abs(u);
      if (aids.stability && au > ESC_SPEED) {
        const cap = view.lateralLimit / Math.max(au, 1);
        let rt = (u * io.steerAct) / (view.wheelbase + K_REF * u * u);
        rt = rt > cap ? cap : rt < -cap ? -cap : rt;
        const e = io.r - rt;
        const ae = Math.abs(e);
        if (ae > ESC_DEADBAND || (Math.abs(io.beta) > ESC_BETA && io.beta * io.r < 0)) st[HOLD] = ESC_HOLD;
        if (ae > ESC_DEADBAND) {
          // e > 0 needs a clockwise (negative) moment: brake a right wheel; e < 0: a left wheel.
          // Oversteer (yawing beyond the target along r) -> front wheel; understeer -> rear wheel.
          const over = io.r * e > 0;
          const t = Math.min(ESC_MAX_TORQUE, (over ? kFront : kRear) * (ae - ESC_DEADBAND));
          bt[(over ? 0 : 2) + (e > 0 ? 1 : 0)] += t;
        }
      } else st[HOLD] = 0;
      io.stabilityActive = st[HOLD]! > 0;
      io.throttleScale = io.stabilityActive ? ESC_THROTTLE : 1;

      let abs = false;
      for (let i = 0; i < 4; i++) {
        let p = st[P + i]!;
        if (!aids.abs || (i >= 2 && io.handbrake > 0.05)) p = 1;
        else {
          p += io.slipRatio[i]! < ABS_SLIP && bt[i]! > ABS_MIN_TORQUE ? -dt / ABS_RELEASE : dt / ABS_APPLY;
          p = p < ABS_FLOOR ? ABS_FLOOR : p > 1 ? 1 : p;
        }
        st[P + i] = p;
        bt[i] = bt[i]! * p;
        if (p < 0.98) abs = true;
      }
      io.absActive = abs;
    },
  };
}

// ---- Traction (§7.7; the scale is low-passed and applied by powertrain.ts)
/** Slip speed (m/s) where the torque cut starts, and the range over which it reaches the floor, both + per m/s of |u|. */
const TCS_ON = 0.5;
const TCS_RANGE = 1.0;
const TCS_PER_SPEED = 0.05;
const TCS_FLOOR = 0.15;

/**
 * Target engine-torque scale for the driven wheels' max slip speed R*omega - vx (m/s) at road speed u.
 * Threshold and range grow with speed (0.5 + 0.05|u|, 1.0 + 0.05|u| m/s, i.e. a slip ratio of about 0.05-0.1 at
 * speed, below the 09-01 tyre's peak near 0.14) instead of §7.7's fixed 1.5 / 2.5 m/s, which lets the rear tyres
 * run far past their peak (and lose their side force) below about 15 m/s.
 */
export function tractionTarget(slipSpeed: number, u: number): number {
  const au = Math.abs(u);
  const s = 1 - (slipSpeed - (TCS_ON + TCS_PER_SPEED * au)) / (TCS_RANGE + TCS_PER_SPEED * au);
  return s < TCS_FLOOR ? TCS_FLOOR : s > 1 ? 1 : s;
}

// ---- Steering helpers (aids.steering; §7.9, called by HumanDriver)
const ALPHA_PEAK = 0.12; // rad, front peak slip angle (model)
const COUNTERSTEER_GAIN = 0.6;

type SteerView = Pick<PlantView, 'u' | 'r' | 'beta' | 'wheelbase' | 'maxSteer' | 'lateralLimit'>;

/** Road-wheel cap near the grip limit: min(maxSteer, atan(L * A_lim / max(V^2, 1)) + ALPHA_PEAK). */
export function steeringLimit(view: SteerView): number {
  const v2 = view.u * view.u;
  return Math.min(view.maxSteer, datan((view.wheelbase * view.lateralLimit) / Math.max(v2, 1)) + ALPHA_PEAK);
}

/** Countersteer help: steers toward the direction of travel, weighted by (1 - |s|), fading in from 5 to 8 m/s forward. */
export function countersteerHelp(s: number, view: SteerView): number {
  return (1 - Math.abs(s)) * COUNTERSTEER_GAIN * view.beta * smoothstep(5, 8, view.u);
}

/**
 * Road-wheel steer command for a steer demand s in -1..1 (§7.9). Aids off: s * maxSteer. On: capped at
 * steeringLimit, except while countersteering (steer opposite to r with |beta| > 0.05: full lock allowed), plus the
 * countersteer help; clamped to +-maxSteer.
 */
export function assistedSteer(s: number, view: SteerView, steering: boolean): number {
  if (!steering) return s * view.maxSteer;
  const countersteer = s * view.r < 0 && Math.abs(view.beta) > 0.05;
  const d = (countersteer ? s * view.maxSteer : s * steeringLimit(view)) + countersteerHelp(s, view);
  return d > view.maxSteer ? view.maxSteer : d < -view.maxSteer ? -view.maxSteer : d;
}
