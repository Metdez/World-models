import type { VehicleClass } from './suspension';
import type { AxleId, CornerId, XYZ, XYZW } from './units';

/**
 * Preallocated per-corner telemetry. Written by sim-core `sample()`, read by everything else.
 * TRUE fields are physical values and are NEVER amplified.
 * POSE fields (marked) are for rendering and include the display amplification factor.
 */
export interface CornerFrame {
  readonly id: CornerId;
  readonly axle: AxleId;
  /** +1 left, -1 right, 0 centreline (motorcycle). */
  readonly side: 1 | -1 | 0;
  /** Point names for `points`, defined by the active suspension (car: AxleLinkage.points keys incl. arm points; motorcycle: fixed per model kind). */
  pointOrder: readonly string[];

  // ---- TRUE values (SI) ----
  /** m, + bump, from static ride height. */
  travel: number;
  /** m/s, + compressing. */
  travelRate: number;
  /** rad, wheel camber relative to the ROAD plane (- = top inboard). */
  camber: number;
  /** rad, camber relative to the body. */
  camberBody: number;
  /** rad, + toe-in: static + bump steer (excludes steering input). */
  toe: number;
  /** rad, road-wheel steer about vehicle +Z, + left (car: Ackermann per wheel; motorcycle front: steer about steering axis). */
  steer: number;
  /** N, tyre vertical load, >= 0 (0 = wheel off the ground). */
  load: number;
  /** N along the spring axis, + compression. */
  springForce: number;
  /** N along the damper axis, + while resisting compression. */
  damperForce: number;
  /** d(spring length)/d(travel) at the current travel. */
  motionRatio: number;
  /** Model estimate of tyre force used / available, 0..~1.2. Label as "model" in UI. */
  gripUse: number;
  /** 0..1 bump-stop (or rebound-stop) engagement. */
  stop: number;

  // ---- POSE (world, sim frame, amplified) ----
  readonly wheelPosition: XYZ;
  /** Wheel orientation incl. steer/camber/toe, excluding spin. */
  readonly wheelRotation: XYZW;
  /** rad, accumulated rolling angle about the axle (wrapped to [0, 2pi)). */
  spin: number;
  readonly contactPatch: XYZ;
  /** Front-view instant centre (car) / swingarm instant centre (motorcycle rear). */
  readonly instantCentre: XYZ;
  /** World xyz triples for `pointOrder` (length = 3 * pointOrder.length; capacity MAX_POINTS * 3). */
  readonly points: Float64Array;
  /** Current spring length, m (pose). */
  springLength: number;
}

export interface AxleFrame {
  readonly id: AxleId;
  /** TRUE kinematic roll-centre height above the road, m (car; NaN for motorcycle). */
  rollCentreHeight: number;
  /** TRUE anti-dive/anti-squat fraction at the current state. */
  antiPitch: number;
  /** POSE: roll centre in world (car). */
  readonly rollCentre: XYZ;
}

export interface TelemetryFrame {
  vehicleClass: VehicleClass;
  vehicleId: string;
  suspensionId: string;

  // ---- time & path (TRUE) ----
  /** s since simulation start (monotonic, includes seeks' pre-roll). */
  simTime: number;
  /** s within the current lap, [0, lapDuration). */
  lapTime: number;
  lap: number;
  /** m along the centreline. */
  s: number;
  sectionIndex: number;
  sectionId: string;
  /** m/s. */
  speed: number;
  /** Vehicle-frame accelerations, m/s^2 (ax + forward, ay + left). */
  ax: number;
  ay: number;
  yawRate: number;

  // ---- body (TRUE, relative to the local road plane) ----
  /** rad, + left side up (car body roll; motorcycle lean angle). */
  roll: number;
  /** rad, + nose down. */
  pitch: number;
  /** m, + up, from static ride height. */
  heave: number;
  /** rad: mean front road-wheel steer (car) / handlebar steer angle (motorcycle). */
  steer: number;
  /** m, live wheelbase. */
  wheelbase: number;
  /** m, live mechanical trail of the steered axle. */
  trail: number;

  // ---- body POSE (world, sim frame, amplified) ----
  readonly bodyPosition: XYZ;
  readonly bodyRotation: XYZW;
  /** Factor applied to POSE fields this frame (1 = true scale). */
  amplification: number;

  readonly corners: CornerFrame[];
  readonly axles: AxleFrame[];
}

/** Maximum named points per corner (capacity of CornerFrame.points). */
export const MAX_POINTS = 32;

export interface CornerLayout {
  readonly id: CornerId;
  readonly axle: AxleId;
  readonly side: 1 | -1 | 0;
}

const xyz = (): XYZ => ({ x: 0, y: 0, z: 0 });

/** Allocates a zeroed frame. Called by sim-core only when the vehicle (layout) changes. */
export function createTelemetryFrame(vehicleClass: VehicleClass, corners: readonly CornerLayout[]): TelemetryFrame {
  return {
    vehicleClass,
    vehicleId: '',
    suspensionId: '',
    simTime: 0,
    lapTime: 0,
    lap: 0,
    s: 0,
    sectionIndex: 0,
    sectionId: '',
    speed: 0,
    ax: 0,
    ay: 0,
    yawRate: 0,
    roll: 0,
    pitch: 0,
    heave: 0,
    steer: 0,
    wheelbase: 0,
    trail: 0,
    bodyPosition: xyz(),
    bodyRotation: { x: 0, y: 0, z: 0, w: 1 },
    amplification: 1,
    corners: corners.map((c) => ({
      ...c,
      pointOrder: [],
      travel: 0,
      travelRate: 0,
      camber: 0,
      camberBody: 0,
      toe: 0,
      steer: 0,
      load: 0,
      springForce: 0,
      damperForce: 0,
      motionRatio: 1,
      gripUse: 0,
      stop: 0,
      wheelPosition: xyz(),
      wheelRotation: { x: 0, y: 0, z: 0, w: 1 },
      spin: 0,
      contactPatch: xyz(),
      instantCentre: xyz(),
      points: new Float64Array(MAX_POINTS * 3),
      springLength: 0,
    })),
    axles: (['front', 'rear'] as const).map((id) => ({ id, rollCentreHeight: Number.NaN, antiPitch: 0, rollCentre: xyz() })),
  };
}
