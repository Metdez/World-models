/**
 * 05-02 fixture: a cafe-racer MotorcycleDefinition, the three motorcycle suspension definitions and a planar pose
 * function that writes a REAL contract TelemetryFrame (createTelemetryFrame + MOTO_CORNERS). Built strictly from
 * the contract types; the numbers are representative (research 07/08), NOT the 05-01 content. Kinematics here are
 * the textbook planar ones (fork slide along the steering axis, Telelever arm arc, swingarm arc, 4-bar rocker) so
 * the visuals can be tested before the real sim lands.
 *
 * Frames: vehicle frame (x fwd, y left, z up, origin on the ground under the CG); body pose = yaw * pitch * roll
 * about that origin (so the lean is about the contact line).
 */
import type {
  LinkageRear,
  MotorcycleSuspensionDefinition,
  SpringSpec,
  SuspensionCopy,
  SwingarmRear,
  TeleleverFront,
  TelescopicFront,
} from '../../src/contracts/suspension';
import { createTelemetryFrame, type CornerFrame, type TelemetryFrame } from '../../src/contracts/telemetry';
import { MOTO_CORNERS, type Vec3, type XYZ, type XYZW } from '../../src/contracts/units';
import type { MotorcycleDefinition, TyreParams } from '../../src/contracts/vehicle';

const DEG = Math.PI / 180;

/** Design hardpoints shared by the presets (the frame is one frame): steering head top and swingarm pivot. */
export const STEERING_HEAD: Vec3 = [0.39, 0, 0.91];
export const SWINGARM_PIVOT: Vec3 = [-0.16, 0, 0.36];

const tyre = (radius: number, width: number, crownRadius: number): TyreParams => ({
  radius,
  width,
  verticalStiffness: 180000,
  verticalDamping: 150,
  mu: 1.2,
  loadSensitivity: -0.00004,
  nominalLoad: 1500,
  crownRadius,
});

export const CAFE_RACER: MotorcycleDefinition = {
  id: 'cafe-racer',
  class: 'motorcycle',
  name: 'Cafe racer',
  subtitle: 'Representative parameters',
  visualKey: 'cafe-racer',
  mass: 290,
  sprungMass: 255,
  cgHeight: 0.62,
  inertia: { roll: 40, pitch: 90, yaw: 70 },
  wheelbase: 1.415,
  cgToFront: 0.69,
  limits: { lateral: 8, accel: 4, brake: 7, vMax: 50 },
  dragArea: 0.5,
  suspensions: ['moto-classic', 'moto-modern', 'moto-telelever'],
  defaultSuspension: 'moto-classic',
  front: { tyre: tyre(0.3, 0.12, 0.06), brakeShare: 0.7, driven: false },
  rear: { tyre: tyre(0.312, 0.16, 0.08), brakeShare: 0.3, driven: true },
  chain: { sprocketCentre: [-0.075, 0.37], frontRadius: 0.042, rearRadius: 0.115 },
};

const copy = (label: string): SuspensionCopy => ({
  label,
  short: label,
  descriptor: 'Fixture',
  strengths: ['typically simple'],
  costs: ['typically heavy'],
  qualitative: { cost: 'medium', packaging: 'medium', complexity: 'medium' },
});
const spring = (rate: number): SpringSpec => ({ rate, preload: 300, progression: 0 });
const damper = { bump: 1500, rebound: 3000 } as const;

/** Front axle at static ride height for a fork on the steering axis through `STEERING_HEAD` (offset ahead of it). */
function forkAxle(rake: number, offset: number, axleZ: number): Vec3 {
  const [hx, , hz] = STEERING_HEAD;
  // Fork axis: STEERING_HEAD + offset * n + s * (-u), u = (-sin, cos) up the axis, n = (cos, sin) ahead of it.
  const s = (hz + offset * Math.sin(rake) - axleZ) / Math.cos(rake);
  return [hx + offset * Math.cos(rake) + s * Math.sin(rake), 0, axleZ];
}

const telescopic = (inverted: boolean, rakeDeg: number, offset: number): TelescopicFront => ({
  kind: 'telescopic',
  inverted,
  rake: rakeDeg * DEG,
  offset,
  steeringHead: STEERING_HEAD,
  travel: 0.12,
  spring: spring(9000),
  damper,
  stiction: 40,
  unsprungMass: 16,
  stanchionDiameter: inverted ? 0.043 : 0.041,
});

const REAR_AXLE: Vec3 = [-(CAFE_RACER.wheelbase - CAFE_RACER.cgToFront), 0, CAFE_RACER.rear.tyre.radius];

export const MOTO_CLASSIC: MotorcycleSuspensionDefinition = {
  id: 'moto-classic',
  vehicleClass: 'motorcycle',
  copy: copy('Classic'),
  visualKey: 'moto-planar',
  front: telescopic(false, 25.5, 0.042),
  rear: {
    kind: 'swingarm',
    pivot: SWINGARM_PIVOT,
    axle: REAR_AXLE,
    shocks: 2,
    singleSided: false,
    shockTop: [-0.565, 0.145, 0.7],
    shockLower: [-0.655, 0.145, 0.36],
    travel: 0.12,
    spring: { rate: 30000, preload: 400, dualRate: { rate: 42000, crossover: 0.03 }, progression: 0 },
    damper,
    unsprungMass: 20,
  } satisfies SwingarmRear,
};

export const MOTO_MODERN: MotorcycleSuspensionDefinition = {
  id: 'moto-modern',
  vehicleClass: 'motorcycle',
  copy: copy('Modern'),
  visualKey: 'moto-planar',
  front: telescopic(true, 22.8, 0.032),
  rear: {
    kind: 'swingarm-linkage',
    pivot: SWINGARM_PIVOT,
    axle: REAR_AXLE,
    rockerPivot: [-0.2, 0, 0.215],
    swingarmLink: [-0.34, 0, 0.285],
    rockerLink: [-0.31, 0, 0.17],
    rockerShock: [-0.25, 0, 0.27],
    shockTop: [-0.29, 0, 0.6],
    travel: 0.125,
    spring: spring(95000),
    damper,
    unsprungMass: 18,
  } satisfies LinkageRear,
};

const TELE_RAKE = 26 * DEG;
const TELE_OFFSET = 0.03;
const TELE_AXLE = forkAxle(TELE_RAKE, TELE_OFFSET, CAFE_RACER.front.tyre.radius);
/** Ball joint on the fork lower bridge: on the fork axis, above the tyre. */
const TELE_JOINT: Vec3 = [TELE_AXLE[0] - 0.36 * Math.sin(TELE_RAKE), 0, TELE_AXLE[2] + 0.36 * Math.cos(TELE_RAKE)];

export const MOTO_TELELEVER: MotorcycleSuspensionDefinition = {
  id: 'moto-telelever',
  vehicleClass: 'motorcycle',
  copy: copy('Telelever'),
  visualKey: 'moto-planar',
  front: {
    kind: 'telelever',
    rake: TELE_RAKE,
    offset: TELE_OFFSET,
    steeringHead: STEERING_HEAD,
    armPivot: [0.17, 0, 0.5],
    armJoint: TELE_JOINT,
    shockTop: [0.27, 0, 0.83],
    shockArm: [0.33, 0, 0.54],
    travel: 0.12,
    spring: spring(30000),
    damper,
    unsprungMass: 17,
  } satisfies TeleleverFront,
  rear: {
    kind: 'swingarm',
    pivot: SWINGARM_PIVOT,
    axle: REAR_AXLE,
    shocks: 1,
    singleSided: true,
    shockTop: [-0.33, -0.07, 0.7],
    shockLower: [-0.45, -0.1, 0.4],
    travel: 0.12,
    spring: spring(60000),
    damper,
    unsprungMass: 21,
  } satisfies SwingarmRear,
};

export const MOTO_SUSPENSIONS = [MOTO_CLASSIC, MOTO_MODERN, MOTO_TELELEVER] as const;

export const POINT_ORDER = {
  telescopic: ['steeringHead', 'crownTop', 'forkBottom', 'axle', 'contactPatch'],
  telelever: ['steeringHead', 'crownTop', 'forkBottom', 'axle', 'contactPatch', 'armPivot', 'armJoint', 'shockTop', 'shockArm'],
  swingarm: ['pivot', 'axle', 'shockTop', 'shockLower', 'contactPatch'],
  'swingarm-linkage': ['pivot', 'axle', 'rockerPivot', 'swingarmLink', 'rockerLink', 'rockerShock', 'shockTop', 'contactPatch'],
} as const;

export function createMotoFrame(): TelemetryFrame {
  return createTelemetryFrame(
    'motorcycle',
    MOTO_CORNERS.map((id) => ({ id, axle: id === 'f' ? ('front' as const) : ('rear' as const), side: 0 as const })),
  );
}

export interface MotoPose {
  /** Wheel travel (vertical, + bump), m. */
  readonly travelF: number;
  readonly travelR: number;
  /** Steer about the steering axis, rad (+ left). */
  readonly steer: number;
  /** Lean (+ left side up), pitch (+ nose down), heave (m), heading (rad). */
  readonly roll: number;
  readonly pitch: number;
  readonly heave: number;
  readonly heading: number;
  readonly x: number;
  readonly y: number;
  /** Wheel rolling angle, rad. */
  readonly spin: number;
}

export const STATIC_POSE: MotoPose = { travelF: 0, travelR: 0, steer: 0, roll: 0, pitch: 0, heave: 0, heading: 0, x: 0, y: 0, spin: 0 };

type P = [number, number, number];
const v = (p: Vec3): P => [p[0], p[1], p[2]];

/** Rotates p about the lateral axis through c (x–z plane) by a (+ = x toward z). */
function rotXZ(p: Vec3, c: Vec3, a: number): P {
  const dx = p[0] - c[0];
  const dz = p[2] - c[2];
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  return [c[0] + dx * ca - dz * sa, p[1], c[2] + dx * sa + dz * ca];
}

/** Rotation that lifts `p` about `c` so its z rises by dz (branch nearest the rest angle). */
function liftAngle(p: Vec3, c: Vec3, dz: number): number {
  const r = Math.hypot(p[0] - c[0], p[2] - c[2]);
  const a0 = Math.atan2(p[2] - c[2], p[0] - c[0]);
  const s = Math.max(-1, Math.min(1, (p[2] - c[2] + dz) / r));
  const a1 = Math.asin(s);
  const cand = [a1, Math.PI - a1];
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  const best = Math.abs(wrap(cand[0]! - a0)) < Math.abs(wrap(cand[1]! - a0)) ? cand[0]! : cand[1]!;
  return wrap(best - a0);
}

/** Circle–circle: the point at distance ra from a and rb from b nearest `near` (x–z plane, y from near). */
function circles(a: Vec3, ra: number, b: Vec3, rb: number, near: Vec3): P {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const d = Math.hypot(dx, dz);
  const l = (ra * ra - rb * rb + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, ra * ra - l * l));
  const mx = a[0] + (l * dx) / d;
  const mz = a[2] + (l * dz) / d;
  const p1: P = [mx + (h * dz) / d, near[1], mz - (h * dx) / d];
  const p2: P = [mx - (h * dz) / d, near[1], mz + (h * dx) / d];
  const d1 = Math.hypot(p1[0] - near[0], p1[2] - near[2]);
  const d2 = Math.hypot(p2[0] - near[0], p2[2] - near[2]);
  return d1 <= d2 ? p1 : p2;
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Rodrigues rotation of p about the unit axis k through c by angle a. */
function rotAxis(p: Vec3, c: Vec3, k: Vec3, a: number): P {
  const x = p[0] - c[0];
  const y = p[1] - c[1];
  const z = p[2] - c[2];
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const dot = k[0] * x + k[1] * y + k[2] * z;
  const cx = k[1] * z - k[2] * y;
  const cy = k[2] * x - k[0] * z;
  const cz = k[0] * y - k[1] * x;
  return [
    c[0] + x * ca + cx * sa + k[0] * dot * (1 - ca),
    c[1] + y * ca + cy * sa + k[1] * dot * (1 - ca),
    c[2] + z * ca + cz * sa + k[2] * dot * (1 - ca),
  ];
}

function quatMul(a: XYZW, b: XYZW): XYZW {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}
const axisQuat = (k: Vec3, a: number): XYZW => ({ x: k[0] * Math.sin(a / 2), y: k[1] * Math.sin(a / 2), z: k[2] * Math.sin(a / 2), w: Math.cos(a / 2) });

function applyQuat(q: XYZW, p: Vec3): P {
  const { x, y, z, w } = q;
  const ix = w * p[0] + y * p[2] - z * p[1];
  const iy = w * p[1] + z * p[0] - x * p[2];
  const iz = w * p[2] + x * p[1] - y * p[0];
  const iw = -x * p[0] - y * p[1] - z * p[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}

function setXYZ(out: XYZ, p: Vec3): void {
  out.x = p[0];
  out.y = p[1];
  out.z = p[2];
}

/**
 * Writes the frame for `susp` at `pose`. Corner points are world xyz triples in the contract `pointOrder`; the
 * pointOrder array references are stable per kind (so consumers can cache name lookups).
 */
export function poseMotoFrame(frame: TelemetryFrame, vehicle: MotorcycleDefinition, susp: MotorcycleSuspensionDefinition, pose: MotoPose): TelemetryFrame {
  const body = quatMul(quatMul(axisQuat([0, 0, 1], pose.heading), axisQuat([0, 1, 0], pose.pitch)), axisQuat([1, 0, 0], pose.roll));
  const origin: P = [pose.x, pose.y, pose.heave];
  const world = (p: Vec3): P => {
    const r = applyQuat(body, p);
    return [r[0] + origin[0], r[1] + origin[1], r[2] + origin[2]];
  };
  frame.vehicleId = vehicle.id;
  frame.suspensionId = susp.id;
  frame.roll = pose.roll;
  frame.pitch = pose.pitch;
  frame.heave = pose.heave;
  frame.steer = pose.steer;
  frame.wheelbase = vehicle.wheelbase;
  setXYZ(frame.bodyPosition, origin);
  Object.assign(frame.bodyRotation, body);
  frame.amplification = 1;

  // ---- front
  const f = susp.front;
  const steerAxis: P = [-Math.sin(f.rake), 0, Math.cos(f.rake)];
  const sh = f.steeringHead;
  const named = new Map<string, Vec3>();
  let axleF: P;
  if (f.kind === 'telescopic') {
    const axle0 = forkAxle(f.rake, f.offset, vehicle.front.tyre.radius);
    const d = pose.travelF / Math.cos(f.rake);
    axleF = [axle0[0] - d * steerAxis[0], 0, axle0[2] + d * steerAxis[2]];
    named.set('crownTop', [sh[0] + f.offset * Math.cos(f.rake) - 0.03 * steerAxis[0], 0, sh[2] + f.offset * Math.sin(f.rake) + 0.03 * steerAxis[2]]);
    named.set('forkBottom', [axleF[0] + 0.03 * steerAxis[0], 0, axleF[2] - 0.03 * steerAxis[2]]);
  } else {
    // Telelever: the A-arm turns about armPivot; the fork lower turns with the line top ball joint -> arm joint.
    const axle0 = forkAxle(f.rake, f.offset, vehicle.front.tyre.radius);
    let a = 0;
    for (let i = 0; i < 4; i++) {
      // Lift of the arm joint ~ lift of the axle; refine on the axle itself.
      const joint = rotXZ(f.armJoint, f.armPivot, a);
      const lower = Math.atan2(joint[2] - sh[2], joint[0] - sh[0]) - Math.atan2(f.armJoint[2] - sh[2], f.armJoint[0] - sh[0]);
      const ax = rotXZ(axle0, f.armJoint, lower);
      const z = ax[2] + joint[2] - f.armJoint[2];
      a += (axle0[2] + pose.travelF - z) / Math.max(1e-6, Math.cos(Math.atan2(joint[2] - f.armPivot[2], joint[0] - f.armPivot[0])) * dist(f.armJoint, f.armPivot));
    }
    const joint = rotXZ(f.armJoint, f.armPivot, a);
    const lower = Math.atan2(joint[2] - sh[2], joint[0] - sh[0]) - Math.atan2(f.armJoint[2] - sh[2], f.armJoint[0] - sh[0]);
    const ax = rotXZ(axle0, f.armJoint, lower);
    axleF = [ax[0] + joint[0] - f.armJoint[0], 0, ax[2] + joint[2] - f.armJoint[2]];
    named.set('crownTop', [sh[0] + f.offset * Math.cos(f.rake), 0, sh[2] + f.offset * Math.sin(f.rake)]);
    named.set('forkBottom', [axleF[0] + 0.03 * steerAxis[0], 0, axleF[2] - 0.03 * steerAxis[2]]);
    named.set('armPivot', v(f.armPivot));
    named.set('armJoint', rotAxis(joint, sh, steerAxis, pose.steer));
    named.set('shockTop', v(f.shockTop));
    named.set('shockArm', rotXZ(f.shockArm, f.armPivot, a));
  }
  named.set('steeringHead', v(sh));
  // Steered parts turn about the steering axis through the steering head.
  for (const k of ['crownTop', 'forkBottom']) named.set(k, rotAxis(named.get(k)!, sh, steerAxis, pose.steer));
  const axleSteered = rotAxis(axleF, sh, steerAxis, pose.steer);
  named.set('axle', axleSteered);
  named.set('contactPatch', [axleSteered[0], axleSteered[1], axleSteered[2] - vehicle.front.tyre.radius]);
  const front = frame.corners[0]!;
  front.pointOrder = f.kind === 'telescopic' ? POINT_ORDER.telescopic : POINT_ORDER.telelever;
  writeCorner(front, named, world, pose.travelF, pose.spin);
  front.steer = pose.steer;
  Object.assign(front.wheelRotation, quatMul(body, axisQuat(steerAxis, pose.steer)));
  front.springLength = f.kind === 'telelever' ? dist(named.get('shockTop')!, named.get('shockArm')!) : 0.5 - pose.travelF;

  // ---- rear
  const r = susp.rear;
  named.clear();
  const a = liftAngle(r.axle, r.pivot, pose.travelR);
  named.set('pivot', v(r.pivot));
  named.set('axle', rotXZ(r.axle, r.pivot, a));
  named.set('shockTop', v(r.shockTop));
  if (r.kind === 'swingarm') {
    named.set('shockLower', rotXZ(r.shockLower, r.pivot, a));
  } else {
    const s = rotXZ(r.swingarmLink, r.pivot, a);
    const q = circles(r.rockerPivot, dist(r.rockerLink, r.rockerPivot), s, dist(r.rockerLink, r.swingarmLink), r.rockerLink);
    const g = Math.atan2(q[2] - r.rockerPivot[2], q[0] - r.rockerPivot[0]) - Math.atan2(r.rockerLink[2] - r.rockerPivot[2], r.rockerLink[0] - r.rockerPivot[0]);
    named.set('rockerPivot', v(r.rockerPivot));
    named.set('swingarmLink', s);
    named.set('rockerLink', q);
    named.set('rockerShock', rotXZ(r.rockerShock, r.rockerPivot, g));
  }
  const axleR = named.get('axle')!;
  named.set('contactPatch', [axleR[0], 0, axleR[2] - vehicle.rear.tyre.radius]);
  const rear = frame.corners[1]!;
  rear.pointOrder = POINT_ORDER[r.kind];
  writeCorner(rear, named, world, pose.travelR, pose.spin * (vehicle.front.tyre.radius / vehicle.rear.tyre.radius));
  rear.steer = 0;
  Object.assign(rear.wheelRotation, body);
  rear.springLength = dist(named.get('shockTop')!, named.get(r.kind === 'swingarm' ? 'shockLower' : 'rockerShock')!);
  return frame;
}

function writeCorner(c: CornerFrame, named: ReadonlyMap<string, Vec3>, world: (p: Vec3) => P, travel: number, spin: number): void {
  c.travel = travel;
  const tau = 2 * Math.PI;
  c.spin = ((spin % tau) + tau) % tau;
  c.load = 1500;
  c.pointOrder.forEach((name, i) => {
    const p = named.get(name);
    if (!p) throw new Error(`fixture: no point "${name}"`);
    const w = world(p);
    c.points[3 * i] = w[0];
    c.points[3 * i + 1] = w[1];
    c.points[3 * i + 2] = w[2];
  });
  setXYZ(c.wheelPosition, world(named.get('axle')!));
  setXYZ(c.contactPatch, world(named.get('contactPatch')!));
}
