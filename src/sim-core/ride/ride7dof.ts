/**
 * 7-DOF ride model: sprung body heave / roll / pitch + four unsprung hubs (vertical), vehicle frame, SI.
 * Corner order fl, fr, rl, rr. Signs (ARCHITECTURE §4): roll + = left side up, pitch + = nose down,
 * travel + = bump, spring/damper force + = compression, ay + = left turn, ax + = accelerating.
 *
 * Generalised coordinates q = (zs, phi, theta, zu0..zu3) are deviations from static equilibrium on a flat road.
 * Corner body height zb = zs + y*phi - x*theta; travel = zu - zb. Spring preload = static sprung corner load,
 * so travel 0 is the static design ride height.
 *
 * Load transfer (derivation in .planning/phases/02-simulation-core/02-03-PLAN.md):
 * - lateral link forces act on the body at ground level (roll torque ms*ay*h) plus a vertical link pair per axle
 *   +-ms_j*ay*hRc_j/t_j (left hub pushed up, right hub down, reaction on the body). This system is identical to
 *   the axle lateral force acting at the roll centre: geometric transfer ms_j*ay*hRc_j/t_j goes straight to the
 *   tyres, the rest (ms*ay*(h - hRollAxis)) rolls the body and transfers elastically through springs + ARB;
 * - roll tilt: the CG moves sideways about the roll axis, + ms*g*(h - hRollAxis)*phi;
 * - longitudinal: body torque -ms*ax*h; anti-dive/-lift link pairs (fraction antiPitch of each axle's share);
 * - unsprung inertia (m_u at wheel-centre height) transfers straight to the tyres.
 * Integration: semi-implicit Euler, damping (dampers, tyre, linearised Coulomb friction) and stop stiffness implicit:
 * (M + dt*C) v' = M v + dt*Q(q), q' = q + dt*v'. All parameter values are estimates supplied as data.
 */
import { G } from '../../contracts/units';
import type { KinematicsCurves } from '../../contracts/suspension';
import { dtanh } from '../math/det';
import { interp1 } from '../math/interp';
import { solveInPlace } from '../math/linsolve';

export interface RideCornerParams {
  /** Contact-point position in the vehicle frame (x forward, y left), m. */
  readonly x: number;
  readonly y: number;
  readonly unsprungMass: number;
  /** N/m at the wheel. */
  readonly wheelRate: number;
  /** N*s/m at the wheel; bump acts while compressing, rebound while extending. */
  readonly damping: { readonly bump: number; readonly rebound: number };
  /** N Coulomb at the wheel (tanh-regularised, v0 = 0.02 m/s). */
  readonly friction: number;
  readonly tyreRate: number;
  readonly tyreDamping: number;
  /** Stop positions, m (bump stop at travel > bump, droop stop at travel < -droop); stop rate 10 x wheelRate, progressive. */
  readonly bump: number;
  readonly droop: number;
  /** Wheel-centre height (≈ tyre radius), m, for unsprung load transfer. Omitted = 0 (no unsprung transfer). */
  readonly wheelCentreHeight?: number;
}

export interface RideParams {
  readonly sprungMass: number;
  /** Static sprung CG height above ground, m (the sprung CG sits at x = y = 0). */
  readonly cgHeight: number;
  readonly inertiaRoll: number;
  readonly inertiaPitch: number;
  readonly corners: readonly [RideCornerParams, RideCornerParams, RideCornerParams, RideCornerParams];
  /** N/m equivalent at the wheel per unit left-right travel difference (see arbRateFromRollStiffness). */
  readonly arbRate: { readonly front: number; readonly rear: number };
}

export interface RideInput {
  /** Low-passed path accelerations, m/s^2. */
  ax: number;
  ay: number;
  /** Per corner road height (m) and rate (m/s) relative to the local road plane. */
  readonly road: Float64Array;
  readonly roadRate: Float64Array;
  /** Roll-centre heights above ground, m (from kinematics at current travel). */
  rcHeight: { front: number; rear: number };
  /** Fraction of each axle's longitudinal load transfer carried by the links (anti-dive front / anti-lift-squat rear). */
  antiPitch: { front: number; rear: number };
  /**
   * Optional (Manual Drive plant, ARCHITECTURE-M2 §7.3/§7.6): per corner vertical link force from the tyre's lateral
   * force along its front-view IC line (N, + up on the hub, - on the body). When present it replaces the lateral
   * roll-centre pair side*ay*ms_axle*hRc/t; absent (Auto) the M1 arithmetic is unchanged.
   */
  linkVertical?: Float64Array;
}

export interface RideState {
  heave: number;
  roll: number;
  pitch: number;
  heaveRate: number;
  rollRate: number;
  pitchRate: number;
  /** Per corner: wheel travel (m, + bump) and its rate. */
  readonly travel: Float64Array;
  readonly travelRate: Float64Array;
  /** Tyre normal load, N (>= 0; 0 = wheel off the ground). */
  readonly load: Float64Array;
  /** Spring force at the wheel incl. preload (N, + compression). */
  readonly springForce: Float64Array;
  /** Viscous damper force at the wheel (N, + compression; friction excluded). */
  readonly damperForce: Float64Array;
  /** Stop engagement: penetration / 10 mm (+ bump stop, - droop stop, 0 = free). */
  readonly stop: Float64Array;
}

export interface RideModel {
  readonly state: RideState;
  /** Static equilibrium under `input` (Newton solve of the force balance, all rates zero). */
  reset(input: RideInput): void;
  step(dt: number, input: RideInput): void;
  /** Copies q (7) then v (7) into out[offset..offset + 14) (ARCHITECTURE-M2 §7.3: plant snapshots, suspension swaps). */
  exportState(out: Float64Array, offset?: number): void;
  /** Restores q and v from src[offset..offset + 14) and recomputes the reported outputs for `input`. */
  importState(src: Float64Array, input: RideInput, offset?: number): void;
}

/** Doubles written by RideModel.exportState. */
export const RIDE_STATE_LENGTH = 14;

const N = 7;
const FRICTION_V0 = 0.02;
const STOP_RATE = 10;
/** Stop progression length: rate grows by 1 x STOP_RATE * wheelRate per 10 mm of penetration, capped. */
const STOP_PROGRESSION = 0.01;
const STOP_CAP = 4;

/** Wheel rate (N/m) giving `frequency` (Hz) for `cornerMass` on the wheel rate in series with the tyre. */
export function wheelRateForRideFrequency(frequency: number, cornerMass: number, tyreRate: number): number {
  const ride = cornerMass * (2 * Math.PI * frequency) ** 2;
  if (!(ride < tyreRate)) throw new Error('ride frequency not reachable with this tyre rate');
  return (ride * tyreRate) / (tyreRate - ride);
}

/** Damping coefficient (N*s/m) for damping ratio `ratio` of `cornerMass` on `wheelRate`. */
export const dampingForRatio = (ratio: number, wheelRate: number, cornerMass: number): number =>
  2 * ratio * Math.sqrt(wheelRate * cornerMass);

/** ARB roll stiffness (N*m/rad) to the equivalent wheel rate per side difference: K / track^2. */
export const arbRateFromRollStiffness = (rollStiffness: number, track: number): number => rollStiffness / (track * track);

/**
 * Roll-centre height from per-type curves at the mean axle travel.
 * shortcut: symmetric-travel curve only; use KinematicsTable.rollCentreHeight(tL, tR) where available.
 */
export const rollCentreFromCurves = (curves: KinematicsCurves, travelLeft: number, travelRight: number): number =>
  interp1(curves.travel, curves.rollCentreHeight, (travelLeft + travelRight) / 2);

export function createRideModel(params: RideParams): RideModel {
  const c = params.corners;
  const ms = params.sprungMass;
  const h = params.cgHeight;
  for (const k of c) {
    if (!(k.unsprungMass > 0 && k.wheelRate > 0 && k.tyreRate > 0 && k.bump > 0 && k.droop > 0)) {
      throw new Error('ride: corner masses, rates and stop positions must be > 0');
    }
  }
  if (!(ms > 0 && params.inertiaRoll > 0 && params.inertiaPitch > 0)) throw new Error('ride: body mass/inertia must be > 0');

  const xs = new Float64Array(4);
  const ys = new Float64Array(4);
  for (let i = 0; i < 4; i++) {
    xs[i] = c[i]!.x;
    ys[i] = c[i]!.y;
  }
  const xF = (xs[0]! + xs[1]!) / 2;
  const xR = (xs[2]! + xs[3]!) / 2;
  const wheelbase = xF - xR;
  const track = [ys[0]! - ys[1]!, ys[2]! - ys[3]!] as const;
  if (!(wheelbase > 0 && xF > 0 && xR < 0 && track[0] > 0 && track[1] > 0)) {
    throw new Error('ride: corners must be fl, fr, rl, rr around the sprung CG');
  }
  const msAxle = [(ms * -xR) / wheelbase, (ms * xF) / wheelbase] as const;
  const arb = [params.arbRate.front, params.arbRate.rear] as const;

  const preload = new Float64Array(4);
  const tyreDeflection0 = new Float64Array(4);
  const mass = new Float64Array(N);
  mass[0] = ms;
  mass[1] = params.inertiaRoll;
  mass[2] = params.inertiaPitch;
  const unsprungLat = [0, 0];
  let unsprungLong = 0;
  for (let i = 0; i < 4; i++) {
    const j = i >> 1;
    const otherY = ys[i ^ 1]!;
    // Lever rule across the axle: zero roll moment per axle at rest.
    preload[i] = (msAxle[j]! * G * Math.abs(otherY)) / track[j]!;
    const mu = c[i]!.unsprungMass;
    tyreDeflection0[i] = (preload[i]! + mu * G) / c[i]!.tyreRate;
    mass[3 + i] = mu;
    const hu = c[i]!.wheelCentreHeight ?? 0;
    unsprungLat[j]! += mu * hu;
    unsprungLong += mu * hu;
  }

  const q = new Float64Array(N);
  const v = new Float64Array(N);
  const Q = new Float64Array(N);
  const A = new Float64Array(N * N);
  const b = new Float64Array(N);
  const Q0 = new Float64Array(N);
  const qSave = new Float64Array(N);
  const linkForce = new Float64Array(4);
  const unsprungForce = new Float64Array(4);
  const contact = new Uint8Array(4);

  const state: RideState = {
    heave: 0,
    roll: 0,
    pitch: 0,
    heaveRate: 0,
    rollRate: 0,
    pitchRate: 0,
    travel: new Float64Array(4),
    travelRate: new Float64Array(4),
    load: new Float64Array(4),
    springForce: new Float64Array(4),
    damperForce: new Float64Array(4),
    stop: new Float64Array(4),
  };
  const { travel, travelRate } = state;

  /**
   * Per hub (N, + up): link forces (reaction on the body) and unsprung-inertia pairs (reacted by the ground only).
   */
  function linkForces(input: RideInput): void {
    const { ax, ay } = input;
    const anti = input.antiPitch;
    const longLink = (ms * ax * h) / (2 * wheelbase);
    const longUnsprung = (ax * unsprungLong) / (2 * wheelbase);
    const lv = input.linkVertical;
    for (let i = 0; i < 4; i++) {
      const j = i >> 1;
      const side = i & 1 ? -1 : 1; // left +, right -
      const rc = j === 0 ? input.rcHeight.front : input.rcHeight.rear;
      const lateral = lv ? lv[i]! : (side * ay * msAxle[j]! * rc) / track[j]!;
      linkForce[i] = lateral + (j === 0 ? longLink * anti.front : -longLink * anti.rear);
      unsprungForce[i] = (side * ay * unsprungLat[j]!) / track[j]! + (j === 0 ? longUnsprung : -longUnsprung);
    }
  }

  /**
   * Generalised forces Q(q) without the implicit damping terms; with `assemble`, also builds A = M + dt*C and the
   * explicit force part of b. Writes travel/travelRate from q, v.
   */
  function forces(input: RideInput, dt: number, assemble: boolean): void {
    const zs = q[0]!;
    const phi = q[1]!;
    const theta = q[2]!;
    for (let i = 0; i < 4; i++) {
      travel[i] = q[3 + i]! - (zs + ys[i]! * phi - xs[i]! * theta);
      travelRate[i] = v[3 + i]! - (v[0]! + ys[i]! * v[1]! - xs[i]! * v[2]!);
    }
    const hRollAxis = (msAxle[0] * input.rcHeight.front + msAxle[1] * input.rcHeight.rear) / ms;
    Q[0] = -ms * G;
    Q[1] = ms * input.ay * h + ms * G * (h - hRollAxis) * phi;
    Q[2] = -ms * input.ax * h;
    if (assemble) {
      A.fill(0);
      for (let k = 0; k < N; k++) A[k * N + k] = mass[k]!;
    }
    for (let i = 0; i < 4; i++) {
      const k = c[i]!;
      const t = travel[i]!;
      const rate = travelRate[i]!;
      const j = i >> 1;
      let suspension = preload[i]! + k.wheelRate * t + arb[j]! * (t - travel[i ^ 1]!);
      // Implicit "damping" coefficient along this corner's travel direction J = (-1, -y, x, e_hub).
      let cImplicit = 0;
      const pen = t > k.bump ? t - k.bump : t < -k.droop ? t + k.droop : 0;
      if (pen !== 0) {
        const a = Math.abs(pen) / STOP_PROGRESSION;
        const rate0 = STOP_RATE * k.wheelRate;
        suspension += rate0 * pen * Math.min(1 + a, STOP_CAP);
        cImplicit += dt * rate0 * (a < STOP_CAP - 1 ? 1 + 2 * a : STOP_CAP);
      }
      if (k.friction > 0) {
        const th = dtanh(rate / FRICTION_V0);
        const slope = (k.friction * (1 - th * th)) / FRICTION_V0;
        // Linearised about the current rate: f(r') ≈ f(r) + slope*(r' - r).
        suspension += k.friction * th - slope * rate;
        cImplicit += slope;
      }
      cImplicit += rate > 0 ? k.damping.bump : k.damping.rebound;
      const onBody = suspension - linkForce[i]!;
      Q[0] += onBody;
      Q[1] += ys[i]! * onBody;
      Q[2] -= xs[i]! * onBody;
      let hub = -suspension + linkForce[i]! + unsprungForce[i]! - k.unsprungMass * G;
      const spring = k.tyreRate * (tyreDeflection0[i]! + input.road[i]! - q[3 + i]!);
      const roadRate = input.roadRate[i]!;
      contact[i] = spring > 0 && spring + k.tyreDamping * (roadRate - v[3 + i]!) > 0 ? 1 : 0;
      if (contact[i]) hub += spring + k.tyreDamping * roadRate;
      Q[3 + i] = hub;
      if (assemble) {
        // A += dt*c*J^T J, J = (-1, -y, x, hub +1)
        const w = dt * cImplicit;
        const J0 = -1;
        const J1 = -ys[i]!;
        const J2 = xs[i]!;
        const hi = 3 + i;
        A[0]! += w * J0 * J0;
        A[1]! += w * J0 * J1;
        A[2]! += w * J0 * J2;
        A[hi]! += w * J0;
        A[N]! += w * J1 * J0;
        A[N + 1]! += w * J1 * J1;
        A[N + 2]! += w * J1 * J2;
        A[N + hi]! += w * J1;
        A[2 * N]! += w * J2 * J0;
        A[2 * N + 1]! += w * J2 * J1;
        A[2 * N + 2]! += w * J2 * J2;
        A[2 * N + hi]! += w * J2;
        A[hi * N]! += w * J0;
        A[hi * N + 1]! += w * J1;
        A[hi * N + 2]! += w * J2;
        A[hi * N + hi]! += w + (contact[i] ? dt * k.tyreDamping : 0);
      }
    }
  }

  /** Recomputes the reported per-corner outputs from q, v (after a step or reset). */
  function outputs(input: RideInput): void {
    const zs = q[0]!;
    const phi = q[1]!;
    const theta = q[2]!;
    state.heave = zs;
    state.roll = phi;
    state.pitch = theta;
    state.heaveRate = v[0]!;
    state.rollRate = v[1]!;
    state.pitchRate = v[2]!;
    for (let i = 0; i < 4; i++) {
      const k = c[i]!;
      const t = q[3 + i]! - (zs + ys[i]! * phi - xs[i]! * theta);
      const rate = v[3 + i]! - (v[0]! + ys[i]! * v[1]! - xs[i]! * v[2]!);
      travel[i] = t;
      travelRate[i] = rate;
      state.springForce[i] = preload[i]! + k.wheelRate * t;
      state.damperForce[i] = (rate > 0 ? k.damping.bump : k.damping.rebound) * rate;
      state.stop[i] = (t > k.bump ? t - k.bump : t < -k.droop ? t + k.droop : 0) / STOP_PROGRESSION;
      const spring = k.tyreRate * (tyreDeflection0[i]! + input.road[i]! - q[3 + i]!);
      const total = spring + k.tyreDamping * (input.roadRate[i]! - v[3 + i]!);
      state.load[i] = spring > 0 && total > 0 ? total : 0;
    }
  }

  function step(dt: number, input: RideInput): void {
    linkForces(input);
    forces(input, dt, true);
    for (let k = 0; k < N; k++) b[k] = mass[k]! * v[k]! + dt * Q[k]!;
    if (!solveInPlace(A, b, N)) throw new Error('ride: singular step matrix');
    for (let k = 0; k < N; k++) {
      v[k] = b[k]!;
      q[k]! += dt * b[k]!;
    }
    outputs(input);
  }

  const residual = (): number => {
    let norm = 0;
    for (let k = 0; k < N; k++) norm = Math.max(norm, Math.abs(Q[k]!));
    return norm;
  };

  /**
   * Static equilibrium: Newton on Q(q) = 0 with a forward-difference stiffness and a backtracking line search.
   * The force balance is piecewise linear (tyre lift-off, stops), so a full Newton step from a guess with a wheel
   * off the ground can overshoot without bound; the start guess puts every hub on its road input (all tyres at
   * static deflection) and the body on the plane through them. Throws if it does not converge (never returns a
   * diverged state).
   */
  function reset(input: RideInput): void {
    v.fill(0);
    const road = input.road;
    for (let i = 0; i < 4; i++) q[3 + i] = road[i]!;
    const rF = (road[0]! + road[1]!) / 2;
    const rR = (road[2]! + road[3]!) / 2;
    q[2] = -(rF - rR) / wheelbase;
    q[1] = ((road[0]! - road[1]!) / track[0] + (road[2]! - road[3]!) / track[1]) / 2;
    q[0] = rR + q[2] * xR;
    linkForces(input);
    const eps = 1e-7;
    const tol = 1e-9 * ms * G;
    forces(input, 0, false);
    let norm = residual();
    for (let iter = 0; iter < 60 && !(norm < tol); iter++) {
      Q0.set(Q);
      qSave.set(q);
      for (let col = 0; col < N; col++) {
        q[col]! += eps;
        forces(input, 0, false);
        for (let row = 0; row < N; row++) A[row * N + col] = -(Q[row]! - Q0[row]!) / eps;
        q[col] = qSave[col]!;
      }
      b.set(Q0);
      if (!solveInPlace(A, b, N)) throw new Error('ride: singular static stiffness');
      let lambda = 1;
      for (;;) {
        for (let k = 0; k < N; k++) q[k] = qSave[k]! + lambda * b[k]!;
        forces(input, 0, false);
        const next = residual();
        if (next < norm || lambda < 1e-4) {
          norm = next;
          break;
        }
        lambda *= 0.5;
      }
    }
    if (!(norm < tol)) throw new Error('ride: static equilibrium did not converge');
    outputs(input);
  }

  function exportState(out: Float64Array, offset = 0): void {
    for (let k = 0; k < N; k++) {
      out[offset + k] = q[k]!;
      out[offset + N + k] = v[k]!;
    }
  }

  function importState(src: Float64Array, input: RideInput, offset = 0): void {
    for (let k = 0; k < N; k++) {
      q[k] = src[offset + k]!;
      v[k] = src[offset + N + k]!;
    }
    outputs(input);
  }

  return { state, reset, step, exportState, importState };
}
