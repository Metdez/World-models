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
import { clamp, interp1, lerp, lerpAngle, wrap, wrapAngle } from '../math/interp';
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
} from '../ride/ride7dof';
import { gripUse } from '../ride/tyre';

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
const RECORD = BODY + 4 * STRIDE;

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

export function createCarModel(vehicleDef: VehicleDefinition, suspensionDef: SuspensionDefinition, track: BuiltTrack) {
  asCar(vehicleDef);
  const vehicle = vehicleDef as CarDefinition;
  const L = vehicle.wheelbase;
  const a = vehicle.cgToFront;
  const axleX = [a, a, a - L, a - L] as const;
  const side = [1, -1, 1, -1] as const;
  const spec = (i: number): CarAxleSpec => (i < 2 ? vehicle.front : vehicle.rear);
  const swellA = track.def.swell.amplitude;
  const swellK = (TAU * track.def.swell.cycles) / track.length;
  const swell = (s: number): number => swellA * Math.sin(swellK * s);

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

  function install(suspension: CarSuspensionDefinition): void {
    sol = prepareCarSuspension(vehicle, suspension);
    tables = [sol.front.table, sol.rear.table];
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

    function rideCorner(i: number): RideCornerParams {
      const s = spec(i);
      const linkage = i < 2 ? suspension.axles.front : suspension.axles.rear;
      // Sprung corner mass by the lever rule (the ride model uses the same split for its preload).
      const m = (ms * (i < 2 ? -xR : xF)) / (xF - xR) / 2;
      const k = wheelRateForRideFrequency(s.rideFrequency, m, s.tyre.verticalStiffness);
      const mu = s.unsprungMass + suspension.extras.unsprungMassDelta;
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

  function setSuspension(def: SuspensionDefinition): void {
    asCar(def);
    install(def as CarSuspensionDefinition);
  }
  setSuspension(suspensionDef);

  // ---- scratch (no allocation in step/sample)
  const cur = new Float64Array(RECORD);
  const prev = new Float64Array(RECORD);
  const smp = new Float64Array(RECORD);
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
  const ts: TrackSample = { s: 0, x: 0, y: 0, z: 0, heading: 0, curvature: 0, bank: 0, grade: 0 };
  let rack = 0;
  // Ride-model reference plane relative to the path's reference plane, frozen at reset (a rigid offset leaves the
  // small-angle ride model unchanged): starting the static solve on the local vertical curve keeps every tyre in
  // contact at its initial guess (a dip deeper than the static tyre deflection would leave it singular).
  let refZ = 0;
  let refSlope = 0;
  const vc = { cg: 0, slope: 0 };
  const pose = { x: 0, y: 0, z: 0 };
  const body = q.create();
  const qa = q.create();
  const qb = q.create();
  const rcLine = new Float64Array(8);
  const stopEvents = LAYOUT.map((_, corner) => ({ kind: 'bump-stop', corner }) as const);
  const liftEvents = LAYOUT.map((_, corner) => ({ kind: 'liftoff', corner }) as const);
  const gripEvents = LAYOUT.map((_, corner) => ({ kind: 'grip-limit', corner }) as const);

  /** Per-wheel road deviation from the reference plane of the path (3-point envelope along the road). */
  function roadInputs(path: PathState): void {
    track.sample(path.s, ts);
    const dpsi = wrapAngle(path.heading - ts.heading);
    const c = Math.cos(dpsi);
    const sn = Math.sin(dpsi);
    const tb = Math.tan(path.bank);
    for (let i = 0; i < 4; i++) {
      const si = path.s + cx[i]! * c - cy[i]! * sn;
      const li = path.l + cx[i]! * sn + cy[i]! * c;
      const h = (track.roadHeight(si - ENVELOPE, li) + track.roadHeight(si, li) + track.roadHeight(si + ENVELOPE, li)) / 3;
      input.road[i] = h - swell(si) - li * tb - refZ - refSlope * cx[i]!;
    }
  }

  /** Vertical-curve (crest/dip) road plane under the axles at path s: height at the CG and slope dz/dx. */
  function vcPlane(s: number): void {
    const xF = (cx[0]! + cx[1]!) / 2;
    const xR = (cx[2]! + cx[3]!) / 2;
    const vcF = track.sample(s + xF, ts).z - swell(s + xF);
    const vcR = track.sample(s + xR, ts).z - swell(s + xR);
    vc.slope = (vcF - vcR) / (xF - xR);
    vc.cg = vcR - vc.slope * xR;
  }

  /** Specific forces the tyres supply in the road plane (m/s^2) and the matching anti-pitch fractions. */
  function bodyInputs(path: PathState): void {
    const drag = (0.5 * RHO_AIR * vehicle.dragArea * path.v * path.v) / vehicle.mass;
    input.ax = path.ax + (G * path.grade) / Math.sqrt(1 + path.grade * path.grade) + drag;
    input.ay = path.ay * Math.cos(path.bank) + G * Math.sin(path.bank);
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

  /** TRUE per-corner values of the current ride state into `cur`; fires events. */
  function derive(path: PathState, dt: number, events: SimEvent[] | undefined): void {
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
      const s = spec(i);
      const table = tables[i >> 1]!;
      const curves = (i < 2 ? sol.front : sol.rear).kinematics.curves;
      const travel = st.travel[i]!;
      const c = table.sample(travel, side[i]! * (i < 2 ? rack : 0), corner(i));
      const bumpToe = interp1(curves.travel, curves.toe, travel);
      const load = st.load[i]!;
      const axleLoad = load + st.load[i ^ 1]!;
      const share = axleLoad > 0 ? load / axleLoad : 0;
      const fxAxle = fx < 0 ? fx * s.brakeShare : s.driven ? fx / driven : 0;
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
      cur[o + GRIP] = Math.min(GRIP_MAX, gripUse(load, (i < 2 ? fyFront : fyRear) * share, fxAxle * share, camberToRoad, s.tyre));
      cur[o + SPIN] = wrap(prev[o + SPIN]! + (dt * path.v * (1 - path.curvature * cy[i]!)) / s.tyre.radius, TAU);
      cur[o + WCX] = c.wheelCentre.x - wcx0[i >> 1]!;
      if (events) {
        fire(0, i, st.stop[i]! > STOP_EVENT, dt, events);
        fire(1, i, load < LIFTOFF_LOAD, dt, events);
        fire(2, i, cur[o + GRIP]! > 1, dt, events);
      }
    }
  }

  function fire(kind: number, i: number, condition: boolean, dt: number, events: SimEvent[]): void {
    const k = kind * 4 + i;
    if (!condition) {
      quiet[k]! += dt;
      return;
    }
    if (quiet[k]! >= HYSTERESIS) events.push(kind === 0 ? stopEvents[i]! : kind === 1 ? liftEvents[i]! : gripEvents[i]!);
    quiet[k] = 0;
  }

  function steer(path: PathState): void {
    rack = tables[0].rackForSteer(Math.atan(L * path.curvature));
  }

  /** World point of a vehicle-frame point (body pose in `body`, origin in `pose`). */
  function toWorld(x: number, y: number, z: number, out: XYZ): XYZ {
    const qx = body[0];
    const qy = body[1];
    const qz = body[2];
    const qw = body[3];
    // v' = v + 2w(u x v) + 2u x (u x v), u = (qx, qy, qz)
    const tx = 2 * (qy * z - qz * y);
    const ty = 2 * (qz * x - qx * z);
    const tz = 2 * (qx * y - qy * x);
    out.x = pose.x + x + qw * tx + (qy * tz - qz * ty);
    out.y = pose.y + y + qw * ty + (qz * tx - qx * tz);
    out.z = pose.z + z + qw * tz + (qx * ty - qy * tx);
    return out;
  }
  const tmp: XYZ = { x: 0, y: 0, z: 0 };
  function pointsToWorld(i: number, c: CornerSolution, out: Float64Array): void {
    const p = c.points;
    const n = p.length / 3;
    const ax = axleX[i]!;
    const sd = side[i]!;
    for (let k = 0; k < n; k++) {
      toWorld(ax + p[3 * k]!, sd * p[3 * k + 1]!, p[3 * k + 2]!, tmp);
      out[3 * k] = tmp.x;
      out[3 * k + 1] = tmp.y;
      out[3 * k + 2] = tmp.z;
    }
  }

  return {
    corners: LAYOUT,
    get kinematics(): VehicleKinematics {
      return sol.kinematics;
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
      for (let k = 0; k < RECORD; k++) smp[k] = lerp(prev[k]!, cur[k]!, alpha);
      const amp = amplification;
      // Vertical-curve road plane under the axles (crest/dip): heave/pitch are reported relative to it.
      vcPlane(path.s);
      const vcCg = vc.cg;
      const pitchPlane = -vc.slope;
      const vc0 = track.sample(path.s, ts).z - swell(path.s);
      const heave = smp[HEAVE]! + refZ - vcCg;
      const pitch = smp[PITCH]! - refSlope - pitchPlane;
      const roll = smp[ROLL]!;
      out.heave = heave;
      out.pitch = pitch;
      out.roll = roll;
      out.amplification = amp;

      // Body pose: path frame (heading, swell grade, bank) * (vertical-curve pitch + amplified relative pitch, roll).
      q.fromRollPitchYaw(qa, path.bank, -Math.atan(swellA * swellK * Math.cos(swellK * path.s)), path.heading);
      q.fromRollPitchYaw(qb, roll * amp, pitchPlane + pitch * amp, 0);
      q.multiply(body, qa, qb);
      pose.x = path.x;
      pose.y = path.y;
      pose.z = path.z - vc0 + vcCg + heave * amp - staticDeflectionMean;
      q.toXYZW(body, out.bodyRotation);
      out.bodyPosition.x = pose.x;
      out.bodyPosition.y = pose.y;
      out.bodyPosition.z = pose.z;

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
        fc.spin = wrap(lerpAngle(prev[o + SPIN]!, cur[o + SPIN]!, alpha), TAU);
        if (i < 2) steerSum += fc.steer;
        if (i < 2) wbF += smp[o + WCX]! / 2;
        else wbR += smp[o + WCX]! / 2;

        // POSE: table at the amplified travel (clamped to the table range by sample()).
        const c = table.sample(fc.travel * amp, sd * (i < 2 ? rack : 0), corner(i));
        const ax = axleX[i]!;
        toWorld(ax + c.wheelCentre.x, sd * c.wheelCentre.y, c.wheelCentre.z, fc.wheelPosition);
        // Contact patch on the loaded tyre: lift the unloaded-radius patch by the tyre deflection.
        toWorld(ax + c.contactPatch.x, sd * c.contactPatch.y, c.contactPatch.z, fc.contactPatch);
        fc.contactPatch.z += fc.load / spec(i).tyre.verticalStiffness;
        toWorld(ax + c.instantCentre.x, sd * c.instantCentre.y, c.instantCentre.z, fc.instantCentre);
        pointsToWorld(i, c, fc.points);
        fc.springLength = c.springLength;
        // Wheel attitude: yaw (toe incl. steer) then camber tilt; left toe-in yaws right, camber < 0 tilts the top in.
        q.fromRollPitchYaw(qb, -sd * c.camber, 0, -sd * c.toe);
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
          toWorld(ax, clamp(y, -5, 5), clamp(z, -5, 5), axle.rollCentre);
        }
      }
      out.steer = steerSum / 2;
      out.wheelbase = L + wbF - wbR;
      // shortcut: design-point trail of the steered axle (the table has no live steer-axis metrics).
      out.trail = sol.kinematics.front.summary.trail;
    },

    restPose(cornerIndex: number, _path: PathState, out: Float64Array): Float64Array {
      const i = cornerIndex;
      const c = tables[i >> 1]!.sample(0, side[i]! * (i < 2 ? rack : 0), restSol);
      const n = tables[i >> 1]!.pointOrder.length * 3;
      // restSol is sized for the larger table; only the first n entries belong to this corner's table.
      const ax = axleX[i]!;
      for (let k = 0; k < n; k += 3) {
        toWorld(ax + c.points[k]!, side[i]! * c.points[k + 1]!, c.points[k + 2]!, tmp);
        out[k] = tmp.x;
        out[k + 1] = tmp.y;
        out[k + 2] = tmp.z;
      }
      return out;
    },
  };
}
