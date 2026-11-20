/**
 * PLACEHOLDER simulation for phase 1 (deleted by plan 02-04): a car driving a flat circle (R 60 m, 15 m/s, left turn)
 * with synthetic sinusoidal body motion. It implements the full `Simulation` contract so the kernel, renderer and
 * tests can be built against it, but NOTHING here is physics: never present its values as data.
 */
import type { CarDefinition } from '../../contracts/vehicle';
import type { CarSuspensionDefinition, AxleKinematics, AxleLinkage, KinematicsCurves, VehicleKinematics } from '../../contracts/suspension';
import { createTelemetryFrame, type CornerLayout, type TelemetryFrame } from '../../contracts/telemetry';
import type { BuiltTrack, TrackDefinition, TrackSample } from '../../contracts/track';
import { G, type AxleId, type XYZ } from '../../contracts/units';
import { SEEK_SETTLE_S, type PathState, type SimEvent, type Simulation, type SimulationOptions } from '../../contracts/sim';
import { wrap, wrapHalf } from '../math/interp';
import * as q from '../math/quat';
import * as v3 from '../math/vec3';

const RADIUS = 60;
const SPEED = 15;
const LENGTH = 2 * Math.PI * RADIUS;
const LAP = LENGTH / SPEED;
const WHEELBASE = 2.9;
const CG_TO_FRONT = 0.49 * WHEELBASE;
const TRACK = 1.6;
const WHEEL_RADIUS = 0.34;
const WHEEL_RATE = 30000;
const DAMPING = 2500;
const SPRING_LENGTH = 0.35;
const SECTION_ID = 'stub-circle';

const LAYOUT: readonly (CornerLayout & { readonly x: number; readonly y: number })[] = [
  { id: 'fl', axle: 'front', side: 1, x: CG_TO_FRONT, y: TRACK / 2 },
  { id: 'fr', axle: 'front', side: -1, x: CG_TO_FRONT, y: -TRACK / 2 },
  { id: 'rl', axle: 'rear', side: 1, x: CG_TO_FRONT - WHEELBASE, y: TRACK / 2 },
  { id: 'rr', axle: 'rear', side: -1, x: CG_TO_FRONT - WHEELBASE, y: -TRACK / 2 },
];
const POINT_ORDER = ['wheelCentre'] as const;

// ---- synthetic body motion: (amplitude, Hz, phase) for heave (m), roll and pitch (rad)
const HEAVE = [0.01, 1.3, 0] as const;
const ROLL = [0.006, 0.7, 0] as const;
const PITCH = [0.004, 0.9, 1] as const;
const wave = ([a, f, p]: readonly [number, number, number], t: number) => a * Math.sin(2 * Math.PI * f * t + p);
const waveRate = ([a, f, p]: readonly [number, number, number], t: number) => a * 2 * Math.PI * f * Math.cos(2 * Math.PI * f * t + p);

function stubVehicle(id: string, suspensionId: string): CarDefinition {
  const tyre = { radius: WHEEL_RADIUS, width: 0.25, verticalStiffness: 250000, verticalDamping: 400, mu: 1, loadSensitivity: 0, nominalLoad: 4000 };
  const axle = { track: TRACK, unsprungMass: 40, rideFrequency: 1.5, damping: { bump: 0.3, rebound: 0.5 }, antiRollStiffness: 0, tyre, driven: false };
  return {
    id,
    class: 'car',
    name: 'Placeholder car',
    subtitle: 'Stub simulation',
    visualKey: 'stub',
    mass: 1600,
    sprungMass: 1440,
    cgHeight: 0.5,
    inertia: { roll: 550, pitch: 2500, yaw: 2800 },
    wheelbase: WHEELBASE,
    cgToFront: CG_TO_FRONT,
    limits: { lateral: 8, accel: 5, brake: 8, vMax: SPEED },
    dragArea: 0.65,
    suspensions: [suspensionId],
    defaultSuspension: suspensionId,
    front: { ...axle, steered: true, brakeShare: 0.6 },
    rear: { ...axle, steered: false, driven: true, brakeShare: 0.4 },
    maxSteer: 0.35,
  };
}

function stubSuspension(id: string): CarSuspensionDefinition {
  const axle: AxleLinkage = {
    points: { wheelCentre: [0, TRACK / 2, WHEEL_RADIUS] },
    uprightPoints: ['wheelCentre'],
    constraints: [],
    spring: { upper: 'wheelCentre', lower: { on: 'upright', point: 'wheelCentre' } },
    alignment: { camber: 0, toe: 0 },
    travel: { bump: 0.07, droop: 0.07 },
  };
  return {
    id,
    vehicleClass: 'car',
    visualKey: 'stub',
    copy: { label: 'Placeholder', short: 'Stub', descriptor: 'Stub suspension', strengths: [], costs: [], qualitative: { cost: 'medium', packaging: 'medium', complexity: 'medium' } },
    axles: { front: axle, rear: axle },
    extras: { damperFriction: 0, unsprungMassDelta: 0 },
  };
}

function stubKinematics(): VehicleKinematics {
  const two = (a: number, b: number) => Float64Array.of(a, b);
  const curves: KinematicsCurves = {
    travel: two(-0.07, 0.07),
    camber: two(0, 0),
    toe: two(0, 0),
    rollCentreHeight: two(0, 0),
    motionRatio: two(1, 1),
    lateral: two(0, 0),
    longitudinal: two(0, 0),
  };
  const summary = { camberGain: 0, rollCamber: 0, bumpSteer: 0, rollCentreHeight: 0, rollCentreMigration: 0, kingpinInclination: 0, caster: 0, scrubRadius: 0, trail: 0, antiPitch: 0, motionRatio: 1 };
  const axle = (id: AxleId): AxleKinematics => ({ axle: id, curves, summary });
  return { front: axle('front'), rear: axle('rear') };
}

/** Centreline of the circle: starts at the origin heading +X, turning left about (0, R). */
function circleSample(s: number, out: TrackSample): TrackSample {
  const sw = wrap(s, LENGTH);
  const psi = sw / RADIUS;
  out.s = sw;
  out.x = RADIUS * Math.sin(psi);
  out.y = RADIUS * (1 - Math.cos(psi));
  out.z = 0;
  out.heading = psi;
  out.curvature = 1 / RADIUS;
  out.bank = 0;
  out.grade = 0;
  return out;
}

function stubTrack(id: string): BuiltTrack {
  const segment = {
    id: SECTION_ID,
    name: 'Placeholder circle',
    primitives: [{ kind: 'arc', radius: RADIUS, angle: 2 * Math.PI }],
    phenomenon: 'steady-state-roll',
    caption: 'Placeholder circle until the proving loop arrives',
    roughness: 'A',
  } as const;
  const def: TrackDefinition = {
    id,
    name: 'Placeholder circle',
    width: 9,
    kerbWidth: 1.5,
    runoff: 12,
    segments: [segment],
    closure: [SECTION_ID, SECTION_ID],
    swell: { amplitude: 0, cycles: 0 },
    seed: 42,
    visualKey: 'stub',
  };
  const tmp: TrackSample = { s: 0, x: 0, y: 0, z: 0, heading: 0, curvature: 0, bank: 0, grade: 0 };
  return {
    def,
    length: LENGTH,
    sections: [{ index: 0, id: SECTION_ID, s0: 0, s1: LENGTH, def: segment }],
    props: [],
    sectionIndexAt: () => 0,
    sample: circleSample,
    lineOffset: () => 0,
    roadHeight: () => 0,
    toWorld(s: number, l: number, out: XYZ): XYZ {
      circleSample(s, tmp);
      out.x = tmp.x - l * Math.sin(tmp.heading);
      out.y = tmp.y + l * Math.cos(tmp.heading);
      out.z = 0;
      return out;
    },
  };
}

function pathAt(lapTime: number, out: PathState): PathState {
  const t = wrap(lapTime, LAP);
  const s = SPEED * t;
  const psi = s / RADIUS;
  out.lapTime = t;
  out.s = s;
  out.l = 0;
  out.v = SPEED;
  out.ax = 0;
  out.ay = (SPEED * SPEED) / RADIUS;
  out.curvature = 1 / RADIUS;
  out.heading = psi;
  out.x = RADIUS * Math.sin(psi);
  out.y = RADIUS * (1 - Math.cos(psi));
  out.z = 0;
  out.bank = 0;
  out.grade = 0;
  out.sectionIndex = 0;
  return out;
}

export function createStubSimulation(options: SimulationOptions): Simulation {
  const { catalog } = options;
  const track = stubTrack(options.trackId);
  // set for real by setVehicle() at the end of construction
  let suspension = stubSuspension(options.suspensionId);
  let vehicle: CarDefinition = stubVehicle(options.vehicleId, options.suspensionId);
  let frame: TelemetryFrame;
  const kinematics = stubKinematics();
  const events: SimEvent[] = [];
  let lapTime = wrap(options.lapTime ?? 0, LAP);
  let prevLapTime = lapTime;
  let simTime = 0;
  let prevSimTime = 0;
  let lap = 0;

  // scratch (no allocation in step/sample)
  const path: PathState = pathAt(0, { lapTime: 0, s: 0, l: 0, v: 0, ax: 0, ay: 0, curvature: 0, heading: 0, x: 0, y: 0, z: 0, bank: 0, grade: 0, sectionIndex: 0 });
  const yaw = q.create();
  const body = q.create();
  const p = v3.create();

  function newFrame(): TelemetryFrame {
    const f = createTelemetryFrame('car', LAYOUT);
    for (const c of f.corners) c.pointOrder = POINT_ORDER;
    return f;
  }

  function resolveSuspension(id: string): CarSuspensionDefinition {
    const def = catalog.suspension(id);
    if (def && def.vehicleClass !== 'car') throw new Error(`Suspension "${id}" is not a car suspension`);
    return def ?? stubSuspension(id);
  }

  /** World wheel centre of corner i at the given travel, for the path pose in `path`. */
  function wheelCentre(i: number, out: v3.V3): v3.V3 {
    const c = LAYOUT[i]!;
    q.rotate(out, yaw, v3.set(p, c.x, c.y, WHEEL_RADIUS));
    return v3.set(out, out[0] + path.x, out[1] + path.y, out[2] + path.z);
  }

  const sim: Simulation = {
    track,
    get vehicle() {
      return vehicle;
    },
    get suspension() {
      return suspension;
    },
    lapDuration: LAP,
    get lapTime() {
      return lapTime;
    },
    get simTime() {
      return simTime;
    },

    step(dt) {
      prevLapTime = lapTime;
      prevSimTime = simTime;
      simTime += dt;
      lapTime += dt;
      if (lapTime >= LAP) {
        lapTime -= LAP;
        lap++;
        events.push({ kind: 'lap', lap, duration: LAP });
      }
    },

    sample(alpha, amplification = 1) {
      const t = prevSimTime + (simTime - prevSimTime) * alpha;
      const lt = wrap(prevLapTime + wrapHalf(lapTime - prevLapTime, LAP) * alpha, LAP);
      pathAt(lt, path);
      const amp = amplification;
      const heave = wave(HEAVE, t);
      const roll = wave(ROLL, t);
      const pitch = wave(PITCH, t);
      const f = frame;
      f.vehicleId = vehicle.id;
      f.suspensionId = suspension.id;
      f.simTime = t;
      f.lapTime = lt;
      f.lap = lap;
      f.s = path.s;
      f.sectionIndex = 0;
      f.sectionId = SECTION_ID;
      f.speed = path.v;
      f.ax = path.ax;
      f.ay = path.ay;
      f.yawRate = SPEED / RADIUS;
      f.roll = roll;
      f.pitch = pitch;
      f.heave = heave;
      f.steer = Math.atan(WHEELBASE / RADIUS);
      f.wheelbase = WHEELBASE;
      f.trail = 0;
      f.amplification = amp;
      f.bodyPosition.x = path.x;
      f.bodyPosition.y = path.y;
      f.bodyPosition.z = path.z + heave * amp;
      q.fromRollPitchYaw(yaw, 0, 0, path.heading);
      q.toXYZW(q.fromRollPitchYaw(body, roll * amp, pitch * amp, path.heading), f.bodyRotation);

      const staticFront = (vehicle.mass * G * (1 - CG_TO_FRONT / WHEELBASE)) / 2;
      const staticRear = (vehicle.mass * G * (CG_TO_FRONT / WHEELBASE)) / 2;
      const spin = wrap((SPEED * t) / WHEEL_RADIUS, 2 * Math.PI);
      for (let i = 0; i < LAYOUT.length; i++) {
        const c = LAYOUT[i]!;
        const corner = f.corners[i]!;
        // travel (+ bump) from the synthetic body pose: corner z = heave - x*pitch + y*roll
        const travel = -heave + c.x * pitch - c.y * roll;
        const rate = -waveRate(HEAVE, t) + c.x * waveRate(PITCH, t) - c.y * waveRate(ROLL, t);
        corner.travel = travel;
        corner.travelRate = rate;
        corner.camber = 0;
        corner.camberBody = 0;
        corner.toe = 0;
        corner.steer = c.axle === 'front' ? f.steer : 0;
        corner.springForce = (c.axle === 'front' ? staticFront : staticRear) + WHEEL_RATE * travel;
        corner.damperForce = DAMPING * rate;
        corner.load = Math.max(0, corner.springForce + corner.damperForce);
        corner.motionRatio = 1;
        corner.gripUse = 0;
        corner.stop = 0;
        wheelCentre(i, p);
        v3.toXYZ(p, corner.wheelPosition);
        v3.write(p, corner.points, 0);
        corner.contactPatch.x = p[0];
        corner.contactPatch.y = p[1];
        corner.contactPatch.z = path.z;
        q.toXYZW(corner.axle === 'front' ? q.fromRollPitchYaw(body, 0, 0, path.heading + f.steer) : yaw, corner.wheelRotation);
        corner.spin = spin;
        corner.springLength = SPRING_LENGTH - travel * amp;
      }
      return f;
    },

    setSuspension(id) {
      suspension = resolveSuspension(id);
    },

    setVehicle(id, suspensionId) {
      const def = catalog.vehicle(id);
      if (def && def.class !== 'car') throw new Error(`The stub simulation only drives cars ("${id}" is a ${def.class})`);
      const sid = suspensionId ?? def?.defaultSuspension ?? suspension.id;
      vehicle = def ?? stubVehicle(id, sid);
      suspension = resolveSuspension(sid);
      frame = newFrame();
    },

    seek(t) {
      lapTime = prevLapTime = wrap(t, LAP);
      simTime += SEEK_SETTLE_S;
      prevSimTime = simTime;
    },

    stateAt: pathAt,
    lapTimeAt: (s) => wrap(s, LENGTH) / SPEED,
    kinematics: () => kinematics,

    restPose(cornerIndex, out) {
      pathAt(lapTime, path);
      q.fromRollPitchYaw(yaw, 0, 0, path.heading);
      return v3.write(wheelCentre(cornerIndex, p), out, 0);
    },

    drainEvents(handler) {
      for (const e of events) handler(e);
      events.length = 0;
    },
  };
  sim.setVehicle(options.vehicleId, options.suspensionId);
  sim.sample(0);
  return sim;
}

