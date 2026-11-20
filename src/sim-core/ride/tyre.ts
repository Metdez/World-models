/**
 * Grip-use indicator: how much of a tyre's modelled peak friction a demanded force uses (0 = none, 1 = at the
 * modelled limit). It is a MODEL figure from representative parameters (research 05 §7, simplified Magic Formula
 * peak D = mu(Fz)*Fz), not a measurement; label it "model" wherever it is shown.
 *   mu(Fz) = mu + loadSensitivity*(Fz - nominalLoad), floored at 10 % of mu;
 *   peak mu loses 2 % per degree of |camber to road| beyond 3 degrees.
 * shortcut: no slip-angle output (Magic Formula shape / camber thrust alpha_eff = alpha + 0.2*gamma) — the
 * indicator only needs the peak; add the MF curve when something displays slip angles.
 */
import type { KinematicsCurves } from '../../contracts/suspension';
import { RAD_TO_DEG } from '../../contracts/units';
import type { TyreParams } from '../../contracts/vehicle';
import { interp1 } from '../math/interp';

const CAMBER_FREE_DEG = 3;
const MU_LOSS_PER_DEG = 0.02;
const MU_FLOOR = 0.1;

/** Modelled peak friction coefficient at `load` (N) and camber to road (rad). */
export function peakMu(load: number, camberToRoad: number, tyre: TyreParams): number {
  const mu = Math.max(tyre.mu + tyre.loadSensitivity * (load - tyre.nominalLoad), MU_FLOOR * tyre.mu);
  const excessDeg = Math.max(0, Math.abs(camberToRoad) * RAD_TO_DEG - CAMBER_FREE_DEG);
  return mu * Math.max(0, 1 - MU_LOSS_PER_DEG * excessDeg);
}

/**
 * Grip use (model) of one tyre carrying lateral `fy` and longitudinal `fx` (N) at normal `load` (N): friction
 * circle |F| / (peakMu * load). 0 when no force is demanded; Infinity when force is demanded from an unloaded tyre.
 */
export function gripUse(load: number, fy: number, fx: number, camberToRoad: number, tyre: TyreParams): number {
  const demand = Math.sqrt(fx * fx + fy * fy);
  if (demand === 0) return 0;
  const capacity = load > 0 ? peakMu(load, camberToRoad, tyre) * load : 0;
  return capacity > 0 ? demand / capacity : Infinity;
}

/**
 * Wheel camber to road (rad, - = top leaning inboard) from the per-type camber curve at `travel` and body `roll`
 * (+ = left side up). Positive roll tilts both wheel tops towards -y: inboard for the left wheel, outboard for the right.
 */
export function camberToRoad(curves: KinematicsCurves, travel: number, roll: number, left: boolean): number {
  const camber = interp1(curves.travel, curves.camber, travel);
  return left ? camber - roll : camber + roll;
}
