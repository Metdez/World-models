/**
 * VehiclePlant (ARCHITECTURE-M2 §7.2, v0 items): the SAME car driven freely. Planar X, Y, yaw (unit heading vector)
 * + the car model's unchanged 7-DOF ride model + 4 wheel spins + contact-patch deflections, at SIM_DT, using the car
 * model's tables, ride model, contact-patch layout and derive/pose code through a `CarCore` (car/car-model.ts).
 * Suspension type reaches the plant only through those tables and the per-type extras (no per-type constant).
 *
 * Per step (binding order, §7.2): steering actuator -> corner kinematics at the current travel -> ground under each
 * wheel and the base plane -> loads (previous ride step: explicit coupling) -> wheel-frame velocities -> powertrain
 * and brakes -> tyres + implicit spin (two evaluations per wheel) -> chassis (semi-implicit Euler, sleep before the
 * position update) -> ride coupling (8 Hz low-passed tyre specific forces) -> derive -> CG projection, zone and
 * bounds -> finite check (restore the newest good snapshot) and hard clamps.
 * 09-04: brakes -> aids (stability, ABS, throttle scale) -> powertrain; compliance toe/camber from the previous step's
 * tyre forces (§7.5 runtime: filtered, clamped); jacking / geometric transfer along each wheel's front-view IC line
 * (§7.6, RideInput.linkVertical); the full tyre body is 09-01's.
 *
 * Snapshot layout (PLANT_SNAPSHOT_LENGTH doubles): [0, STATE) plant state (offsets below), then roadPrev (4),
 * ride ax/ay low-pass (2), the ride model's q and v (14), the powertrain state (7), the aids state (9).
 * Determinism: + - * / sqrt and det kernels only; TRUE drive fields are computed here (POSE trig is car-model's).
 */
import type { DriveAids, DriveEvent, DriveFrame } from '../../contracts/drive';
import type { PathState, SimEvent } from '../../contracts/sim';
import type { TelemetryFrame } from '../../contracts/telemetry';
import type { BuiltTrack, TrackSample } from '../../contracts/track';
import { G, SIM_DT } from '../../contracts/units';
import type { CarDefinition, CarHandling, TyreParams } from '../../contracts/vehicle';
import { SURFACES, type Frenet, type GroundHit, type GroundWorld, type SurfaceKind } from '../../contracts/world';
import type { AxleLinkage } from '../../contracts/suspension';
import type { CornerSolution, KinematicsTable } from '../kinematics/table';
import { datan, datan2, dcos, dexp, dsin, dwrapPi } from '../math/det';
import { RIDE_STATE_LENGTH, type RideInput, type RideModel } from '../ride/ride7dof';
import { LOOP_CORRIDOR, OUT_OF_BOUNDS } from '../world/ground';
import { AIDS_STATE_LENGTH, createAids, createAidsIo, peakSlipRatio } from './aids';
import { deriveCompliance } from './compliance';
import { faultEvent, outOfBoundsEvent, zoneEvent } from './events';
import { brakeTorques, createPowertrain, createPowertrainIo, POWERTRAIN_STATE_LENGTH } from './powertrain';
import { createTyreIo, evaluateTyre, limitDeflection, stiffnessAt, tyreCoefficients, type TyreCoefficients, type TyreIo } from './tyre';
import type { DriveCommand, PlantView } from './types';

/** Surface kinds by index (car-model stores the index per wheel). */
export const SURFACE_KINDS = Object.keys(SURFACES) as readonly SurfaceKind[];

/** Per-corner tyre values the plant hands to the car model's derive (wheel frame). */
export interface PlantTyreOut {
  readonly fx: Float64Array;
  readonly fy: Float64Array;
  readonly capacity: Float64Array;
  readonly omega: Float64Array;
  readonly slipAngle: Float64Array;
  readonly slipRatio: Float64Array;
  readonly surface: Uint8Array;
}

/** What the car model hands the plant (ARCH-M2 §7.3 (5)). Getters: install() replaces tables and the ride model. */
export interface CarCore {
  readonly vehicle: CarDefinition;
  readonly handling: CarHandling;
  readonly track: BuiltTrack;
  readonly world: GroundWorld;
  /** Contact-patch layout (vehicle frame, design) and unsprung masses of the installed suspension. */
  readonly cx: Float64Array;
  readonly cy: Float64Array;
  readonly unsprung: Float64Array;
  /** Wheel rates of the installed suspension's ride corners, N/m. */
  readonly wheelRates: Float64Array;
  tables(): readonly [KinematicsTable, KinematicsTable];
  /** Linkages of the installed suspension (compliance derivation). */
  linkages(): readonly [AxleLinkage, AxleLinkage];
  corner(i: number): CornerSolution;
  ride(): RideModel;
  readonly input: RideInput;
  readonly roadPrev: Float64Array;
  /** [rack, dt] of the car model. */
  readonly scalar: Float64Array;
  staticDeflectionMean(): number;
  /** input.antiPitch from the sign of input.ax, input.rcHeight from the current travel (car-model bodyInputs/rcInputs). */
  linkInputs(): void;
  /**
   * Latch back to Auto at `path` (§7.10 C): refit the Auto reference plane (refZ, refSlope) so the Auto road inputs at
   * `path` match the current (plant) road inputs per axle; roadPrev = those Auto inputs. Ride state untouched.
   */
  rebase(path: PathState): void;
  /** Ride record: prev = cur (start of a step) / after a cut (no interpolation across it). */
  beginStep(): void;
  holdRecord(): void;
  derive(dt: number, events: SimEvent[] | undefined, tyre: PlantTyreOut): void;
  resetEventHysteresis(): void;
  /** Interpolated ride record; writes [heave, roll, pitch] into `out`. */
  interpolate(alpha: number, out: Float64Array): void;
  /** Body pose = Rz(yaw) Ry(planePitch) Rx(planeRoll) * Rx(relRoll) Ry(relPitch) at (x, y, z); writes out.body*. */
  writeBody(out: TelemetryFrame, planeRoll: number, planePitch: number, yaw: number, relRoll: number, relPitch: number, x: number, y: number, z: number): void;
  writeCorners(out: TelemetryFrame, alpha: number, amp: number, roll: number): void;
}

/** Test-only simplifications for the closed-form validation (§11 T1/T2); the app never sets them. */
export interface PlantOptions {
  /** Linear tyre (f(s) = s): Fx = C_kappa(N) kappa, Fy = -C_alpha(N) tan(alpha); no saturation, camber thrust or
   *  low-speed damping. */
  readonly linearTyre?: boolean;
  /** Tyre loads at the static corner loads and corner kinematics at the design state (no load transfer, roll steer
   *  or roll camber reach the tyres; the ride model still runs). */
  readonly rigidLoads?: boolean;
}

export interface VehiclePlant {
  readonly view: PlantView;
  /** Seed from the Auto state at the end of the last step (path = that step's PathState); ride state kept. §7.10 A */
  engageFromPath(path: PathState, autoInputs: { readonly ax: number; readonly ay: number }): void;
  step(dt: number, cmd: Readonly<DriveCommand>, aids: DriveAids, simEvents: SimEvent[], driveEvents: DriveEvent[]): void;
  /** Interpolated TRUE + POSE write incl. frame.drive plant fields (mode/source/aids/idle/detached: the control). */
  sample(alpha: number, amplification: number, out: TelemetryFrame): void;
  /** Hand the body back to the Auto model at `path` (§7.10 C): ride kept, Auto reference plane refitted. */
  releaseToPath(path: PathState): void;
  /** At rest at (x, y, heading) on the ground: velocities 0, deflections 0, ride at static equilibrium there. */
  place(x: number, y: number, heading: number): void;
  snapshot(out: Float64Array): Float64Array;
  restore(snapshot: Float64Array): void;
  /** CG projection: arc length and offset when within the loop corridor (else NaN), zone id. */
  readonly loopS: number;
  readonly loopL: number;
  readonly zone: string;
  readonly faults: number;
  readonly gear: number;
  readonly engineRpm: number;
  readonly tractionActive: boolean;
  readonly absActive: boolean;
  readonly stabilityActive: boolean;
  readonly approximate: boolean;
  /** Applied (post-conditioning) command of the last step. */
  readonly command: Readonly<DriveCommand>;
  /**
   * Validation read-out of the last step: road-wheel angle per wheel (4, rad, vehicle frame, + left; kinematics +
   * compliance), compliance toe (4, rad, + toe-in), compliance camber (4, rad, + top outboard).
   */
  wheelAngles(out: Float64Array): Float64Array;
}

// ---- plant state offsets
const X = 0;
const Y = 1;
const C = 2;
const S = 3;
const U = 4;
const V = 5;
const R = 6;
const OMEGA = 7; // 4
const UX = 11; // 4
const UY = 15; // 4
const DELTA = 19;
const OFF = 20; // 4: road-input fade offsets
const FADE = 24; // remaining fade time
const HINT = 25; // 4: wheel loop s hints
const CG_S = 29; // CG loop s hint
const OUT_T = 30;
const OUT_D = 31;
const TOEC = 32; // 4: compliance toe (filtered), rad, + toe-in
const CAMC = 36; // 4: compliance camber (filtered), rad, + top outboard
const FYLP = 40; // 4: vehicle-frame lateral tyre force per wheel, 8 Hz low-pass (jacking)
const STATE = 44;
const EXTRA = 4 + 2 + RIDE_STATE_LENGTH + POWERTRAIN_STATE_LENGTH + AIDS_STATE_LENGTH;
export const PLANT_SNAPSHOT_LENGTH = STATE + EXTRA;

// ---- interpolation record
const RX = 0;
const RY = 1;
const RC = 2;
const RS = 3;
const RZ = 4; // base plane height at the CG
const RG = 5; // base plane slope dz/dx
const RCC = 6; // base plane slope dz/dy
const ROFF = 7; // road-input offset plane: height, x slope, y slope
const ROFFG = 8;
const ROFFC = 9;
const RVC = 10; // vertical-curve plane under the axles: height, slope
const RVCS = 11;
const RU = 12;
const RV = 13;
const RR = 14;
const RAX = 15;
const RAY = 16;
const RDELTA = 17;
const RECORD = 18;

const HANDOFF_FADE_S = 1.0;
const ENVELOPE = 0.1;
const RHO_AIR = 1.225;
/** Ride inputs: 8 Hz first-order low-pass of the tyres' specific forces. */
const LP_ALPHA = 1 - dexp(-2 * Math.PI * 8 * SIM_DT);
const OOB_TIME = 1.5;
const OOB_DISTANCE = 30;
const RING = 8;
const RING_EVERY = 24;
const MAX_OMEGA = 400;
const MAX_SPEED = 120;
const MAX_YAW_RATE = 6;
const MAX_DEFLECTION = 0.5;
/** |roll|, |pitch| beyond which the ride state counts as a fault (the ride model is small-angle), rad. */
const MAX_BODY_ANGLE = 0.5;
const SLEEP_V = 0.05;
const SLEEP_R = 0.02;
const SLEEP_SLOPE = 0.005;
/** |IC line slope| clamp for the jacking term (IC near the patch), §7.6. */
const MAX_JACK_SLOPE = 1.5;

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

export function createPlant(core: CarCore, options: PlantOptions = {}): VehiclePlant {
  const vehicle = core.vehicle;
  const handling = core.handling;
  const track = core.track;
  const world = core.world;
  const side = [1, -1, 1, -1] as const;
  const axle = (i: number) => (i < 2 ? vehicle.front : vehicle.rear);
  if (vehicle.front.driven === vehicle.rear.driven) throw new Error(`plant: "${vehicle.id}" must drive exactly one axle`);
  const drivenFirst = vehicle.rear.driven ? 2 : 0;
  const radius = Float64Array.from([0, 1, 2, 3], (i) => axle(i).tyre.radius);
  const wheelInertia = Float64Array.from([0, 1, 2, 3], (i) => (i < 2 ? handling.tyres.front : handling.tyres.rear).wheelInertia);
  const coeff = [tyreCoefficients(vehicle.front.tyre, handling.tyres.front), tyreCoefficients(vehicle.rear.tyre, handling.tyres.rear)] as const;
  const drivenTyre = drivenFirst === 2 ? 'rear' : 'front';
  const powertrain = createPowertrain(handling.powertrain, radius[drivenFirst]!, wheelInertia[drivenFirst]!, peakSlipRatio(vehicle[drivenTyre].tyre, handling.tyres[drivenTyre]));
  const pio = createPowertrainIo();
  const aidsModel = createAids(vehicle, core.cy[0]! - core.cy[1]!, core.cy[2]! - core.cy[3]!);
  const aio = createAidsIo();
  const linearTyre = options.linearTyre === true;
  const rigidLoads = options.rigidLoads === true;
  // ---- compliance (§7.5 runtime): coefficients derived once per installed suspension (tables identity)
  const maxAngle = handling.compliance.maxAngle;
  const complianceOn = maxAngle > 0;
  const complianceTau = handling.compliance.filter;
  const comp = new Float64Array(8); // per axle: fyToe, fyCamber, fxToeBrake, fxToeDrive
  const compKey: (KinematicsTable | null)[] = [null, null];
  const lateralLimit = 0.9 * vehicle.front.tyre.mu * G;
  const lag = handling.steering.lag;
  const rate = handling.steering.rate;

  const st = new Float64Array(STATE);
  const cur = new Float64Array(RECORD);
  const prev = new Float64Array(RECORD);
  const rec = new Float64Array(RECORD);
  const rideOut = new Float64Array(3);
  // per wheel scratch
  const tio: TyreIo[] = [createTyreIo(), createTyreIo(), createTyreIo(), createTyreIo()];
  const delta = new Float64Array(4);
  const h = new Float64Array(4);
  const base = new Float64Array(4);
  const vc = new Float64Array(4);
  const vwx = new Float64Array(4);
  const vwy = new Float64Array(4);
  const cosD = new Float64Array(4);
  const sinD = new Float64Array(4);
  const tyre: PlantTyreOut = {
    fx: new Float64Array(4),
    fy: new Float64Array(4),
    capacity: new Float64Array(4),
    omega: new Float64Array(4),
    slipAngle: new Float64Array(4),
    slipRatio: new Float64Array(4),
    surface: new Uint8Array(4),
  };
  const plane = new Float64Array(3); // z0, g, c
  const hit: GroundHit = { h: 0, base: 0, surface: 'asphalt', zone: 'loop', s: 0, l: 0 };
  const fr: Frenet = { s: 0, l: 0, heading: 0, curvature: 0, converged: true };
  const ts: TrackSample = { s: 0, x: 0, y: 0, z: 0, heading: 0, curvature: 0, bank: 0, grade: 0 };
  const cmdOut: DriveCommand = { steer: 0, throttle: 0, brake: 0, handbrake: 0, direction: 1 };
  const ring = Array.from({ length: RING }, () => new Float64Array(PLANT_SNAPSHOT_LENGTH));
  const ringState = new Int32Array(3); // [count, next, steps]
  const flags = new Uint8Array(5); // [tractionActive, approximate, out-of-bounds fired, absActive, stabilityActive]
  const jackSlope = new Float64Array(4); // front-view IC line slope per wheel (jacking), right corners mirrored
  const fyvW = new Float64Array(4); // this step's vehicle-frame lateral tyre force per wheel
  const linkVertical = new Float64Array(4);
  const stiffL = new Float64Array(3);
  // The plant's own ride input: the car model's arrays plus linkVertical (the Auto input object never carries it).
  const pinput: RideInput = {
    ax: 0,
    ay: 0,
    road: core.input.road,
    roadRate: core.input.roadRate,
    rcHeight: core.input.rcHeight,
    antiPitch: core.input.antiPitch,
    linkVertical,
  };
  const scal = new Float64Array(6); // [loopS, loopL, faults, ax, ay, beta]
  const swellA = track.def.swell.amplitude;
  const swellK = (2 * Math.PI * track.def.swell.cycles) / track.length;
  let zone = 'loop';

  const view = {
    get x() {
      return st[X]!;
    },
    get y() {
      return st[Y]!;
    },
    get cosYaw() {
      return st[C]!;
    },
    get sinYaw() {
      return st[S]!;
    },
    get u() {
      return st[U]!;
    },
    get v() {
      return st[V]!;
    },
    get r() {
      return st[R]!;
    },
    get steer() {
      return st[DELTA]!;
    },
    get beta() {
      return scal[5]!;
    },
    wheelbase: vehicle.wheelbase,
    maxSteer: vehicle.maxSteer,
    lateralLimit,
    simTime: 0,
  } satisfies PlantView & { simTime: number };

  const mass = (): number => vehicle.sprungMass + core.unsprung[0]! + core.unsprung[1]! + core.unsprung[2]! + core.unsprung[3]!;
  function yawInertia(): number {
    let iz = vehicle.inertia.yaw;
    for (let i = 0; i < 4; i++) iz += core.unsprung[i]! * (core.cx[i]! * core.cx[i]! + core.cy[i]! * core.cy[i]!);
    return iz;
  }

  /**
   * Ground under each wheel at the current pose (3-point envelope along the road on the corridor, as M1), base plane
   * fit, vertical-curve plane; returns road inputs WITHOUT the fade offsets into core.input.road.
   */
  function ground(): void {
    const c = st[C]!;
    const sn = st[S]!;
    const cx = core.cx;
    const cy = core.cy;
    // During the handoff fade the wheels' road coordinates blend from the Auto model's Frenet offsets of the CG point
    // (car-model roadInputs) to their exact projections, so the first plant steps read the road exactly where Auto did.
    const fade = st[FADE]! / HANDOFF_FADE_S;
    let cd = 0;
    let sd = 0;
    if (fade > 0) {
      world.project(st[X]!, st[Y]!, st[CG_S]!, fr);
      const ch = dcos(fr.heading);
      const sh = dsin(fr.heading);
      cd = c * ch + sn * sh; // cos(yaw - road heading)
      sd = sn * ch - c * sh;
    }
    for (let i = 0; i < 4; i++) {
      const wx = st[X]! + c * cx[i]! - sn * cy[i]!;
      const wy = st[Y]! + sn * cx[i]! + c * cy[i]!;
      world.sample(wx, wy, st[HINT + i]!, hit);
      tyre.surface[i] = SURFACE_KINDS.indexOf(hit.surface);
      base[i] = hit.base;
      let sw = hit.s;
      if (sw === sw) {
        st[HINT + i] = sw;
        let l = hit.l;
        if (fade > 0 && Math.abs(fr.l) <= LOOP_CORRIDOR) {
          let dS = fr.s + cx[i]! * cd - cy[i]! * sd - sw;
          const half = track.length / 2;
          dS = dS > half ? dS - track.length : dS < -half ? dS + track.length : dS;
          sw += fade * dS;
          l += fade * (fr.l + cx[i]! * sd + cy[i]! * cd - l);
        }
        // The M1 tyre envelope (mean road height at +-ENVELOPE along the road) where no terrain blend applies.
        h[i] = Math.abs(l) <= LOOP_CORRIDOR - 0.5 ? (track.roadHeight(sw - ENVELOPE, l) + track.roadHeight(sw, l) + track.roadHeight(sw + ENVELOPE, l)) / 3 : hit.h;
        track.sample(sw, ts);
        vc[i] = ts.z - swellA * dsin(swellK * sw);
      } else {
        // off the corridor (the ground is a function of (x, y) alone since 09-04: the hint only has to stay finite
        // for the state's finite check)
        if (st[HINT + i] !== st[HINT + i]) st[HINT + i] = 0;
        h[i] = hit.h;
        vc[i] = 0;
      }
    }
    const xF = (cx[0]! + cx[1]!) / 2;
    const xR = (cx[2]! + cx[3]!) / 2;
    const bF = (base[0]! + base[1]!) / 2;
    const bR = (base[2]! + base[3]!) / 2;
    const g = (bF - bR) / (xF - xR);
    const cc = ((base[0]! - base[1]!) / (cy[0]! - cy[1]!) + (base[2]! - base[3]!) / (cy[2]! - cy[3]!)) / 2;
    plane[0] = (bF + bR) / 2 - (g * (xF + xR)) / 2;
    plane[1] = g;
    plane[2] = cc;
    for (let i = 0; i < 4; i++) core.input.road[i] = h[i]! - (plane[0]! + g * cx[i]! + cc * cy[i]!);
    const vcF = (vc[0]! + vc[1]!) / 2;
    const vcR = (vc[2]! + vc[3]!) / 2;
    cur[RVCS] = (vcF - vcR) / (xF - xR);
    cur[RVC] = vcR - cur[RVCS]! * xR;
    cur[RZ] = plane[0]!;
    cur[RG] = g;
    cur[RCC] = cc;
  }

  /** Fade offsets at the current FADE into road inputs; record the offset plane. */
  function applyOffsets(dt: number): void {
    const f = st[FADE]! > 0 ? st[FADE]! / HANDOFF_FADE_S : 0;
    st[FADE] = Math.max(0, st[FADE]! - dt);
    const cx = core.cx;
    const cy = core.cy;
    for (let i = 0; i < 4; i++) core.input.road[i] = core.input.road[i]! - st[OFF + i]! * f;
    const oF = ((st[OFF]! + st[OFF + 1]!) / 2) * f;
    const oR = ((st[OFF + 2]! + st[OFF + 3]!) / 2) * f;
    const xF = (cx[0]! + cx[1]!) / 2;
    const xR = (cx[2]! + cx[3]!) / 2;
    cur[ROFFG] = (oF - oR) / (xF - xR);
    cur[ROFF] = (oF + oR) / 2 - (cur[ROFFG]! * (xF + xR)) / 2;
    cur[ROFFC] = (((st[OFF]! - st[OFF + 1]!) / (cy[0]! - cy[1]!) + (st[OFF + 2]! - st[OFF + 3]!) / (cy[2]! - cy[3]!)) / 2) * f;
  }

  /** CG projection, zone and bounds (step 12). */
  function locate(dt: number, events: DriveEvent[] | null): void {
    world.project(st[X]!, st[Y]!, st[CG_S]!, fr);
    st[CG_S] = fr.s;
    const inside = Math.abs(fr.l) <= LOOP_CORRIDOR;
    scal[0] = inside ? fr.s : NaN;
    scal[1] = inside ? fr.l : NaN;
    const z = inside ? 'loop' : 'terrain';
    if (z !== zone) {
      if (events) {
        events.push(zoneEvent(view.simTime, zone, false));
        events.push(zoneEvent(view.simTime, z, true));
      }
      zone = z;
    }
    if (Math.abs(fr.l) > OUT_OF_BOUNDS) {
      st[OUT_T] = st[OUT_T]! + dt;
      st[OUT_D] = st[OUT_D]! + dt * Math.sqrt(st[U]! * st[U]! + st[V]! * st[V]!);
      if (!flags[2] && (st[OUT_T]! >= OOB_TIME || st[OUT_D]! >= OOB_DISTANCE)) {
        flags[2] = 1;
        events?.push(outOfBoundsEvent(view.simTime));
      }
    } else {
      st[OUT_T] = 0;
      st[OUT_D] = 0;
      flags[2] = 0;
    }
  }

  function recordState(): void {
    cur[RX] = st[X]!;
    cur[RY] = st[Y]!;
    cur[RC] = st[C]!;
    cur[RS] = st[S]!;
    cur[RU] = st[U]!;
    cur[RV] = st[V]!;
    cur[RR] = st[R]!;
    cur[RDELTA] = st[DELTA]!;
    const u = st[U]!;
    scal[5] = Math.abs(u) < 1 && Math.abs(st[V]!) < 1 ? 0 : datan2(st[V]!, Math.abs(u));
  }

  /**
   * Corner kinematics at the current travel and actuator (step 2-3 tail): wheel steer and inclination incl. the
   * compliance angles (§7.5), and each wheel's front-view IC line slope for the jacking term (§7.6).
   */
  function corners(): void {
    const tables = core.tables();
    const rack = tables[0].rackForSteer(st[DELTA]!);
    core.scalar[0] = rack;
    const ride = core.ride().state;
    for (let i = 0; i < 4; i++) {
      const cs = tables[i >> 1]!.sample(rigidLoads ? 0 : ride.travel[i]!, side[i]! * (i < 2 ? rack : 0), core.corner(i));
      // Compliance off (maxAngle 0) keeps the kinematics-only arithmetic exactly.
      const d = -side[i]! * (complianceOn ? cs.toe + st[TOEC + i]! : cs.toe);
      delta[i] = d;
      cosD[i] = dcos(d);
      sinD[i] = dsin(d);
      let gamma = cs.camber - side[i]! * (rigidLoads ? 0 : ride.roll);
      if (complianceOn) gamma += st[CAMC + i]!;
      tio[i]!.camberToRoad = gamma;
      tio[i]!.inclination = side[i]! * gamma;
      // slope of the line contact patch -> IC (AXLE frame, left side); a right corner's own sample mirrored
      let k = (cs.instantCentre.z - cs.contactPatch.z) / (cs.instantCentre.y - cs.contactPatch.y);
      k = k === k ? clamp(k, -MAX_JACK_SLOPE, MAX_JACK_SLOPE) : 0;
      jackSlope[i] = side[i]! * k;
    }
  }

  /** Compliance coefficients of the installed suspension (derived when the tables change: a suspension swap). */
  function deriveComplianceIfNeeded(): void {
    const tables = core.tables();
    if (compKey[0] === tables[0] && compKey[1] === tables[1]) return;
    const links = core.linkages();
    for (let a = 0; a < 2; a++) {
      const c = deriveCompliance(links[a]!, tables[a]!, handling.compliance.bushingRates, core.wheelRates[2 * a]!);
      comp[4 * a] = c.fyToe;
      comp[4 * a + 1] = c.fyCamber;
      comp[4 * a + 2] = c.fxToeBrake;
      comp[4 * a + 3] = c.fxToeDrive;
      compKey[a] = tables[a]!;
    }
  }

  /**
   * Compliance angles from the previous step's tyre forces (§7.5 runtime): toe = fyToe Fy_in + (Fx < 0 ? fxToeBrake :
   * fxToeDrive) Fx, camber = fyCamber Fy_in, each clamped to +-maxAngle and through a first-order filter (backward
   * Euler). Fy_in = the wheel-frame lateral force signed toward the car centre (the left-corner coefficients serve both).
   */
  function updateCompliance(dt: number): void {
    if (!complianceOn) return;
    deriveComplianceIfNeeded();
    const k = dt / (complianceTau + dt);
    for (let i = 0; i < 4; i++) {
      const o = (i >> 1) * 4;
      const fyIn = -side[i]! * tyre.fy[i]!;
      const fx = tyre.fx[i]!;
      const toe = clamp(comp[o]! * fyIn + (fx < 0 ? comp[o + 2]! : comp[o + 3]!) * fx, -maxAngle, maxAngle);
      const camber = clamp(comp[o + 1]! * fyIn, -maxAngle, maxAngle);
      st[TOEC + i] = st[TOEC + i]! + (toe - st[TOEC + i]!) * k;
      st[CAMC + i] = st[CAMC + i]! + (camber - st[CAMC + i]!) * k;
    }
  }

  /** Test-only linear tyre (PlantOptions.linearTyre). */
  function linearTyreEval(tp: TyreParams, c: TyreCoefficients, io: TyreIo): void {
    stiffnessAt(tp, c, io.load, stiffL);
    const kap = io.ux / c.sigmaX;
    const tanA = io.uy / c.sigmaY;
    io.fx = stiffL[1]! * kap;
    io.fy = -stiffL[0]! * tanA;
    io.capacity = stiffL[2]!;
    io.slipAngle = tanA;
    io.slipRatio = kap;
    io.slopeX = stiffL[1]! / c.sigmaX;
    io.dampX = 0;
  }

  /** Static corner load (lever rule, sprung + unsprung), N: PlantOptions.rigidLoads. */
  function staticLoad(i: number): number {
    const xF = (core.cx[0]! + core.cx[1]!) / 2;
    const xR = (core.cx[2]! + core.cx[3]!) / 2;
    return ((vehicle.sprungMass * (i < 2 ? -xR : xF)) / (xF - xR) / 2 + core.unsprung[i]!) * G;
  }

  /** Seed of the jacking low-pass at an engage: the Auto's lateral specific force split by axle and corner load. */
  function seedLateral(): void {
    const cx = core.cx;
    const load = core.ride().state.load;
    const xF = (cx[0]! + cx[1]!) / 2;
    const xR = (cx[2]! + cx[3]!) / 2;
    const f = mass() * core.input.ay;
    for (let i = 0; i < 4; i++) {
      const axleLoad = load[i]! + load[i ^ 1]!;
      st[FYLP + i] = (f * (i < 2 ? -xR : xF)) / (xF - xR) * (axleLoad > 0 ? load[i]! / axleLoad : 0.5);
    }
  }

  function zeroMotion(): void {
    st[U] = 0;
    st[V] = 0;
    st[R] = 0;
    for (let i = 0; i < 4; i++) {
      st[OMEGA + i] = 0;
      st[UX + i] = 0;
      st[UY + i] = 0;
    }
  }

  const snap = new Float64Array(PLANT_SNAPSHOT_LENGTH);
  function snapshot(out: Float64Array): Float64Array {
    out.set(st, 0);
    out.set(core.roadPrev, STATE);
    out[STATE + 4] = core.input.ax;
    out[STATE + 5] = core.input.ay;
    core.ride().exportState(out, STATE + 6);
    out.set(powertrain.state, STATE + 6 + RIDE_STATE_LENGTH);
    out.set(aidsModel.state, STATE + 6 + RIDE_STATE_LENGTH + POWERTRAIN_STATE_LENGTH);
    return out;
  }
  function restore(src: Float64Array): void {
    for (let k = 0; k < STATE; k++) st[k] = src[k]!;
    for (let i = 0; i < 4; i++) core.roadPrev[i] = src[STATE + i]!;
    core.input.ax = src[STATE + 4]!;
    core.input.ay = src[STATE + 5]!;
    for (let k = 0; k < POWERTRAIN_STATE_LENGTH; k++) powertrain.state[k] = src[STATE + 6 + RIDE_STATE_LENGTH + k]!;
    for (let k = 0; k < AIDS_STATE_LENGTH; k++) aidsModel.state[k] = src[STATE + 6 + RIDE_STATE_LENGTH + POWERTRAIN_STATE_LENGTH + k]!;
    corners();
    ground();
    applyOffsets(0);
    core.ride().importState(src, core.input, STATE + 6);
    core.linkInputs();
    recordState();
  }
  function pushRing(): void {
    snapshot(ring[ringState[1]!]!);
    ringState[1] = (ringState[1]! + 1) % RING;
    ringState[0] = Math.min(RING, ringState[0]! + 1);
  }
  function startRing(): void {
    ringState[0] = 0;
    ringState[1] = 0;
    ringState[2] = 0;
    pushRing();
  }

  /** Common tail of engage/place/restore: tyre outputs, derive, record without interpolation across the cut. */
  function settle(): void {
    for (let i = 0; i < 4; i++) {
      tyre.fx[i] = 0;
      tyre.fy[i] = 0;
      tyre.omega[i] = st[OMEGA + i]!;
      tyre.slipAngle[i] = 0;
      tyre.slipRatio[i] = 0;
      tyre.capacity[i] = 0;
    }
    core.derive(0, undefined, tyre);
    core.holdRecord();
    recordState();
    // the faulted step may have written non-finite specific forces into the record
    scal[3] = 0;
    scal[4] = 0;
    cur[RAX] = 0;
    cur[RAY] = 0;
    prev.set(cur);
    locate(0, null);
    startRing();
  }

  function isFinite(): boolean {
    let sum = 0;
    for (let k = 0; k < STATE; k++) sum += st[k]!;
    const r = core.ride().state;
    sum += r.heave + r.roll + r.pitch + r.heaveRate + r.rollRate + r.pitchRate;
    for (let i = 0; i < 4; i++) sum += r.travel[i]! + r.load[i]!;
    // 10-01: a body rolled/pitched beyond the small-angle ride model (a tripped slide down an embankment) diverges while
    // staying finite for seconds: treat it as a fault too.
    return sum - sum === 0 && Math.abs(r.roll) < MAX_BODY_ANGLE && Math.abs(r.pitch) < MAX_BODY_ANGLE;
  }

  function recover(driveEvents: DriveEvent[]): void {
    const n = ringState[0]!;
    // The newest snapshot may already hold the diverging state: take the one before it when there is one.
    const k = (ringState[1]! - (n > 1 ? 2 : 1) + RING) % RING;
    snap.set(ring[k]!);
    // zero velocities and deflections of the restored state (plant and ride)
    snap[U] = 0;
    snap[V] = 0;
    snap[R] = 0;
    for (let i = 0; i < 4; i++) {
      snap[OMEGA + i] = 0;
      snap[UX + i] = 0;
      snap[UY + i] = 0;
    }
    for (let j = 0; j < 7; j++) snap[STATE + 6 + 7 + j] = 0;
    restore(snap);
    scal[2] = scal[2]! + 1;
    core.beginStep();
    settle();
    driveEvents.push(faultEvent(view.simTime, scal[2]!));
  }

  const stiff = new Float64Array(3);
  /**
   * Engage seed (research m2/09 §5): instead of v = 0, Ackermann steer and zero deflections (§7.10 A), the linear
   * steady state of THIS plant for the Auto state: axle lateral forces m*ay split by moment balance give the axle slip
   * angles, hence the sideslip v and the actuator steer; patch deflections and wheel spins at their steady state for
   * the Auto's per-wheel demands. With zero deflections the tyres would carry no force for the first ~30 ms (a 6 %
   * load step in the carousel).
   */
  function seedSteadyState(): void {
    const cx = core.cx;
    const cy = core.cy;
    const ride = core.ride().state;
    const u = st[U]!;
    const r = st[R]!;
    const m = mass();
    const xF = (cx[0]! + cx[1]!) / 2;
    const xR = (cx[2]! + cx[3]!) / 2;
    const fyF = (m * core.input.ay * -xR) / (xF - xR);
    const fyR = (m * core.input.ay * xF) / (xF - xR);
    let caF = 0;
    let caR = 0;
    let dF = 0;
    let dR = 0;
    for (let i = 0; i < 4; i++) {
      stiffnessAt(axle(i).tyre, i < 2 ? coeff[0] : coeff[1], ride.load[i]!, stiff);
      if (i < 2) {
        caF += stiff[0]!;
        dF += stiff[2]!;
      } else {
        caR += stiff[0]!;
        dR += stiff[2]!;
      }
    }
    if (!(caF > 0 && caR > 0)) return;
    // tan(alpha) = -Fy / C_alpha, kept inside the linear range (90 % of the saturation slip)
    const tanR = clamp(-fyR / caR, (-0.9 * dR) / caR, (0.9 * dR) / caR);
    const tanF = clamp(-fyF / caF, (-0.9 * dF) / caF, (0.9 * dF) / caF);
    const v = u * tanR - r * xR;
    st[V] = v;
    // The actuator stays at the Auto (Ackermann) steer: a jump to the steady-state steer would show. The front patch
    // deflections below carry the steady-state force instead and relax onto the kinematics within sigma / u.
    const tanFk = (v + r * xF) / u - st[DELTA]!;
    corners();
    // longitudinal demand split as car-model derive does (braking by brakeShare, driving on the driven axle)
    const fx = m * core.input.ax;
    for (let i = 0; i < 4; i++) {
      const vx = u - r * cy[i]!;
      const vy = v + r * cx[i]!;
      const wx = vx * cosD[i]! + vy * sinD[i]!;
      const wy = -vx * sinD[i]! + vy * cosD[i]!;
      const c = i < 2 ? coeff[0] : coeff[1];
      const load = ride.load[i]!;
      stiffnessAt(axle(i).tyre, c, load, stiff);
      const axleLoad = load + ride.load[i ^ 1]!;
      const share = axleLoad > 0 ? load / axleLoad : 0;
      const fxAxle = fx < 0 ? fx * axle(i).brakeShare : axle(i).driven ? fx : 0;
      const kap = stiff[1]! > 0 ? clamp((fxAxle * share) / stiff[1]!, (-0.9 * stiff[2]!) / stiff[1]!, (0.9 * stiff[2]!) / stiff[1]!) : 0;
      // rear: kinematic steady state; front: the steady-state force (tanF) for the actual steer's kinematic slip tanFk
      st[UY + i] = c.sigmaY * (i < 2 ? wy / Math.abs(wx) - tanFk + tanF : wy / Math.abs(wx));
      st[UX + i] = c.sigmaX * kap;
      st[OMEGA + i] = (wx * (1 + kap)) / radius[i]!;
    }
  }

  const plant: VehiclePlant = {
    view,
    get loopS() {
      return scal[0]!;
    },
    get loopL() {
      return scal[1]!;
    },
    get zone() {
      return zone;
    },
    get faults() {
      return scal[2]!;
    },
    get gear() {
      return pio.gear;
    },
    get engineRpm() {
      return pio.engineRpm;
    },
    get tractionActive() {
      return flags[0] === 1;
    },
    get absActive() {
      return flags[3] === 1;
    },
    get stabilityActive() {
      return flags[4] === 1;
    },
    get approximate() {
      return flags[1] === 1;
    },
    command: cmdOut,
    wheelAngles(out) {
      for (let i = 0; i < 4; i++) {
        out[i] = delta[i]!;
        out[4 + i] = st[TOEC + i]!;
        out[8 + i] = st[CAMC + i]!;
      }
      return out;
    },

    engageFromPath(path, autoInputs) {
      const L = vehicle.wheelbase;
      st[X] = path.x;
      st[Y] = path.y;
      st[C] = dcos(path.heading);
      st[S] = dsin(path.heading);
      st[U] = path.v;
      st[V] = 0;
      st[R] = path.v * path.curvature;
      st[DELTA] = datan(L * path.curvature);
      for (let i = 0; i < 4; i++) {
        st[OMEGA + i] = (st[U]! - st[R]! * core.cy[i]!) / radius[i]!;
        st[UX + i] = 0;
        st[UY + i] = 0;
        st[HINT + i] = path.s;
      }
      for (let i = 0; i < 4; i++) {
        st[TOEC + i] = 0;
        st[CAMC + i] = 0;
      }
      if (path.v > 1) seedSteadyState();
      st[CG_S] = path.s;
      st[OUT_T] = 0;
      st[OUT_D] = 0;
      // NaN = keep the inputs the car model last fed to the ride (they ARE the Auto inputs).
      if (autoInputs.ax === autoInputs.ax) core.input.ax = autoInputs.ax;
      if (autoInputs.ay === autoInputs.ay) core.input.ay = autoInputs.ay;
      // Fade offsets: plant road inputs - the Auto inputs of the last step (core.input.road still holds them).
      for (let i = 0; i < 4; i++) st[OFF + i] = core.input.road[i]!;
      st[FADE] = HANDOFF_FADE_S;
      corners();
      ground();
      for (let i = 0; i < 4; i++) st[OFF + i] = core.input.road[i]! - st[OFF + i]!;
      applyOffsets(0);
      seedLateral();
      powertrain.reset(st[U]!, 1);
      aidsModel.reset();
      flags[3] = 0;
      flags[4] = 0;
      cmdOut.steer = st[DELTA]!;
      cmdOut.throttle = path.ax > 0 ? Math.min(1, path.ax / vehicle.limits.accel) : 0;
      cmdOut.brake = path.ax < 0 ? Math.min(1, -path.ax / vehicle.limits.brake) : 0;
      cmdOut.handbrake = 0;
      cmdOut.direction = 1;
      flags[2] = 0;
      zone = Math.abs(path.l) <= LOOP_CORRIDOR ? 'loop' : 'terrain';
      // The ride record keeps the last Auto step as `prev`: the first plant step interpolates from it.
      recordState();
      prev.set(cur);
      locate(0, null);
      startRing();
    },

    place(x, y, heading) {
      st[X] = x;
      st[Y] = y;
      st[C] = dcos(heading);
      st[S] = dsin(heading);
      zeroMotion();
      st[DELTA] = 0;
      for (let i = 0; i < 4; i++) {
        st[HINT + i] = NaN;
        st[OFF + i] = 0;
        st[TOEC + i] = 0;
        st[CAMC + i] = 0;
        st[FYLP + i] = 0;
      }
      st[CG_S] = NaN;
      st[FADE] = 0;
      st[OUT_T] = 0;
      st[OUT_D] = 0;
      flags[2] = 0;
      core.input.ax = 0;
      core.input.ay = 0;
      core.input.roadRate.fill(0);
      const ride = core.ride();
      // Two passes: corner kinematics depend on the travel the equilibrium produces (RC heights move by mm).
      for (let pass = 0; pass < 2; pass++) {
        corners();
        ground();
        core.linkInputs();
        try {
          ride.reset(core.input);
        } catch {
          // A rough spot can leave diagonal wheels unloaded at the solver's guess: settle on the base plane.
          core.input.road.fill(0);
          ride.reset(core.input);
          ground();
        }
      }
      core.roadPrev.set(core.input.road);
      powertrain.reset(0, 1);
      aidsModel.reset();
      flags[3] = 0;
      flags[4] = 0;
      cmdOut.steer = 0;
      cmdOut.throttle = 0;
      cmdOut.brake = 0;
      cmdOut.handbrake = 0;
      cmdOut.direction = 1;
      core.resetEventHysteresis();
      core.beginStep();
      settle();
    },

    step(dt, cmd, aids, simEvents, driveEvents) {
      core.beginStep();
      prev.set(cur);
      cmdOut.steer = cmd.steer;
      cmdOut.throttle = cmd.throttle;
      cmdOut.brake = cmd.brake;
      cmdOut.handbrake = cmd.handbrake;
      cmdOut.direction = cmd.direction;
      const input = core.input;
      const ride = core.ride();
      const cx = core.cx;
      const cy = core.cy;

      // 2. steering actuator (first-order lag + rate limit)
      const lim = rate * dt;
      st[DELTA] = st[DELTA]! + clamp(((cmd.steer - st[DELTA]!) * dt) / lag, -lim, lim);
      // 3. corner kinematics from the current ride state (compliance angles from the previous step's forces)
      updateCompliance(dt);
      corners();
      // 4. (moved after the chassis update, see there): this step's tyres and gravity use the ground of the last one.

      // 5-6. loads (previous ride step) and wheel-frame velocities
      const u0 = st[U]!;
      const v0 = st[V]!;
      const r0 = st[R]!;
      for (let i = 0; i < 4; i++) {
        const vx = u0 - r0 * cy[i]!;
        const vy = v0 + r0 * cx[i]!;
        vwx[i] = vx * cosD[i]! + vy * sinD[i]!;
        vwy[i] = -vx * sinD[i]! + vy * cosD[i]!;
        const io = tio[i]!;
        io.load = rigidLoads ? staticLoad(i) : ride.state.load[i]!;
        io.vx = vwx[i]!;
        io.vy = vwy[i]!;
        io.muScale = SURFACES[SURFACE_KINDS[tyre.surface[i]!]!].muScale;
      }

      // 7. brakes, aids (stability then ABS, on the previous step's slips), powertrain
      const bt = brakeTorques(handling.brakes, vehicle.front.brakeShare, vehicle.rear.brakeShare, cmd.brake, cmd.handbrake, aio.brakeTorque);
      for (let i = 0; i < 4; i++) aio.slipRatio[i] = tyre.slipRatio[i]!;
      aio.steerAct = st[DELTA]!;
      aio.u = u0;
      aio.r = r0;
      aio.beta = scal[5]!;
      aio.handbrake = cmd.handbrake;
      aidsModel.step(dt, aio, aids, view);
      flags[3] = aio.absActive ? 1 : 0;
      flags[4] = aio.stabilityActive ? 1 : 0;
      const dl = drivenFirst;
      pio.throttle = cmd.throttle * aio.throttleScale;
      pio.direction = cmd.direction;
      pio.speed = u0;
      pio.omegaL = st[OMEGA + dl]!;
      pio.omegaR = st[OMEGA + dl + 1]!;
      pio.driveSlip = Math.max(tyre.slipRatio[dl]!, tyre.slipRatio[dl + 1]!);
      pio.slipSpeed = Math.max(radius[dl]! * st[OMEGA + dl]! - vwx[dl]!, radius[dl + 1]! * st[OMEGA + dl + 1]! - vwx[dl + 1]!) * (cmd.direction < 0 ? -1 : 1);
      powertrain.step(dt, pio, aids);
      flags[0] = pio.tractionActive ? 1 : 0;

      // 8. tyres + implicit spin
      let sumFx = 0;
      let sumFy = 0;
      let sumMz = 0;
      let rolling = 0;
      for (let i = 0; i < 4; i++) {
        const io = tio[i]!;
        const c = i < 2 ? coeff[0] : coeff[1];
        const tp = axle(i).tyre;
        const Rw = radius[i]!;
        const driven = i === dl || i === dl + 1;
        const inertia = driven ? pio.inertia : wheelInertia[i]!;
        const td = i === dl ? pio.torqueL : i === dl + 1 ? pio.torqueR : 0;
        const tb = bt[i]!;
        const k = Math.abs(vwx[i]!);
        const denX = 1 + (dt * k) / c.sigmaX;
        const denY = 1 + (dt * k) / c.sigmaY;
        let w = st[OMEGA + i]!;
        const ux0 = st[UX + i]!;
        const uy0 = st[UY + i]!;
        if (io.load > 0) {
          // a. predicted deflections with the current spin (backward Euler on the relaxation lag)
          io.ux = (ux0 + dt * (Rw * w - vwx[i]!)) / denX;
          io.uy = (uy0 + dt * vwy[i]!) / denY;
          io.slipVx = Rw * w - vwx[i]!;
          // b. first evaluation
          if (linearTyre) linearTyreEval(tp, c, io);
          else evaluateTyre(tp, c, io);
          // c-d. implicit spin with the secant slope, then the brake (never reverses the spin)
          const dFdw = (io.slopeX * dt * Rw) / denX + io.dampX * Rw;
          const ieff = inertia + dt * Rw * dFdw;
          const free = w + (dt * (td - Rw * io.fx)) / ieff;
          const dwb = (dt * tb) / ieff;
          w = Math.abs(free) <= dwb ? 0 : free - (free > 0 ? dwb : -dwb);
          // e. final deflections and forces with the new spin
          io.ux = (ux0 + dt * (Rw * w - vwx[i]!)) / denX;
          io.slipVx = Rw * w - vwx[i]!;
          if (linearTyre) linearTyreEval(tp, c, io);
          else evaluateTyre(tp, c, io);
          tyre.slipAngle[i] = io.slipAngle;
          tyre.slipRatio[i] = io.slipRatio;
          if (!linearTyre) limitDeflection(tp, c, io);
          rolling += SURFACES[SURFACE_KINDS[tyre.surface[i]!]!].rollingResistance * io.load;
        } else {
          // airborne: free spin under drive and brake torque, deflections relax
          const free = w + (dt * td) / inertia;
          const dwb = (dt * tb) / inertia;
          w = Math.abs(free) <= dwb ? 0 : free - (free > 0 ? dwb : -dwb);
          io.ux = ux0 / (1 + 20 * dt);
          io.uy = uy0 / (1 + 20 * dt);
          io.fx = 0;
          io.fy = 0;
          io.capacity = 0;
          tyre.slipAngle[i] = 0;
          tyre.slipRatio[i] = 0;
        }
        st[OMEGA + i] = w;
        st[UX + i] = io.ux;
        st[UY + i] = io.uy;
        tyre.fx[i] = io.fx;
        tyre.fy[i] = io.fy;
        tyre.capacity[i] = io.capacity;
        tyre.omega[i] = w;
        const fxv = io.fx * cosD[i]! - io.fy * sinD[i]!;
        const fyv = io.fx * sinD[i]! + io.fy * cosD[i]!;
        sumFx += fxv;
        sumFy += fyv;
        sumMz += cx[i]! * fyv - cy[i]! * fxv;
        fyvW[i] = fyv;
      }

      // 9. chassis (semi-implicit Euler)
      const m = mass();
      const g = plane[1]!;
      const cc = plane[2]!;
      const norm = 1 / Math.sqrt(1 + g * g + cc * cc);
      const drag = 0.5 * RHO_AIR * vehicle.dragArea * u0 * Math.abs(u0);
      const rr = (rolling * u0) / Math.sqrt(u0 * u0 + 0.0025);
      let u = u0 + dt * ((sumFx - drag - rr) / m - G * g * norm + v0 * r0);
      let v = v0 + dt * (sumFy / m - G * cc * norm - u0 * r0);
      let r = r0 + (dt * sumMz) / yawInertia();
      // 14. sleep (before the position update: no creep while held). v0 addition to §7.2: rolling resistance also
      // holds the car where the slope's pull is below it (the smooth-sign regularisation would otherwise creep).
      const slope = Math.sqrt(g * g + cc * cc);
      if (
        Math.abs(u) < SLEEP_V &&
        Math.abs(v) < SLEEP_V &&
        Math.abs(r) < SLEEP_R &&
        cmd.throttle < 0.02 &&
        (cmd.brake > 0.05 || cmd.handbrake > 0.05 || slope < SLEEP_SLOPE || G * slope * m < 0.9 * rolling)
      ) {
        u = 0;
        v = 0;
        r = 0;
        for (let i = 0; i < 4; i++) st[OMEGA + i] = 0;
      }
      st[U] = clamp(u, -MAX_SPEED, MAX_SPEED);
      st[V] = clamp(v, -MAX_SPEED, MAX_SPEED);
      st[R] = clamp(r, -MAX_YAW_RATE, MAX_YAW_RATE);
      const c1 = st[C]! - st[S]! * st[R]! * dt;
      const s1 = st[S]! + st[C]! * st[R]! * dt;
      const n1 = 1 / Math.sqrt(c1 * c1 + s1 * s1);
      st[C] = c1 * n1;
      st[S] = s1 * n1;
      st[X] = st[X]! + dt * (st[U]! * st[C]! - st[V]! * st[S]!);
      st[Y] = st[Y]! + dt * (st[U]! * st[S]! + st[V]! * st[C]!);
      for (let i = 0; i < 4; i++) {
        st[OMEGA + i] = clamp(st[OMEGA + i]!, -MAX_OMEGA, MAX_OMEGA);
        st[UX + i] = clamp(st[UX + i]!, -MAX_DEFLECTION, MAX_DEFLECTION);
        st[UY + i] = clamp(st[UY + i]!, -MAX_DEFLECTION, MAX_DEFLECTION);
      }

      // 4. ground, base plane and road inputs at the NEW pose (fade offsets after an engage). Deviation from the §7.2
      // order: like the M1 Auto step (road inputs at the path state at the END of the step), so the ride sees the road
      // under the wheels where they now are and the engage step reads the same road as the Auto step would.
      ground();
      applyOffsets(dt);
      for (let i = 0; i < 4; i++) {
        input.roadRate[i] = (input.road[i]! - core.roadPrev[i]!) / dt;
        core.roadPrev[i] = input.road[i]!;
      }

      // 10. ride coupling: low-passed specific forces the tyres supply
      const ax = sumFx / m;
      const ay = sumFy / m;
      const lp = dt === SIM_DT ? LP_ALPHA : 1 - dexp(-2 * Math.PI * 8 * dt);
      input.ax += (ax - input.ax) * lp;
      input.ay += (ay - input.ay) * lp;
      scal[3] = (sumFx - drag - rr) / m;
      scal[4] = ay;
      core.linkInputs();
      // jacking / geometric transfer (§7.6): each wheel's (low-passed, sprung share of the) lateral force along its
      // front-view IC line; with equal left/right forces and lines through the RC it is the M1 roll-centre pair.
      const sprung = vehicle.sprungMass / m;
      for (let i = 0; i < 4; i++) {
        st[FYLP + i] = st[FYLP + i]! + (fyvW[i]! - st[FYLP + i]!) * lp;
        linkVertical[i] = -jackSlope[i]! * st[FYLP + i]! * sprung;
      }
      pinput.ax = input.ax;
      pinput.ay = input.ay;
      let ok = true;
      try {
        ride.step(dt, pinput);
      } catch {
        ok = false;
      }
      // 11. derive (M1 SimEvents fire inside)
      if (ok) core.derive(dt, simEvents, tyre);
      recordState();
      cur[RAX] = scal[3]!;
      cur[RAY] = scal[4]!;
      // 12. CG projection, zone, bounds
      locate(dt, driveEvents);
      // validity (DriveFrame.approximate)
      let approx = Math.abs(ay) > 0.85 * vehicle.front.tyre.mu * G || Math.abs(scal[5]!) > 0.1745;
      for (let i = 0; i < 4; i++) if (Math.abs(tyre.slipRatio[i]!) > 0.3) approx = true;
      flags[1] = approx ? 1 : 0;
      // 13. safety: finite check, last-good ring
      if (!ok || !isFinite()) {
        recover(driveEvents);
        return;
      }
      ringState[2] = ringState[2]! + 1;
      if (ringState[2]! % RING_EVERY === 0) pushRing();
    },

    sample(alpha, amplification, out) {
      for (let k = 0; k < RECORD; k++) rec[k] = prev[k]! + (cur[k]! - prev[k]!) * alpha;
      core.interpolate(alpha, rideOut);
      const amp = amplification;
      const off = rec[ROFF]!;
      const heave = rideOut[0]! + off - rec[RVC]!;
      const pitch = rideOut[2]! - rec[ROFFG]! + rec[RVCS]!;
      const roll = rideOut[1]! + rec[ROFFC]!;
      out.heave = heave;
      out.pitch = pitch;
      out.roll = roll;
      out.amplification = amp;
      const yaw = datan2(rec[RS]!, rec[RC]!);
      core.writeBody(
        out,
        datan(rec[RCC]!),
        -datan(rec[RG]!),
        yaw,
        roll * amp,
        -rec[RVCS]! + pitch * amp,
        rec[RX]!,
        rec[RY]!,
        rec[RZ]! + rec[RVC]! + heave * amp - core.staticDeflectionMean(),
      );
      core.writeCorners(out, alpha, amp, roll);
      const u = rec[RU]!;
      const v = rec[RV]!;
      out.speed = Math.sqrt(u * u + v * v);
      out.ax = rec[RAX]!;
      out.ay = rec[RAY]!;
      out.yawRate = rec[RR]!;
      const d: DriveFrame = out.drive;
      d.x = rec[RX]!;
      d.y = rec[RY]!;
      d.yaw = dwrapPi(yaw);
      d.u = u;
      d.v = v;
      d.beta = Math.abs(u) < 1 && Math.abs(v) < 1 ? 0 : datan2(v, Math.abs(u));
      d.throttle = cmdOut.throttle;
      d.brake = cmdOut.brake;
      d.handbrake = cmdOut.handbrake;
      d.gear = pio.gear;
      d.engineRpm = pio.engineRpm;
      d.absActive = flags[3] === 1;
      d.tractionActive = flags[0] === 1;
      d.stabilityActive = flags[4] === 1;
      d.zone = zone;
      const s = scal[0]!;
      if (s === s) {
        d.lineOffset = scal[1]! - track.lineOffset(s);
        d.headingError = dwrapPi(yaw - fr.heading);
      } else {
        d.lineOffset = NaN;
        d.headingError = NaN;
      }
      d.approximate = flags[1] === 1;
      d.faults = scal[2]!;
    },

    releaseToPath(path) {
      // §7.10 C (10-01): the Auto model takes the body back with the SAME ride state; its reference plane is refitted
      // so its road inputs at `path` continue this step's, and its interpolation record keeps this step as `prev`.
      core.rebase(path);
    },

    snapshot,
    restore(src) {
      restore(src);
      core.beginStep();
      settle();
    },
  };
  return plant;
}
