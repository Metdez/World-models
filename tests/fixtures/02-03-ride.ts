/**
 * Synthetic ride-model fixtures for 02-03 tests: GT-coupe-like representative parameters (ARCHITECTURE §7.5,
 * research 05 §8 — estimates, not vehicle data) and small kinematic curves standing in for the 02-02 tables.
 */
import type { KinematicsCurves } from '../../src/contracts/suspension';
import { G, SIM_DT } from '../../src/contracts/units';
import type { TyreParams } from '../../src/contracts/vehicle';
import {
  arbRateFromRollStiffness,
  dampingForRatio,
  wheelRateForRideFrequency,
  type RideCornerParams,
  type RideInput,
  type RideModel,
  type RideParams,
  type RideState,
} from '../../src/sim-core/ride/ride7dof';

export interface AxleSpec {
  track: number;
  unsprungMass: number;
  rideFrequency: number;
  damping: { bump: number; rebound: number };
  antiRollStiffness: number;
  tyreRate: number;
  tyreDamping: number;
  friction: number;
  wheelCentreHeight: number;
  stops: number;
}

export interface CarSpec {
  sprungMass: number;
  cgHeight: number;
  inertiaRoll: number;
  inertiaPitch: number;
  wheelbase: number;
  cgToFront: number;
  front: AxleSpec;
  rear: AxleSpec;
}

const axle = (o: Partial<AxleSpec> & Pick<AxleSpec, 'track' | 'unsprungMass' | 'rideFrequency' | 'tyreRate'>): AxleSpec => ({
  damping: { bump: 0.32, rebound: 0.58 },
  antiRollStiffness: 0,
  tyreDamping: 400,
  friction: 15,
  wheelCentreHeight: 0.35,
  stops: 0.07,
  ...o,
});

/** GT-coupe-like car (ARB tuned in this fixture to roughly 1.1 deg/g with mid roll centres). */
export const GT: CarSpec = {
  sprungMass: 1540,
  cgHeight: 0.5,
  inertiaRoll: 550,
  inertiaPitch: 2500,
  wheelbase: 2.9,
  cgToFront: 0.49 * 2.9,
  front: axle({ track: 1.66, unsprungMass: 40, rideFrequency: 1.45, tyreRate: 260e3, antiRollStiffness: 140e3 }),
  rear: axle({ track: 1.65, unsprungMass: 43, rideFrequency: 1.6, tyreRate: 280e3, antiRollStiffness: 80e3 }),
};

/** Sprung corner mass of axle j (lever rule; sprung CG at x = 0). */
export const cornerSprungMass = (car: CarSpec, front: boolean): number =>
  (car.sprungMass * (front ? car.wheelbase - car.cgToFront : car.cgToFront)) / car.wheelbase / 2;

export function rideParams(car: CarSpec): RideParams {
  const corner = (a: AxleSpec, front: boolean, left: boolean): RideCornerParams => {
    const m = cornerSprungMass(car, front);
    const k = wheelRateForRideFrequency(a.rideFrequency, m, a.tyreRate);
    return {
      x: front ? car.cgToFront : car.cgToFront - car.wheelbase,
      y: (left ? 1 : -1) * (a.track / 2),
      unsprungMass: a.unsprungMass,
      wheelRate: k,
      damping: { bump: dampingForRatio(a.damping.bump, k, m), rebound: dampingForRatio(a.damping.rebound, k, m) },
      friction: a.friction,
      tyreRate: a.tyreRate,
      tyreDamping: a.tyreDamping,
      bump: a.stops,
      droop: a.stops,
      wheelCentreHeight: a.wheelCentreHeight,
    };
  };
  return {
    sprungMass: car.sprungMass,
    cgHeight: car.cgHeight,
    inertiaRoll: car.inertiaRoll,
    inertiaPitch: car.inertiaPitch,
    corners: [corner(car.front, true, true), corner(car.front, true, false), corner(car.rear, false, true), corner(car.rear, false, false)],
    arbRate: {
      front: arbRateFromRollStiffness(car.front.antiRollStiffness, car.front.track),
      rear: arbRateFromRollStiffness(car.rear.antiRollStiffness, car.rear.track),
    },
  };
}

export function rideInput(o: Partial<Pick<RideInput, 'ax' | 'ay' | 'rcHeight' | 'antiPitch'>> = {}): RideInput {
  return {
    ax: 0,
    ay: 0,
    road: new Float64Array(4),
    roadRate: new Float64Array(4),
    rcHeight: { front: 0.08, rear: 0.1 },
    antiPitch: { front: 0, rear: 0 },
    ...o,
  };
}

export const TYRE: TyreParams = {
  radius: 0.35,
  width: 0.255,
  verticalStiffness: 260e3,
  verticalDamping: 400,
  mu: 1.1,
  loadSensitivity: -5e-5,
  nominalLoad: 4200,
};

/** Synthetic per-type curves: linear camber gain, roll centre falling 1.5 mm per mm of bump. */
export function syntheticCurves(camberGainRadPerM: number, rc0: number): KinematicsCurves {
  const n = 57;
  const travel = new Float64Array(n);
  const camber = new Float64Array(n);
  const rc = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    travel[i] = -0.07 + (0.14 * i) / (n - 1);
    camber[i] = -0.026 + camberGainRadPerM * travel[i]!;
    rc[i] = rc0 - 1.5 * travel[i]!;
  }
  const zeros = new Float64Array(n);
  return { travel, camber, toe: zeros, rollCentreHeight: rc, motionRatio: zeros.map(() => 0.9), lateral: zeros, longitudinal: zeros };
}

export const totalMass = (car: CarSpec): number => car.sprungMass + 2 * car.front.unsprungMass + 2 * car.rear.unsprungMass;
export const weight = (car: CarSpec): number => totalMass(car) * G;

/** Steps `model` for `seconds` at SIM_DT, calling `each` after every step. */
export function run(model: RideModel, input: RideInput, seconds: number, each?: (t: number) => void): void {
  const n = Math.round(seconds / SIM_DT);
  for (let k = 1; k <= n; k++) {
    model.step(SIM_DT, input);
    each?.(k * SIM_DT);
  }
}

/** Hub height (m, deviation from static) of corner i, reconstructed from the reported state. */
export function hubHeight(p: RideParams, s: RideState, i: number): number {
  const c = p.corners[i]!;
  return s.travel[i]! + s.heave + c.y * s.roll - c.x * s.pitch;
}

export function hubRate(p: RideParams, s: RideState, i: number): number {
  const c = p.corners[i]!;
  return s.travelRate[i]! + s.heaveRate + c.y * s.rollRate - c.x * s.pitchRate;
}

/**
 * Mechanical energy relative to static equilibrium on a flat road (valid while every tyre is in contact and no
 * stop is engaged): kinetic + springs + ARB + tyres - roll tilt (negative stiffness).
 */
export function energy(p: RideParams, s: RideState, input: RideInput): number {
  let e = 0.5 * (p.sprungMass * s.heaveRate ** 2 + p.inertiaRoll * s.rollRate ** 2 + p.inertiaPitch * s.pitchRate ** 2);
  for (let i = 0; i < 4; i++) {
    const c = p.corners[i]!;
    e += 0.5 * c.unsprungMass * hubRate(p, s, i) ** 2;
    e += 0.5 * c.wheelRate * s.travel[i]! ** 2;
    e += 0.5 * c.tyreRate * hubHeight(p, s, i) ** 2;
  }
  e += 0.5 * p.arbRate.front * (s.travel[0]! - s.travel[1]!) ** 2;
  e += 0.5 * p.arbRate.rear * (s.travel[2]! - s.travel[3]!) ** 2;
  const xF = p.corners[0].x;
  const xR = p.corners[2].x;
  const hra = (-xR * input.rcHeight.front + xF * input.rcHeight.rear) / (xF - xR);
  e -= 0.5 * p.sprungMass * G * (p.cgHeight - hra) * s.roll ** 2;
  return e;
}
