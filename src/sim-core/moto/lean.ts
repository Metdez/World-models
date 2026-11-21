/**
 * Lean and handlebar steer from the path (ARCHITECTURE §7.7, research 08 §5.1–5.2). Angles + LEFT (lean to the left,
 * steer to the left); the model reports roll = −frame lean (units.ts: roll + lifts the LEFT side).
 *
 * - Target lean of the CG line relative to the road plane: γ* = atan(ay / (g·cos grade)) + bank (bank + = left edge up,
 *   so a turn banked into the corner needs less lean relative to the road).
 * - 2nd-order tracker (ζ 0.9, ω 6 rad/s) for γ; frame lean with the tyre crown: φ = γ + asin((ρ/H)·sin γ), H = h − ρ.
 * - Steer from the inverse roll balance h·γ̈ = g·tan γ_w − (v²/L)·δ' (gyroscopic and trail terms neglected):
 *   δ' = (L/v²)·(ay − h·γ̈), δ = δ'/cos ε, so turn-in (γ̈ toward the turn) first steers the other way: countersteer.
 *   Below LOW_SPEED the steer blends to the kinematic δ = L·κ/cos ε; clamp ±STEER_MAX.
 */
import { DEG_TO_RAD } from '../../contracts/units';
import { smoothstep } from '../math/interp';
import { dasin, datan, dcos, dsin } from '../math/det';

const ZETA = 0.9;
const OMEGA = 6;
export const STEER_MAX = 20 * DEG_TO_RAD;
const LOW_SPEED: readonly [number, number] = [3, 6];

export interface LeanParams {
  readonly wheelbase: number;
  readonly cgHeight: number;
  /** Tyre crown radius, m. */
  readonly crown: number;
  /** Static steering-axis angle from vertical, rad. */
  readonly rake: number;
}

/** Closed-form steady frame lean for a CG-line lean γ (research 08 §5.1). */
export function frameLean(gamma: number, cgHeight: number, crown: number): number {
  return gamma + dasin((crown / (cgHeight - crown)) * dsin(gamma));
}

export interface Lean {
  /** [γ, γ̇, γ̈, frame lean φ, handlebar steer δ]. */
  readonly state: Float64Array;
  reset(ay: number, g: number, bank: number, v: number, curvature: number): void;
  step(dt: number, ay: number, g: number, bank: number, v: number, curvature: number): void;
}

export const GAMMA = 0;
export const GAMMA_RATE = 1;
export const GAMMA_ACC = 2;
export const PHI = 3;
export const STEER = 4;

export function createLean(p: LeanParams): Lean {
  const st = new Float64Array(5);
  const target = (ay: number, g: number, bank: number): number => datan(ay / g) + bank;
  function finish(ay: number, v: number, curvature: number): void {
    st[PHI] = frameLean(st[GAMMA]!, p.cgHeight, p.crown);
    const L = p.wheelbase;
    const dynamic = v > 0.1 ? (L / (v * v)) * (ay - p.cgHeight * st[GAMMA_ACC]!) : 0;
    const blend = smoothstep(LOW_SPEED[0], LOW_SPEED[1], v);
    const d = (blend * dynamic + (1 - blend) * L * curvature) / dcos(p.rake);
    st[STEER] = d > STEER_MAX ? STEER_MAX : d < -STEER_MAX ? -STEER_MAX : d;
  }
  return {
    state: st,
    reset(ay, g, bank, v, curvature) {
      st[GAMMA] = target(ay, g, bank);
      st[GAMMA_RATE] = 0;
      st[GAMMA_ACC] = 0;
      finish(ay, v, curvature);
    },
    step(dt, ay, g, bank, v, curvature) {
      const acc = OMEGA * OMEGA * (target(ay, g, bank) - st[GAMMA]!) - 2 * ZETA * OMEGA * st[GAMMA_RATE]!;
      st[GAMMA_ACC] = acc;
      st[GAMMA_RATE] = st[GAMMA_RATE]! + acc * dt;
      st[GAMMA] = st[GAMMA]! + st[GAMMA_RATE]! * dt;
      finish(ay, v, curvature);
    },
  };
}
