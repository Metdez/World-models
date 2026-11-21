/**
 * Motorcycle vehicle model (ARCHITECTURE §7.2.4, §7.7): planar kinematics tables (planar.ts), the 4-DOF in-plane ride
 * model (ride4dof.ts) and the lean/steer tracker (lean.ts) on the 02-01 road.
 *
 * Road: each tyre sees the road minus the SMOOTH road plane (elevation + bank), i.e. roughness and features. The plane
 * through the two contact points carries the body (heave/pitch are reported relative to it); its vertical curvature
 * enters as a vertical acceleration (crest light, dip heavy). shortcut: the plane's pitch acceleration is not fed back.
 * Lean is a rigid rotation of the whole bike about the tyre-crown line over the contact line; the 4-DOF runs in the
 * leaned plane with g_eff = sqrt((g·cos grade)² + ay²) + vertical-curve acceleration (extra sag in corners).
 * Amplification scales pitch, heave and wheel travel in POSE only; the lean is never amplified (it is not a suspension
 * motion and the true value is already large).
 * Corner 0 = 'f', 1 = 'r'. `travel` is vertical wheel travel in the vehicle frame (+ bump); `motionRatio` is
 * d(spring compression)/d(travel); spring/damper forces are per shock (fork: both legs together).
 */
import type { PathState, SimEvent } from '../../contracts/sim';
import type { AxleKinematics, KinematicsCurves, MotorcycleSuspensionDefinition, SuspensionDefinition, VehicleKinematics } from '../../contracts/suspension';
import { MAX_POINTS, type CornerLayout, type TelemetryFrame } from '../../contracts/telemetry';
import type { BuiltTrack, TrackSample } from '../../contracts/track';
import { G } from '../../contracts/units';
import type { MotorcycleDefinition, VehicleDefinition } from '../../contracts/vehicle';
import { wrap, wrapAngle } from '../math/interp';
import * as quat from '../math/quat';
import { createLean, GAMMA, PHI, STEER, type Lean } from './lean';
import { buildMotoTables, axlePositions, CHI, DX, DZ, ICX, ICZ, KX, LEN, MR, POINTS, WX, WZ, type EndTable, type MotoTables } from './planar';
import { createRide4, prepareEnd, TH, Z, type EndParams, type Ride4, type Ride4Input } from './ride4dof';
import { datan, datan2, dcos, dsin, dtan } from '../math/det';

const LAYOUT: readonly CornerLayout[] = [
  { id: 'f', axle: 'front', side: 0 },
  { id: 'r', axle: 'rear', side: 0 },
];
const ENVELOPE = 0.1;
const RHO_AIR = 1.225;
const HYSTERESIS = 0.5;
const LIFTOFF_LOAD = 50;
const STOP_EVENT = 0.5;
const GRIP_MAX = 2;
const TAU = 2 * Math.PI;

// ---- step record
const HEAVE = 0;
const PITCH = 1;
const ROLL = 2;
const STEER_R = 3;
const TRAIL = 4;
const WB = 5;
const ANTI = 6; // + end
const GAM = 8;
const ENDS = 9;
const TRAVEL = 0;
const RATE = 1;
const LOAD = 2;
const SPRING = 3;
const DAMPER = 4;
const STOP = 5;
const MRATIO = 6;
const GRIP = 7;
const SPIN = 8;
const DEFL = 9;
const STRIDE = 10;
const RECORD = ENDS + 2 * STRIDE;

export interface MotoSolution {
  readonly tables: MotoTables;
  readonly front: EndParams;
  readonly rear: EndParams;
  readonly kinematics: VehicleKinematics;
  /** Rear tyre radius / rear sprocket radius. */
  readonly sprocketRatio: number;
}

const solved = new WeakMap<MotorcycleSuspensionDefinition, WeakMap<MotorcycleDefinition, MotoSolution>>();

/** Trail (m, + when the steering axis meets the ground ahead of the contact) of a posed front table row. */
export function trailOf(row: Float64Array, head: readonly [number, number], pitch: number, heave: number, groundZ: number): number {
  const c = dcos(pitch);
  const s = dsin(pitch);
  // Nose-down pitch: x' = x cos + z sin, z' = −x sin + z cos.
  const hx = head[0] * c + head[1] * s;
  const hz = -head[0] * s + head[1] * c + heave;
  const dx = row[DX]! * c + row[DZ]! * s;
  const dz = -row[DX]! * s + row[DZ]! * c;
  const wx = row[WX]! * c + row[WZ]! * s;
  return hx + ((groundZ - hz) / dz) * dx - wx;
}

/** Tables, sag, rates and kinematic summaries of a preset on a vehicle (cached for the session). */
export function prepareMotoSuspension(vehicle: MotorcycleDefinition, s: MotorcycleSuspensionDefinition): MotoSolution {
  let byVehicle = solved.get(s);
  if (!byVehicle) solved.set(s, (byVehicle = new WeakMap()));
  const hit = byVehicle.get(vehicle);
  if (hit) return hit;
  const tables = buildMotoTables(vehicle, s);
  for (const t of [tables.front, tables.rear]) if (t.pointOrder.length > MAX_POINTS) throw new Error(`"${s.id}" has too many points`);
  const L = vehicle.wheelbase;
  const a = vehicle.cgToFront;
  const ms = vehicle.sprungMass;
  const axles = axlePositions(vehicle);
  const front = prepareEnd(
    {
      table: tables.front,
      x: axles.front[0],
      unsprungMass: s.front.unsprungMass,
      tyreRate: vehicle.front.tyre.verticalStiffness,
      tyreDamping: vehicle.front.tyre.verticalDamping,
      spring: s.front.spring,
      damper: s.front.damper,
      stiction: s.front.kind === 'telescopic' ? s.front.stiction : 0,
      staticForce: (ms * G * (L - a)) / L,
    },
    G,
  );
  const rear = prepareEnd(
    {
      table: tables.rear,
      x: axles.rear[0],
      unsprungMass: s.rear.unsprungMass,
      tyreRate: vehicle.rear.tyre.verticalStiffness,
      tyreDamping: vehicle.rear.tyre.verticalDamping,
      spring: s.rear.spring,
      damper: s.rear.damper,
      stiction: 0,
      staticForce: (ms * G * a) / L,
    },
    G,
  );
  const sprocketRatio = vehicle.rear.tyre.radius / vehicle.chain.rearRadius;
  const h = vehicle.cgHeight;
  const row = new Float64Array(tables.front.stride);
  const head: [number, number] = [s.front.steeringHead[0], s.front.steeringHead[2]];

  const curves = (t: EndTable, p: EndParams): KinematicsCurves => {
    const i0 = Math.round((-p.droop - t.w[0]!) / (t.w[1]! - t.w[0]!));
    const i1 = Math.round((p.bump - t.w[0]!) / (t.w[1]! - t.w[0]!));
    const n = i1 - i0 + 1;
    const travel = new Float64Array(n);
    const motionRatio = new Float64Array(n);
    const longitudinal = new Float64Array(n);
    const x0 = t.sample(0, new Float64Array(t.stride))[WX]!;
    for (let k = 0; k < n; k++) {
      const o = (i0 + k) * t.stride;
      travel[k] = t.w[i0 + k]!;
      motionRatio[k] = t.rows[o + MR]!;
      longitudinal[k] = t.rows[o + WX]! - x0;
    }
    return {
      travel,
      camber: new Float64Array(n),
      toe: new Float64Array(n),
      rollCentreHeight: new Float64Array(n).fill(NaN),
      motionRatio,
      lateral: new Float64Array(n),
      longitudinal,
    };
  };
  const summary = (end: 'front' | 'rear', t: EndTable): AxleKinematics['summary'] => {
    t.sample(0, row);
    const anti = end === 'front' ? (vehicle.front.brakeShare * row[KX]! * L) / h : (-(row[KX]! + sprocketRatio * row[CHI]!) * L) / h;
    return {
      camberGain: 0,
      rollCamber: 0,
      bumpSteer: 0,
      rollCentreHeight: NaN,
      rollCentreMigration: NaN,
      kingpinInclination: NaN,
      caster: end === 'front' ? datan2(-row[DX]!, row[DZ]!) : NaN,
      scrubRadius: NaN,
      trail: end === 'front' ? trailOf(row, head, 0, 0, front.tyreDeflection) : NaN,
      antiPitch: anti,
      motionRatio: row[MR]!,
    };
  };
  const kinematics: VehicleKinematics = {
    front: { axle: 'front', curves: curves(tables.front, front), summary: summary('front', tables.front) },
    rear: { axle: 'rear', curves: curves(tables.rear, rear), summary: summary('rear', tables.rear) },
  };
  const sol: MotoSolution = { tables, front, rear, kinematics, sprocketRatio };
  byVehicle.set(vehicle, sol);
  return sol;
}

function asMoto(def: VehicleDefinition | SuspensionDefinition): void {
  const cls = 'class' in def ? def.class : def.vehicleClass;
  if (cls !== 'motorcycle') throw new Error(`"${def.id}" is a ${cls} definition, not a motorcycle one`);
}

export function createMotoModel(vehicleDef: VehicleDefinition, suspensionDef: SuspensionDefinition, track: BuiltTrack) {
  asMoto(vehicleDef);
  const vehicle = vehicleDef as MotorcycleDefinition;
  const L = vehicle.wheelbase;
  const a = vehicle.cgToFront;
  const h = vehicle.cgHeight;
  const M = vehicle.mass;
  const xs = [a, a - L] as const;
  const tyres = [vehicle.front.tyre, vehicle.rear.tyre] as const;
  const crowns = [tyres[0].crownRadius ?? 0, tyres[1].crownRadius ?? 0] as const;
  const crown = (crowns[0] + crowns[1]) / 2;
  const share = [vehicle.front.brakeShare, vehicle.rear.brakeShare] as const;

  let sol!: MotoSolution;
  let ride!: Ride4;
  let lean!: Lean;
  let suspension!: MotorcycleSuspensionDefinition;
  const head = new Float64Array(2);
  const input: Ride4Input = { fx: new Float64Array(2), drive: 0, geff: G, road: new Float64Array(2), roadRate: new Float64Array(2) };

  function install(s: MotorcycleSuspensionDefinition): void {
    suspension = s;
    sol = prepareMotoSuspension(vehicle, s);
    const old = ride;
    ride = createRide4({ sprungMass: vehicle.sprungMass, cgHeight: h, inertiaPitch: vehicle.inertia.pitch, front: sol.front, rear: sol.rear, sprocketRatio: sol.sprocketRatio });
    if (old) ride.q.set(old.q);
    lean = createLean({ wheelbase: L, cgHeight: h, crown, rake: s.front.rake });
    head[0] = s.front.steeringHead[0];
    head[1] = s.front.steeringHead[2];
  }
  function setSuspension(def: SuspensionDefinition): void {
    asMoto(def);
    install(def as MotorcycleSuspensionDefinition);
  }
  setSuspension(suspensionDef);

  // ---- scratch
  const cur = new Float64Array(RECORD);
  const prev = new Float64Array(RECORD);
  const smp = new Float64Array(RECORD);
  const quiet = new Float64Array(6);
  const roadPrev = new Float64Array(2);
  const ts: TrackSample = { s: 0, x: 0, y: 0, z: 0, heading: 0, curvature: 0, bank: 0, grade: 0 };
  /** [plane z at front contact, rear contact, CG (world), vertical acceleration, dt, steer]. */
  const plane = new Float64Array(6);
  const rowF = new Float64Array(64);
  const rowR = new Float64Array(64);
  const rows = [rowF, rowR] as const;
  const head2: [number, number] = [0, 0];
  const body = quat.create();
  const qa = quat.create();
  const qb = quat.create();
  const qs = quat.create();
  const v3 = [0, 0, 0] as [number, number, number];
  const vin = [0, 0, 0] as [number, number, number];
  const UP = [0, 0, 1] as const;
  /** Writes (x, y, z) into the reusable input vector (no array literal per call). */
  const vec = (x: number, y: number, z: number): [number, number, number] => ((vin[0] = x), (vin[1] = y), (vin[2] = z), vin);
  const origin = new Float64Array(3);
  const nRoad = new Float64Array(3);
  const pt = new Float64Array(3);
  const stopEvents = LAYOUT.map((_, corner) => ({ kind: 'bump-stop', corner }) as const);
  const liftEvents = LAYOUT.map((_, corner) => ({ kind: 'liftoff', corner }) as const);
  const gripEvents = LAYOUT.map((_, corner) => ({ kind: 'grip-limit', corner }) as const);

  /** Smooth road plane at the contacts, per-tyre road deviation, vertical-curve acceleration. */
  function roadInputs(path: PathState): void {
    track.sample(path.s, ts);
    const dpsi = wrapAngle(path.heading - ts.heading);
    const c = dcos(dpsi);
    const sn = dsin(dpsi);
    const zc = ts.z + path.l * dtan(ts.bank);
    for (let i = 0; i < 2; i++) {
      const si = path.s + xs[i]! * c;
      const li = path.l + xs[i]! * sn;
      track.sample(si, ts);
      const smooth = ts.z + li * dtan(ts.bank);
      plane[i] = smooth;
      const r = (track.roadHeight(si - ENVELOPE, li) + track.roadHeight(si, li) + track.roadHeight(si + ENVELOPE, li)) / 3;
      input.road[i] = r - smooth;
    }
    plane[2] = plane[1]! + ((plane[0]! - plane[1]!) * -xs[1]!) / L;
    const curvature = (2 * ((plane[0]! - zc) / xs[0]! - (zc - plane[1]!) / -xs[1]!)) / L;
    plane[3] = path.v * path.v * curvature;
  }

  function bodyInputs(path: PathState): void {
    const cg = 1 / Math.sqrt(1 + path.grade * path.grade);
    const ax = path.ax + G * path.grade * cg + (0.5 * RHO_AIR * vehicle.dragArea * path.v * path.v) / M;
    if (ax < 0) {
      input.fx[0] = share[0] * M * ax;
      input.fx[1] = share[1] * M * ax;
      input.drive = 0;
    } else {
      input.fx[0] = 0;
      input.fx[1] = M * ax;
      input.drive = 1;
    }
    input.geff = Math.sqrt(G * G * cg * cg + path.ay * path.ay) + plane[3]!;
  }

  function derive(path: PathState, dt: number, events: SimEvent[] | undefined): void {
    const q = ride.q;
    const ls = lean.state;
    cur[HEAVE] = q[Z]!;
    cur[PITCH] = q[TH]!;
    cur[ROLL] = -ls[PHI]!;
    cur[STEER_R] = ls[STEER]!;
    cur[GAM] = ls[GAMMA]!;
    const r0 = ride.rows[0];
    const r1 = ride.rows[1];
    head2[0] = head[0]!;
    head2[1] = head[1]!;
    const defF = ride.load[0]! / tyres[0].verticalStiffness;
    cur[TRAIL] = trailOf(r0, head2, q[TH]!, q[Z]!, rowGround(r0, q[TH]!, q[Z]!, defF, 0));
    const c = dcos(q[TH]!);
    const s = dsin(q[TH]!);
    cur[WB] = r0[WX]! * c + r0[WZ]! * s - (r1[WX]! * c + r1[WZ]! * s);
    cur[ANTI] = (share[0] * r0[KX]! * L) / h;
    cur[ANTI + 1] = (-(r1[KX]! + sol.sprocketRatio * r1[CHI]!) * L) / h;
    const gamma = ls[GAMMA]!;
    const cosG = dcos(gamma);
    const sinG = dsin(gamma);
    for (let i = 0; i < 2; i++) {
      const o = ENDS + i * STRIDE;
      const r = ride.rows[i]!;
      const k = (i === 0 ? sol.tables.front : sol.tables.rear).stride;
      const n = ride.load[i]!;
      const fz = n * cosG;
      const fy = n * sinG;
      const fx = input.fx[i]!;
      const tyre = tyres[i]!;
      const mu = tyre.mu + tyre.loadSensitivity * (fz - tyre.nominalLoad);
      const demand = Math.sqrt(fx * fx + fy * fy);
      cur[o + TRAVEL] = ride.w[i]!;
      cur[o + RATE] = ride.wd[i]!;
      cur[o + LOAD] = fz;
      cur[o + SPRING] = r[k]!;
      cur[o + DAMPER] = r[k + 1]!;
      cur[o + STOP] = r[k + 2]!;
      cur[o + MRATIO] = r[MR]!;
      cur[o + GRIP] = fz > 1 ? Math.min(GRIP_MAX, demand / (mu * fz)) : demand > 1 ? GRIP_MAX : 0;
      cur[o + SPIN] = wrap(prev[o + SPIN]! + (dt * path.v) / tyre.radius, TAU);
      cur[o + DEFL] = n / tyre.verticalStiffness;
      if (events) {
        plane[4] = dt;
        fire(0, i, cur[o + STOP]! > STOP_EVENT, events);
        fire(1, i, n < LIFTOFF_LOAD, events);
        fire(2, i, cur[o + GRIP]! > 1, events);
      }
    }
  }

  /** Ground height (plane coordinates) under a posed wheel row: wheel-centre height minus the loaded radius. */
  function rowGround(r: Float64Array, pitch: number, heave: number, deflection: number, end: number): number {
    const wz = -r[WX]! * dsin(pitch) + r[WZ]! * dcos(pitch) + heave;
    return wz - (tyres[end]!.radius - deflection);
  }

  function fire(kind: number, i: number, condition: boolean, events: SimEvent[]): void {
    const k = kind * 2 + i;
    if (!condition) {
      quiet[k] = quiet[k]! + plane[4]!;
      return;
    }
    if (quiet[k]! >= HYSTERESIS) events.push(kind === 0 ? stopEvents[i]! : kind === 1 ? liftEvents[i]! : gripEvents[i]!);
    quiet[k] = 0;
  }

  /** Body pose (world) for a path state, relative pitch/heave and lean; fills `body`, `origin`, `nRoad`. */
  function poseBody(path: PathState, pitch: number, heave: number, roll: number): void {
    roadInputs(path);
    const pitchPlane = -datan((plane[0]! - plane[1]!) / L);
    quat.fromRollPitchYaw(qa, 0, pitchPlane, path.heading);
    quat.fromRollPitchYaw(qb, path.bank, 0, 0);
    quat.multiply(qa, qa, qb);
    quat.rotate(v3, qa, UP);
    nRoad[0] = v3[0];
    nRoad[1] = v3[1];
    nRoad[2] = v3[2];
    quat.fromRollPitchYaw(qb, roll, 0, 0);
    quat.multiply(qs, qa, qb);
    quat.fromRollPitchYaw(qb, 0, pitch, 0);
    quat.multiply(body, qs, qb);
    // Crown line (height ρ in the body) sits ρ above the road along its normal.
    const lift = -crown + heave - (sol.front.tyreDeflection + sol.rear.tyreDeflection) / 2;
    quat.rotate(v3, body, vec(0, 0, lift));
    origin[0] = path.x + crown * nRoad[0]! + v3[0];
    origin[1] = path.y + crown * nRoad[1]! + v3[1];
    origin[2] = plane[2]! + crown * nRoad[2]! + v3[2];
  }

  /** Body point (x, y, z) to world into pt. */
  function toWorld(x: number, y: number, z: number): void {
    quat.rotate(v3, body, vec(x, y, z));
    pt[0] = origin[0]! + v3[0];
    pt[1] = origin[1]! + v3[1];
    pt[2] = origin[2]! + v3[2];
  }

  /** Steered front point: rotate (x, y, z) about the steering axis through the head by the steer angle, then to world. */
  function steeredToWorld(r: Float64Array, x: number, y: number, z: number, steer: number): void {
    quat.fromAxisAngle(qb, vec(r[DX]!, 0, r[DZ]!), steer);
    quat.rotate(v3, qb, vec(x - head[0]!, y, z - head[1]!));
    toWorld(head[0]! + v3[0], v3[1], head[1]! + v3[2]);
  }

  /** Writes the posed points of end i (row r, steer) into dst (pointOrder triples). */
  function writePoints(i: number, r: Float64Array, steer: number, dst: Float64Array): void {
    const t = i === 0 ? sol.tables.front : sol.tables.rear;
    for (let k = 0; k < t.pointOrder.length; k++) {
      const x = r[POINTS + 2 * k]!;
      const z = r[POINTS + 2 * k + 1]!;
      const y = t.pointY[k]!;
      if (t.steered[k]) steeredToWorld(r, x, y, z, steer);
      else toWorld(x, y, z);
      dst[3 * k] = pt[0]!;
      dst[3 * k + 1] = pt[1]!;
      dst[3 * k + 2] = pt[2]!;
    }
  }

  return {
    corners: LAYOUT,
    get kinematics(): VehicleKinematics {
      return sol.kinematics;
    },
    /** The active preset (tests). */
    get suspension(): MotorcycleSuspensionDefinition {
      return suspension;
    },
    get ride(): Ride4 {
      return ride;
    },
    get lean(): Lean {
      return lean;
    },
    get input(): Ride4Input {
      return input;
    },
    setSuspension,

    reset(path: PathState): void {
      roadInputs(path);
      bodyInputs(path);
      input.roadRate.fill(0);
      roadPrev.set(input.road);
      lean.reset(path.ay, G / Math.sqrt(1 + path.grade * path.grade), path.bank, path.v, path.curvature);
      ride.reset(input);
      quiet.fill(HYSTERESIS);
      derive(path, 0, undefined);
      cur[ENDS + SPIN] = 0;
      cur[ENDS + STRIDE + SPIN] = 0;
      prev.set(cur);
    },

    step(dt: number, path: PathState, events: SimEvent[]): void {
      prev.set(cur);
      roadInputs(path);
      for (let i = 0; i < 2; i++) {
        input.roadRate[i] = (input.road[i]! - roadPrev[i]!) / dt;
        roadPrev[i] = input.road[i]!;
      }
      bodyInputs(path);
      lean.step(dt, path.ay, G / Math.sqrt(1 + path.grade * path.grade), path.bank, path.v, path.curvature);
      ride.step(dt, input);
      derive(path, dt, events);
    },

    sample(alpha: number, amplification: number, path: PathState, out: TelemetryFrame): void {
      for (let k = 0; k < RECORD; k++) smp[k] = prev[k]! + (cur[k]! - prev[k]!) * alpha;
      const amp = amplification;
      out.heave = smp[HEAVE]!;
      out.pitch = smp[PITCH]!;
      out.roll = smp[ROLL]!;
      out.steer = smp[STEER_R]!;
      out.trail = smp[TRAIL]!;
      out.wheelbase = smp[WB]!;
      out.amplification = amp;
      plane[5] = smp[STEER_R]!;
      poseBody(path, smp[PITCH]! * amp, smp[HEAVE]! * amp, smp[ROLL]!);
      quat.toXYZW(body, out.bodyRotation);
      out.bodyPosition.x = origin[0]!;
      out.bodyPosition.y = origin[1]!;
      out.bodyPosition.z = origin[2]!;
      for (let i = 0; i < 2; i++) {
        const o = ENDS + i * STRIDE;
        const fc = out.corners[i]!;
        const t = i === 0 ? sol.tables.front : sol.tables.rear;
        const r = rows[i]!;
        fc.pointOrder = t.pointOrder;
        fc.travel = smp[o + TRAVEL]!;
        fc.travelRate = smp[o + RATE]!;
        fc.camber = smp[ROLL]!;
        fc.camberBody = 0;
        fc.toe = 0;
        fc.steer = i === 0 ? smp[STEER_R]! : 0;
        fc.load = smp[o + LOAD]!;
        fc.springForce = smp[o + SPRING]!;
        fc.damperForce = smp[o + DAMPER]!;
        fc.motionRatio = smp[o + MRATIO]!;
        fc.gripUse = smp[o + GRIP]!;
        fc.stop = smp[o + STOP]!;
        const spin0 = prev[o + SPIN]!;
        let dSpin = cur[o + SPIN]! - spin0;
        if (dSpin < -Math.PI) dSpin += TAU;
        else if (dSpin > Math.PI) dSpin -= TAU;
        const spin = spin0 + dSpin * alpha;
        fc.spin = spin < 0 ? spin + TAU : spin >= TAU ? spin - TAU : spin;

        // POSE: table at the amplified travel (clamped by the table).
        t.sample(fc.travel * amp, r);
        const steer = i === 0 ? plane[5]! : 0;
        writePoints(i, r, steer, fc.points);
        const wk = 3 * t.pointOrder.indexOf('axle');
        fc.wheelPosition.x = fc.points[wk]!;
        fc.wheelPosition.y = fc.points[wk + 1]!;
        fc.wheelPosition.z = fc.points[wk + 2]!;
        if (i === 0) {
          quat.fromAxisAngle(qb, vec(r[DX]!, 0, r[DZ]!), steer);
          quat.multiply(qa, body, qb);
        } else quat.copy(qa, body);
        quat.toXYZW(qa, fc.wheelRotation);
        // Leaned tyre: crown centre (R − ρ) below the wheel centre in the wheel plane, contact ρ − deflection below it.
        quat.rotate(v3, qa, vec(0, 0, -(tyres[i]!.radius - crowns[i]!)));
        const lift = crowns[i]! - smp[o + DEFL]!;
        fc.contactPatch.x = fc.wheelPosition.x + v3[0] - lift * nRoad[0]!;
        fc.contactPatch.y = fc.wheelPosition.y + v3[1] - lift * nRoad[1]!;
        fc.contactPatch.z = fc.wheelPosition.z + v3[2] - lift * nRoad[2]!;
        const ck = 3 * t.pointOrder.indexOf('contactPatch');
        fc.points[ck] = fc.contactPatch.x;
        fc.points[ck + 1] = fc.contactPatch.y;
        fc.points[ck + 2] = fc.contactPatch.z;
        toWorld(r[ICX]!, 0, r[ICZ]!);
        fc.instantCentre.x = pt[0]!;
        fc.instantCentre.y = pt[1]!;
        fc.instantCentre.z = pt[2]!;
        fc.springLength = r[LEN]!;
        const axle = out.axles[i]!;
        axle.rollCentreHeight = NaN;
        axle.antiPitch = smp[ANTI + i]!;
      }
    },

    restPose(cornerIndex: number, _path: PathState, out: Float64Array): Float64Array {
      const i = cornerIndex;
      const t = i === 0 ? sol.tables.front : sol.tables.rear;
      const r = rows[i]!;
      t.sample(0, r);
      writePoints(i, r, i === 0 ? plane[5]! : 0, out);
      return out;
    },
  };
}
