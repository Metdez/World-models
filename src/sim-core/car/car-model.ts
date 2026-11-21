/**
 * Car vehicle model (ARCHITECTURE §7.2.4, §7.6): 02-02 kinematics tables + 02-03 7-DOF ride model on the 02-01 road.
 *
 * Frames: the body is posed on the "reference plane" of the path (heading, swell grade, bank). The ride model works
 * relative to that plane, so every road deviation (roughness, features AND the crest/dip vertical curves) reaches it
 * as a per-wheel road input; reported heave/pitch are then taken relative to the local road plane (vertical curve
 * under the axles). Lateral/longitudinal inputs are the specific forces the tyres must supply in the road plane
 * (bank and grade components of gravity, aero drag at the CG height).
 * Springs, dampers and anti-roll stiffness are wheel-rate TARGETS from the vehicle, identical for every suspension
 * type; spring/damper forces along the strut are the wheel forces divided by the type's motion ratio.
 */
import type { PathState, SimEvent } from '../../contracts/sim';
import type { AxleKinematics, AxleLinkage, CarSuspensionDefinition, SuspensionDefinition, VehicleKinematics } from '../../contracts/suspension';
import { MAX_POINTS, type CornerLayout, type TelemetryFrame } from '../../contracts/telemetry';
import type { BuiltTrack, TrackSample } from '../../contracts/track';
import { G, type AxleId, type XYZ } from '../../contracts/units';
import type { CarAxleSpec, CarDefinition, VehicleDefinition } from '../../contracts/vehicle';
import { createCornerSolution, solveAxleKinematics, type CornerSolution, type KinematicsTable } from '../kinematics/table';
import { clamp, interp1, wrap, wrapAngle } from '../math/interp';
import { datan, dcos, dsin, dtan } from '../math/det';
import * as q from '../math/quat';
import {
  arbRateFromRollStiffness,
  createRideModel,
  dampingForRatio,
  wheelRateForRideFrequency,
  type RideInput,
  type RideCornerParams,
  type RideModel,
  type RideParams,
  RIDE_STATE_LENGTH,
} from '../ride/ride7dof';
import { gripUse, peakMu } from '../ride/tyre';
import type { GroundWorld } from '../../contracts/world';
import { createPlant, SURFACE_KINDS, type CarCore, type PlantOptions, type PlantTyreOut, type VehiclePlant } from '../drive/plant';
import { buildGroundWorld, loopSurface } from '../world/ground';

const LAYOUT: readonly CornerLayout[] = [
  { id: 'fl', axle: 'front', side: 1 },
  { id: 'fr', axle: 'front', side: -1 },
  { id: 'rl', axle: 'rear', side: 1 },
  { id: 'rr', axle: 'rear', side: -1 },
];
/** Tyre envelope: mean road height at these offsets along the road (§7.6 step 4), m. */
const ENVELOPE = 0.1;
const RHO_AIR = 1.225;
/** Event hysteresis per corner and kind: the condition must have been false this long before it fires again, s. */
const HYSTERESIS = 0.5;
const LIFTOFF_LOAD = 50;
const STOP_EVENT = 0.5;
/** Grip use is capped here: a nearly unloaded tyre asked for force is simply off the scale. */
const GRIP_MAX = 2;
const TAU = 2 * Math.PI;

// ---- step record layout (current and previous step; sample() interpolates between them)
const HEAVE = 0;
const ROLL = 1;
const PITCH = 2;
const RC = 3; // + axle
const ANTI = 5; // + axle
const BODY = 7;
const TRAVEL = 0;
const RATE = 1;
const LOAD = 2;
const SPRING = 3;
const DAMPER = 4;
const STOP = 5;
const CAMBER = 6;
const TOE = 7;
const STEER = 8;
const MR = 9;
const GRIP = 10;
const SPIN = 11;
const WCX = 12;
const STRIDE = 13;
/** M2 slots, appended after the M1 record so its slots and their interpolation are untouched (ARCH-M2 §7.3 (4)). */
const TYRE = BODY + 4 * STRIDE;
const FX = 0;
const FY = 1;
const CAP = 2;
const OMEGA = 3;
const SLIP_A = 4;
const SLIP_R = 5;
const TYRE_STRIDE = 6;
const RECORD = TYRE + 4 * TYRE_STRIDE;

interface AxleSolution {
  readonly table: KinematicsTable;
  readonly kinematics: AxleKinematics;
}
interface CarSolution {
  readonly front: AxleSolution;
  readonly rear: AxleSolution;
  readonly kinematics: VehicleKinematics;
}

/** Tables solved once per (vehicle, linkage pair) for the session (they depend on tyre radius, cg height, wheelbase). */
const solved = new WeakMap<CarSuspensionDefinition['axles'], WeakMap<CarDefinition, CarSolution>>();

/** Solves (or returns the cached) kinematics of `suspension` on `vehicle`. Call ahead of time to avoid a swap hitch. */
export function prepareCarSuspension(vehicle: CarDefinition, suspension: CarSuspensionDefinition): CarSolution {
  let byVehicle = solved.get(suspension.axles);
  if (!byVehicle) solved.set(suspension.axles, (byVehicle = new WeakMap()));
  const hit = byVehicle.get(vehicle);
  if (hit) return hit;
  const solve = (axle: AxleId, linkage: AxleLinkage, spec: CarAxleSpec): AxleSolution =>
    solveAxleKinematics(linkage, {
      tyreRadius: spec.tyre.radius,
      ...(spec.steered ? { maxSteer: vehicle.maxSteer } : {}),
      axle,
      cgHeight: vehicle.cgHeight,
      wheelbase: vehicle.wheelbase,
      brakeShare: spec.brakeShare,
    });
  const front = solve('front', suspension.axles.front, vehicle.front);
  const rear = solve('rear', suspension.axles.rear, vehicle.rear);
  // A non-steered axle's "steering axis" is the virtual toe-link axis (02-02): not a meaningful KPI/caster/scrub/trail.
  const notSteered = (k: AxleKinematics, spec: CarAxleSpec): AxleKinematics =>
    spec.steered ? k : { ...k, summary: { ...k.summary, kingpinInclination: NaN, caster: NaN, scrubRadius: NaN, trail: NaN } };
  const sol: CarSolution = {
    front,
    rear,
    kinematics: { front: notSteered(front.kinematics, vehicle.front), rear: notSteered(rear.kinematics, vehicle.rear) },
  };
  byVehicle.set(vehicle, sol);
  return sol;
}

function asCar(def: VehicleDefinition | SuspensionDefinition): void {
  const cls = 'class' in def ? def.class : def.vehicleClass;
  if (cls !== 'car') throw new Error(`"${def.id}" is a ${cls} definition, not a car one`);
}

/** `plantOptions`: test-only plant simplifications (validation T1/T2); never set by the app. */
export function createCarModel(vehicleDef: VehicleDefinition, suspensionDef: SuspensionDefinition, track: BuiltTrack, world?: GroundWorld, plantOptions?: PlantOptions) {
  asCar(vehicleDef);
  const vehicle = vehicleDef as CarDefinition;
  const L = vehicle.wheelbase;
  const a = vehicle.cgToFront;
  const axleX = [a, a, a - L, a - L] as const;
  const side = [1, -1, 1, -1] as const;
  const spec = (i: number): CarAxleSpec => (i < 2 ? vehicle.front : vehicle.rear);
  const swellA = track.def.swell.amplitude;
  const swellK = (TAU * track.def.swell.cycles) / track.length;

  let sol!: CarSolution;
  let tables!: readonly [KinematicsTable, KinematicsTable];
  let ride!: RideModel;
  /** Contact-patch positions in the vehicle frame at design (ride corner x, y). */
  const cx = new Float64Array(4);
  const cy = new Float64Array(4);
  const staticDeflection = new Float64Array(4);
  let staticDeflectionMean = 0;
  const wcx0 = new Float64Array(2);

  const corner = (i: number): CornerSolution => cornerSols[i]!;
  let cornerSols: CornerSolution[] = [];
  let restSol!: CornerSolution;

  const unsprung = new Float64Array(4);
  const wheelRates = new Float64Array(4);
  let linkages!: readonly [AxleLinkage, AxleLinkage];
  const keep = new Float64Array(RIDE_STATE_LENGTH);

  function install(suspension: CarSuspensionDefinition, keepRideState = false): void {
    if (keepRideState) ride.exportState(keep);
    sol = prepareCarSuspension(vehicle, suspension);
    tables = [sol.front.table, sol.rear.table];
    linkages = [suspension.axles.front, suspension.axles.rear];
    for (const t of tables) if (t.pointOrder.length > MAX_POINTS) throw new Error(`suspension "${suspension.id}" has more than ${MAX_POINTS} points`);
    cornerSols = [0, 1, 2, 3].map((i) => createCornerSolution(tables[i >> 1]!));
    restSol = createCornerSolution(tables[0].pointOrder.length >= tables[1].pointOrder.length ? tables[0] : tables[1]);
    for (let i = 0; i < 4; i++) {
      const c = tables[i >> 1]!.sample(0, 0, corner(i));
      cx[i] = axleX[i]! + c.contactPatch.x;
      cy[i] = side[i]! * c.contactPatch.y;
      if (!(i & 1)) wcx0[i >> 1] = c.wheelCentre.x;
    }
    const xF = (cx[0]! + cx[1]!) / 2;
    const xR = (cx[2]! + cx[3]!) / 2;
    const ms = vehicle.sprungMass;
    const params: RideParams = {
      sprungMass: ms,
      cgHeight: vehicle.cgHeight,
      inertiaRoll: vehicle.inertia.roll,
      inertiaPitch: vehicle.inertia.pitch,
      corners: [rideCorner(0), rideCorner(1), rideCorner(2), rideCorner(3)],
      arbRate: {
        front: arbRateFromRollStiffness(vehicle.front.antiRollStiffness, cy[0]! - cy[1]!),
        rear: arbRateFromRollStiffness(vehicle.rear.antiRollStiffness, cy[2]! - cy[3]!),
      },
    };
    // shortcut: one mean static tyre deflection places the body (front/rear differ by ~2 mm, 0.04 deg of pitch).
    staticDeflectionMean = (staticDeflection[0]! + staticDeflection[1]! + staticDeflection[2]! + staticDeflection[3]!) / 4;
    ride = createRideModel(params);
    if (keepRideState) ride.importState(keep, input);

    function rideCorner(i: number): RideCornerParams {
      const s = spec(i);
      const linkage = i < 2 ? suspension.axles.front : suspension.axles.rear;
      // Sprung corner mass by the lever rule (the ride model uses the same split for its preload).
      const m = (ms * (i < 2 ? -xR : xF)) / (xF - xR) / 2;
      const k = wheelRateForRideFrequency(s.rideFrequency, m, s.tyre.verticalStiffness);
      const mu = s.unsprungMass + suspension.extras.unsprungMassDelta;
      unsprung[i] = mu;
      wheelRates[i] = k;
      staticDeflection[i] = (m * G + mu * G) / s.tyre.verticalStiffness;
      return {
        x: cx[i]!,
        y: cy[i]!,
        unsprungMass: mu,
        wheelRate: k,
        damping: { bump: dampingForRatio(s.damping.bump, k, m), rebound: dampingForRatio(s.damping.rebound, k, m) },
        friction: suspension.extras.damperFriction,
        tyreRate: s.tyre.verticalStiffness,
        tyreDamping: s.tyre.verticalDamping,
        bump: linkage.travel.bump,
        droop: linkage.travel.droop,
        wheelCentreHeight: s.tyre.radius,
      };
    }
  }

  // ---- scratch (no allocation in step/sample)
  const cur = new Float64Array(RECORD);
  const prev = new Float64Array(RECORD);
  const smp = new Float64Array(RECORD);
  /** Surface index (SURFACE_KINDS) under each wheel at the current step. */
  const surf = new Uint8Array(4);
  const quiet = new Float64Array(12);
  const roadPrev = new Float64Array(4);
  const input: RideInput = {
    ax: 0,
    ay: 0,
    road: new Float64Array(4),
    roadRate: new Float64Array(4),
    rcHeight: { front: 0, rear: 0 },
    antiPitch: { front: 0, rear: 0 },
  };

  function setSuspension(def: SuspensionDefinition, keepRideState = false): void {
    asCar(def);
    install(def as CarSuspensionDefinition, keepRideState);
  }
  setSuspension(suspensionDef);
  const ts: TrackSample = { s: 0, x: 0, y: 0, z: 0, heading: 0, curvature: 0, bank: 0, grade: 0 };
  /** Mutable per-step scalars in a typed array: a double stored in a closure variable is re-boxed on every write. */
  const scalar = new Float64Array(2); // [rack, dt]
  // Ride-model reference plane relative to the path's reference plane, frozen at reset (a rigid offset leaves the
  // small-angle ride model unchanged): starting the static solve on the local vertical curve keeps every tyre in
  // contact at its initial guess (a dip deeper than the static tyre deflection would leave it singular).
  let refZ = 0;
  let refSlope = 0;
  const vc = { cg: 0, slope: 0 };
  const pose = new Float64Array(3);
  const body = q.create();
  const qa = q.create();
  const qb = q.create();
  const rcLine = new Float64Array(8);
  const rcPoint: XYZ = { x: 0, y: 0, z: 0 };
  const stopEvents = LAYOUT.map((_, corner) => ({ kind: 'bump-stop', corner }) as const);
  const liftEvents = LAYOUT.map((_, corner) => ({ kind: 'liftoff', corner }) as const);
  const gripEvents = LAYOUT.map((_, corner) => ({ kind: 'grip-limit', corner }) as const);

  /** Per-wheel road deviation from the reference plane of the path (3-point envelope along the road). */
  function roadInputs(path: PathState): void {
    track.sample(path.s, ts);
    const dpsi = wrapAngle(path.heading - ts.heading);
    const c = dcos(dpsi);
    const sn = dsin(dpsi);
    const tb = dtan(path.bank);
    for (let i = 0; i < 4; i++) {
      const si = path.s + cx[i]! * c - cy[i]! * sn;
      const li = path.l + cx[i]! * sn + cy[i]! * c;
      const h = (track.roadHeight(si - ENVELOPE, li) + track.roadHeight(si, li) + track.roadHeight(si + ENVELOPE, li)) / 3;
      input.road[i] = h - swellA * dsin(swellK * si) - li * tb - refZ - refSlope * cx[i]!;
      surf[i] = SURFACE_KINDS.indexOf(loopSurface(track, si, li));
    }
  }

  /** Vertical-curve (crest/dip) road plane under the axles at path s: height at the CG and slope dz/dx. */
  function vcPlane(s: number): void {
    const xF = (cx[0]! + cx[1]!) / 2;
    const xR = (cx[2]! + cx[3]!) / 2;
    const vcF = track.sample(s + xF, ts).z - swellA * dsin(swellK * (s + xF));
    const vcR = track.sample(s + xR, ts).z - swellA * dsin(swellK * (s + xR));
    vc.slope = (vcF - vcR) / (xF - xR);
    vc.cg = vcR - vc.slope * xR;
  }

  /** Specific forces the tyres supply in the road plane (m/s^2) and the matching anti-pitch fractions. */
  function bodyInputs(path: PathState): void {
    const drag = (0.5 * RHO_AIR * vehicle.dragArea * path.v * path.v) / vehicle.mass;
    input.ax = path.ax + (G * path.grade) / Math.sqrt(1 + path.grade * path.grade) + drag;
    input.ay = path.ay * dcos(path.bank) + G * dsin(path.bank);
    // Front anti-dive under braking; rear anti-squat when driving. shortcut: no rear anti-lift under braking (the
    // table only reports the rear drive path), so braking pitch is slightly overstated for all types alike.
    input.antiPitch.front = input.ax < 0 ? tables[0].antiPitch : 0;
    input.antiPitch.rear = input.ax >= 0 ? tables[1].antiPitch : 0;
  }

  function rcInputs(): void {
    const t = ride.state.travel;
    input.rcHeight.front = tables[0].rollCentreHeight(t[0]!, t[1]!);
    input.rcHeight.rear = tables[1].rollCentreHeight(t[2]!, t[3]!);
  }

  /**
   * TRUE per-corner values of the current ride state into `cur`; fires events. Auto (`tyre` absent): the M1
   * arithmetic for every M1 slot, plus the demand behind gripUse as fx/fy and the kinematic wheel spin. Plant
   * (`tyre` given): the plant's tyre forces, capacity, slips and spin rate; gripUse = |F| / capacity.
   */
  function derive(path: PathState | null, dt: number, events: SimEvent[] | undefined, tyre?: PlantTyreOut): void {
    const st = ride.state;
    cur[HEAVE] = st.heave;
    cur[ROLL] = st.roll;
    cur[PITCH] = st.pitch;
    cur[RC] = input.rcHeight.front;
    cur[RC + 1] = input.rcHeight.rear;
    cur[ANTI] = input.antiPitch.front;
    cur[ANTI + 1] = input.antiPitch.rear;
    const m = vehicle.mass;
    const fyFront = (m * input.ay * (L - a)) / L;
    const fyRear = (m * input.ay * a) / L;
    const fx = m * input.ax;
    const fr = vehicle.front;
    const rr = vehicle.rear;
    const driven = (fr.driven ? 1 : 0) + (rr.driven ? 1 : 0);
    for (let i = 0; i < 4; i++) {
      const o = BODY + i * STRIDE;
      const t = TYRE + i * TYRE_STRIDE;
      const s = spec(i);
      const table = tables[i >> 1]!;
      const curves = (i < 2 ? sol.front : sol.rear).kinematics.curves;
      const travel = st.travel[i]!;
      const c = table.sample(travel, side[i]! * (i < 2 ? scalar[0]! : 0), corner(i));
      const bumpToe = interp1(curves.travel, curves.toe, travel);
      const load = st.load[i]!;
      const camberToRoad = c.camber - side[i]! * st.roll;
      cur[o + TRAVEL] = travel;
      cur[o + RATE] = st.travelRate[i]!;
      cur[o + LOAD] = load;
      cur[o + SPRING] = st.springForce[i]! / c.motionRatio;
      // shortcut: damper taken coaxial with the spring (true for every shipped layout's coil-over/strut).
      cur[o + DAMPER] = st.damperForce[i]! / c.motionRatio;
      cur[o + STOP] = st.stop[i]!;
      cur[o + CAMBER] = c.camber;
      cur[o + TOE] = bumpToe;
      // Toe-in on the left wheel points it right (negative steer); the right wheel is the mirror.
      cur[o + STEER] = -side[i]! * (c.toe - bumpToe);
      cur[o + MR] = c.motionRatio;
      if (tyre) {
        const f = Math.sqrt(tyre.fx[i]! * tyre.fx[i]! + tyre.fy[i]! * tyre.fy[i]!);
        const cap = tyre.capacity[i]!;
        cur[o + GRIP] = f === 0 ? 0 : cap > 0 ? Math.min(GRIP_MAX, f / cap) : GRIP_MAX;
        cur[o + SPIN] = wrap(prev[o + SPIN]! + dt * tyre.omega[i]!, TAU);
        cur[t + FX] = tyre.fx[i]!;
        cur[t + FY] = tyre.fy[i]!;
        cur[t + CAP] = cap;
        cur[t + OMEGA] = tyre.omega[i]!;
        cur[t + SLIP_A] = tyre.slipAngle[i]!;
        cur[t + SLIP_R] = tyre.slipRatio[i]!;
        surf[i] = tyre.surface[i]!;
      } else {
        const p = path!;
        const axleLoad = load + st.load[i ^ 1]!;
        const share = axleLoad > 0 ? load / axleLoad : 0;
        const fxAxle = fx < 0 ? fx * s.brakeShare : s.driven ? fx / driven : 0;
        const fyDemand = (i < 2 ? fyFront : fyRear) * share;
        cur[o + GRIP] = Math.min(GRIP_MAX, gripUse(load, fyDemand, fxAxle * share, camberToRoad, s.tyre));
        cur[o + SPIN] = wrap(prev[o + SPIN]! + (dt * p.v * (1 - p.curvature * cy[i]!)) / s.tyre.radius, TAU);
        cur[t + FX] = fxAxle * share;
        cur[t + FY] = fyDemand;
        cur[t + CAP] = load > 0 ? peakMu(load, camberToRoad, s.tyre) * load : 0;
        cur[t + OMEGA] = (p.v * (1 - p.curvature * cy[i]!)) / s.tyre.radius;
        cur[t + SLIP_A] = 0;
        cur[t + SLIP_R] = 0;
      }
      cur[o + WCX] = c.wheelCentre.x - wcx0[i >> 1]!;
      if (events) {
        scalar[1] = dt;
        fire(0, i, st.stop[i]! > STOP_EVENT, events);
        fire(1, i, load < LIFTOFF_LOAD, events);
        fire(2, i, cur[o + GRIP]! > 1, events);
      }
    }
  }

  function fire(kind: number, i: number, condition: boolean, events: SimEvent[]): void {
    const k = kind * 4 + i;
    if (!condition) {
      quiet[k]! += scalar[1]!;
      return;
    }
    if (quiet[k]! >= HYSTERESIS) events.push(kind === 0 ? stopEvents[i]! : kind === 1 ? liftEvents[i]! : gripEvents[i]!);
    quiet[k] = 0;
  }

  function steer(path: PathState): void {
    scalar[0] = tables[0].rackForSteer(datan(L * path.curvature));
  }

  /**
   * Axle-frame LEFT-side points of corner i (mirrored for a right corner, shifted to the axle) to world, using the body
   * pose in `body` / `pose`. Typed arrays in and out: double arguments to a non-inlined call would be boxed.
   */
  function xform(i: number, src: Float64Array, n: number, dst: Float64Array): void {
    const qx = body[0];
    const qy = body[1];
    const qz = body[2];
    const qw = body[3];
    const ax = axleX[i]!;
    const sd = side[i]!;
    for (let k = 0; k < 3 * n; k += 3) {
      const x = ax + src[k]!;
      const y = sd * src[k + 1]!;
      const z = src[k + 2]!;
      // v' = v + 2w(u x v) + 2u x (u x v), u = (qx, qy, qz)
      const tx = 2 * (qy * z - qz * y);
      const ty = 2 * (qz * x - qx * z);
      const tz = 2 * (qx * y - qy * x);
      dst[k] = pose[0]! + x + qw * tx + (qy * tz - qz * ty);
      dst[k + 1] = pose[1]! + y + qw * ty + (qz * tx - qx * tz);
      dst[k + 2] = pose[2]! + z + qw * tz + (qx * ty - qy * tx);
    }
  }
  const ang = new Float64Array(3);
  /** q = Rz(ang[2]) * Ry(ang[1]) * Rx(ang[0]) (quat.fromRollPitchYaw, angles passed in a typed array). */
  function rpy(out: q.Quat): void {
    const cr = dcos(ang[0]! / 2);
    const sr = dsin(ang[0]! / 2);
    const cp = dcos(ang[1]! / 2);
    const sp = dsin(ang[1]! / 2);
    const cy = dcos(ang[2]! / 2);
    const sy = dsin(ang[2]! / 2);
    out[0] = sr * cp * cy - cr * sp * sy;
    out[1] = cr * sp * cy + sr * cp * sy;
    out[2] = cr * cp * sy - sr * sp * cy;
    out[3] = cr * cp * cy + sr * sp * sy;
  }
  const p3 = new Float64Array(3);
  const w3 = new Float64Array(3);
  /** One axle-frame point (an XYZ of a corner solution) of corner i to world. */
  function pointToWorld(i: number, p: XYZ, out: XYZ): void {
    p3[0] = p.x;
    p3[1] = p.y;
    p3[2] = p.z;
    xform(i, p3, 1, w3);
    out.x = w3[0]!;
    out.y = w3[1]!;
    out.z = w3[2]!;
  }

  /**
   * Per-corner TRUE + POSE writes from the interpolated record `smp`, with the body pose already in `body` / `pose`
   * (shared by Auto and the plant, ARCH-M2 §7.3 (1)). `roll` is the reported body roll (camber to road).
   */
  function writeCorners(out: TelemetryFrame, alpha: number, amp: number, roll: number): void {
    let steerSum = 0;
    let wbF = 0;
    let wbR = 0;
    for (let i = 0; i < 4; i++) {
      const o = BODY + i * STRIDE;
      const fc = out.corners[i]!;
      const table = tables[i >> 1]!;
      const sd = side[i]!;
      fc.pointOrder = table.pointOrder;
      fc.travel = smp[o + TRAVEL]!;
      fc.travelRate = smp[o + RATE]!;
      fc.camberBody = smp[o + CAMBER]!;
      fc.camber = fc.camberBody - sd * roll;
      fc.toe = smp[o + TOE]!;
      fc.steer = smp[o + STEER]!;
      fc.load = smp[o + LOAD]!;
      fc.springForce = smp[o + SPRING]!;
      fc.damperForce = smp[o + DAMPER]!;
      fc.motionRatio = smp[o + MR]!;
      fc.gripUse = smp[o + GRIP]!;
      fc.stop = Math.min(1, Math.abs(smp[o + STOP]!));
      const t = TYRE + i * TYRE_STRIDE;
      fc.fx = smp[t + FX]!;
      fc.fy = smp[t + FY]!;
      fc.capacity = smp[t + CAP]!;
      fc.omega = smp[t + OMEGA]!;
      fc.slipAngle = smp[t + SLIP_A]!;
      fc.slipRatio = smp[t + SLIP_R]!;
      fc.surface = SURFACE_KINDS[surf[i]!]!;
      const spin0 = prev[o + SPIN]!;
      let dSpin = cur[o + SPIN]! - spin0;
      if (dSpin < -Math.PI) dSpin += TAU;
      else if (dSpin > Math.PI) dSpin -= TAU;
      const spin = spin0 + dSpin * alpha;
      fc.spin = spin < 0 ? spin + TAU : spin >= TAU ? spin - TAU : spin;
      if (i < 2) steerSum += fc.steer;
      if (i < 2) wbF += smp[o + WCX]! / 2;
      else wbR += smp[o + WCX]! / 2;

      // POSE: table at the amplified travel (clamped to the table range by sample()).
      const c = table.sample(fc.travel * amp, sd * (i < 2 ? scalar[0]! : 0), corner(i));
      pointToWorld(i, c.wheelCentre, fc.wheelPosition);
      // Contact patch on the loaded tyre: lift the unloaded-radius patch by the tyre deflection.
      pointToWorld(i, c.contactPatch, fc.contactPatch);
      fc.contactPatch.z += fc.load / spec(i).tyre.verticalStiffness;
      pointToWorld(i, c.instantCentre, fc.instantCentre);
      xform(i, c.points, c.points.length / 3, fc.points);
      fc.springLength = c.springLength;
      // Wheel attitude: yaw (toe incl. steer) then camber tilt; left toe-in yaws right, camber < 0 tilts the top in.
      ang[0] = -sd * c.camber;
      ang[1] = 0;
      ang[2] = -sd * c.toe;
      rpy(qb);
      q.toXYZW(q.multiply(qa, body, qb), fc.wheelRotation);
      // Front-view IC line (contact patch -> IC) per side, vehicle frame (y, z), for the posed roll centre.
      const r = (i & 1) * 4;
      rcLine[r] = sd * c.contactPatch.y;
      rcLine[r + 1] = c.contactPatch.z;
      rcLine[r + 2] = sd * (c.instantCentre.y - c.contactPatch.y);
      rcLine[r + 3] = c.instantCentre.z - c.contactPatch.z;
      if (i & 1) {
        const axle = out.axles[i >> 1]!;
        axle.rollCentreHeight = smp[RC + (i >> 1)]!;
        axle.antiPitch = smp[ANTI + (i >> 1)]!;
        const det = -rcLine[2]! * rcLine[7]! + rcLine[6]! * rcLine[3]!;
        let y = 0;
        let z = (rcLine[1]! + rcLine[5]!) / 2;
        if (Math.abs(det) > 1e-12) {
          const u = ((rcLine[4]! - rcLine[0]!) * -rcLine[7]! + rcLine[6]! * (rcLine[5]! - rcLine[1]!)) / det;
          y = rcLine[0]! + u * rcLine[2]!;
          z = rcLine[1]! + u * rcLine[3]!;
        }
        // Roll centre on the axle's centre plane (written as a left-side point at x = 0 of this axle).
        rcPoint.x = 0;
        rcPoint.y = clamp(y, -5, 5);
        rcPoint.z = clamp(z, -5, 5);
        pointToWorld(i - 1, rcPoint, axle.rollCentre);
      }
    }
    out.steer = steerSum / 2;
    out.wheelbase = L + wbF - wbR;
    // shortcut: design-point trail of the steered axle (the table has no live steer-axis metrics).
    out.trail = sol.kinematics.front.summary.trail;
  }

  /** smp = prev + (cur - prev) * alpha. */
  function interpolate(alpha: number): void {
    for (let k = 0; k < RECORD; k++) smp[k] = prev[k]! + (cur[k]! - prev[k]!) * alpha;
  }

  // ---- Manual Drive plant (ARCH-M2 §7.3 (5)): built on first use for cars with handling data.
  let plant: VehiclePlant | undefined;
  const core: CarCore | null = vehicle.handling
    ? {
        vehicle,
        handling: vehicle.handling,
        track,
        get world() {
          return (world ??= buildGroundWorld(track, null));
        },
        cx,
        cy,
        unsprung,
        wheelRates,
        tables: () => tables,
        linkages: () => linkages,
        corner,
        ride: () => ride,
        input,
        roadPrev,
        scalar,
        staticDeflectionMean: () => staticDeflectionMean,
        linkInputs(): void {
          input.antiPitch.front = input.ax < 0 ? tables[0].antiPitch : 0;
          input.antiPitch.rear = input.ax >= 0 ? tables[1].antiPitch : 0;
          rcInputs();
        },
        beginStep: () => prev.set(cur),
        holdRecord: () => prev.set(cur),
        derive: (dt, events, tyre) => derive(null, dt, events, tyre),
        resetEventHysteresis: () => quiet.fill(HYSTERESIS),
        interpolate(alpha, out): void {
          interpolate(alpha);
          out[0] = smp[HEAVE]!;
          out[1] = smp[ROLL]!;
          out[2] = smp[PITCH]!;
        },
        writeBody(out, planeRoll, planePitch, yaw, relRoll, relPitch, x, y, z): void {
          ang[0] = planeRoll;
          ang[1] = planePitch;
          ang[2] = yaw;
          rpy(qa);
          ang[0] = relRoll;
          ang[1] = relPitch;
          ang[2] = 0;
          rpy(qb);
          q.multiply(body, qa, qb);
          pose[0] = x;
          pose[1] = y;
          pose[2] = z;
          q.toXYZW(body, out.bodyRotation);
          out.bodyPosition.x = x;
          out.bodyPosition.y = y;
          out.bodyPosition.z = z;
        },
        writeCorners,
      }
    : null;

  return {
    corners: LAYOUT,
    get kinematics(): VehicleKinematics {
      return sol.kinematics;
    },
    get plant(): VehiclePlant | undefined {
      return core ? (plant ??= createPlant(core, plantOptions)) : undefined;
    },
    setSuspension,

    reset(path: PathState): void {
      steer(path);
      vcPlane(path.s);
      refZ = vc.cg;
      refSlope = vc.slope;
      roadInputs(path);
      bodyInputs(path);
      input.roadRate.fill(0);
      roadPrev.set(input.road);
      // Roll-centre heights depend on the travel they produce: two passes are plenty (RC changes by mm).
      input.rcHeight.front = tables[0].rollCentreHeight(0, 0);
      input.rcHeight.rear = tables[1].rollCentreHeight(0, 0);
      try {
        ride.reset(input);
        rcInputs();
        ride.reset(input);
      } catch {
        // Rough spot (e.g. diagonal wheels unloaded at the solver's initial guess): equilibrium on the reference
        // plane instead; the seek pre-roll then settles onto the real road deterministically.
        input.road.fill(0);
        ride.reset(input);
        roadInputs(path);
      }
      quiet.fill(HYSTERESIS);
      derive(path, 0, undefined);
      prev.set(cur);
    },

    step(dt: number, path: PathState, events: SimEvent[]): void {
      prev.set(cur);
      steer(path);
      roadInputs(path);
      for (let i = 0; i < 4; i++) {
        input.roadRate[i] = (input.road[i]! - roadPrev[i]!) / dt;
        roadPrev[i] = input.road[i]!;
      }
      bodyInputs(path);
      rcInputs();
      ride.step(dt, input);
      derive(path, dt, events);
    },

    sample(alpha: number, amplification: number, path: PathState, out: TelemetryFrame): void {
      interpolate(alpha);
      const amp = amplification;
      // Vertical-curve road plane under the axles (crest/dip): heave/pitch are reported relative to it.
      vcPlane(path.s);
      const vcCg = vc.cg;
      const pitchPlane = -vc.slope;
      const vc0 = path.z - path.l * dtan(path.bank) - swellA * dsin(swellK * path.s);
      const heave = smp[HEAVE]! + refZ - vcCg;
      const pitch = smp[PITCH]! - refSlope - pitchPlane;
      const roll = smp[ROLL]!;
      out.heave = heave;
      out.pitch = pitch;
      out.roll = roll;
      out.amplification = amp;

      // Body pose: path frame (heading, swell grade, bank) * (vertical-curve pitch + amplified relative pitch, roll).
      ang[0] = path.bank;
      ang[1] = -datan(swellA * swellK * dcos(swellK * path.s));
      ang[2] = path.heading;
      rpy(qa);
      ang[0] = roll * amp;
      ang[1] = pitchPlane + pitch * amp;
      ang[2] = 0;
      rpy(qb);
      q.multiply(body, qa, qb);
      pose[0] = path.x;
      pose[1] = path.y;
      pose[2] = path.z - vc0 + vcCg + heave * amp - staticDeflectionMean;
      q.toXYZW(body, out.bodyRotation);
      out.bodyPosition.x = pose[0];
      out.bodyPosition.y = pose[1];
      out.bodyPosition.z = pose[2];

      writeCorners(out, alpha, amp, roll);
    },

    restPose(cornerIndex: number, _path: PathState, out: Float64Array): Float64Array {
      const i = cornerIndex;
      const c = tables[i >> 1]!.sample(0, side[i]! * (i < 2 ? scalar[0]! : 0), restSol);
      // restSol is sized for the larger table; only this corner's table's points are transformed.
      xform(i, c.points, tables[i >> 1]!.pointOrder.length, out);
      return out;
    },
  };
}
