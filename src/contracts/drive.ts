/**
 * Manual Drive (M2): who drives, driver intents, aids, per-frame drive telemetry, drive events and the replay format.
 * Shared by sim-core (plant, drivers, replay), the kernel (mode mirror), features (devices, HUD, VFX, coach, replay,
 * ghost) and the worker (replay validation). SI units; signs as in units.ts (ISO 8855): steer + = LEFT,
 * yaw + = left (CCW from above), wheel spin + = rolling forward, slip ratio + = driving, v + = sliding left.
 */
import type { AxleId } from './units';

/**
 * auto      = M1 behaviour: the car follows the precomputed lap (stateAt), optionally on the shared live clock.
 * manual    = the visitor drives the plant (HumanDriver).
 * returning = the autopilot drives the SAME plant back onto the driving line on a detached lap clock, then the
 *             simulation latches back to auto.
 * replay    = recorded intents drive the plant from a recorded start state.
 */
export type DriveMode = 'auto' | 'manual' | 'returning' | 'replay';

export type DriveSource = 'keyboard' | 'gamepad' | 'touch' | 'phone' | 'replay' | 'autopilot';

/** Latest-wins intent from an input device. The simulation latches it every CONTROL_TICKS steps and quantises it. */
export interface DriveIntent {
  /** -1..1, + = steer LEFT (1 = full lock demand). */
  steer: number;
  /** 0..1 */
  throttle: number;
  /** 0..1. Held at standstill it selects reverse (sim-core HumanDriver). */
  brake: number;
  /** 0..1 */
  handbrake: number;
  /** true for on/off devices (keyboard, touch buttons): the simulation applies rise/fall ramps. */
  digital: boolean;
  source: DriveSource;
}

/** Fixed steps per control sample (240 Hz / 4 = 60 Hz). Live driving and replays latch intents on the same ticks. */
export const CONTROL_TICKS = 4;
/** A latched intent is quantised to these integer ranges (replays store exactly these integers). */
export const INTENT_QUANT = { steer: 1024, pedal: 255 } as const;
/** Index of each DriveSource in the replay flags byte (bits 1-3). */
export const DRIVE_SOURCES = ['keyboard', 'gamepad', 'touch', 'phone', 'replay', 'autopilot'] as const satisfies readonly DriveSource[];

export function neutralIntent(source: DriveSource = 'keyboard'): DriveIntent {
  return { steer: 0, throttle: 0, brake: 0, handbrake: 0, digital: true, source };
}

/** Driver aids. Every aid is a labelled, simplified model ("Assist"), never a manufacturer system. */
export interface DriveAids {
  readonly abs: boolean;
  readonly traction: boolean;
  readonly stability: boolean;
  /** Speed-sensitive steering limit and countersteer help (input conditioning in sim-core). */
  readonly steering: boolean;
}

export const DEFAULT_AIDS: DriveAids = { abs: true, traction: true, stability: true, steering: true };

/** Per-frame drive telemetry (TRUE values, SI), written by sim-core sample() in every mode. */
export interface DriveFrame {
  mode: DriveMode;
  /** The current vehicle has a Manual Drive plant (a car with handling data). */
  available: boolean;
  /** Source of the last latched intent; null in auto. */
  source: DriveSource | null;
  /** CG ground point in the sim world frame (m) and yaw (rad, CCW from +X, wrapped to (-pi, pi]). */
  x: number;
  y: number;
  yaw: number;
  /** Body-frame CG velocity, m/s: u forward, v left. */
  u: number;
  v: number;
  /** Sideslip at the CG, rad: atan2(v, |u|); 0 below 1 m/s. */
  beta: number;
  /** Conditioned demands actually applied this step (post aids): steer -1..1 (+ left), pedals 0..1. */
  steerDemand: number;
  throttle: number;
  brake: number;
  handbrake: number;
  /** -1 reverse, 0 neutral, 1..n forward gear. */
  gear: number;
  engineRpm: number;
  /** An aid intervened during the last step. */
  absActive: boolean;
  tractionActive: boolean;
  stabilityActive: boolean;
  aids: DriveAids;
  /** Ground under the CG: 'loop', 'terrain', 'field' or a WorldDefinition zone id. */
  zone: string;
  /** Offset from the driving line (m, + left) and heading error (rad); NaN off the loop corridor. */
  lineOffset: number;
  headingError: number;
  /** Simulated seconds since the last non-neutral latched intent (0 in auto). */
  idle: number;
  /** Outside the model's validated domain: |ay| > 0.85 mu g, |beta| > 10 deg or |slip ratio| > 0.3 on any wheel. */
  approximate: boolean;
  /** The lap clock left the shared live lap with the last manual excursion (cleared by a live seek). */
  detached: boolean;
  /** Last-good-state restores since the simulation was created (NaN containment). */
  faults: number;
}

export function createDriveFrame(): DriveFrame {
  return {
    mode: 'auto',
    available: false,
    source: null,
    x: 0,
    y: 0,
    yaw: 0,
    u: 0,
    v: 0,
    beta: 0,
    steerDemand: 0,
    throttle: 0,
    brake: 0,
    handbrake: 0,
    gear: 0,
    engineRpm: 0,
    absActive: false,
    tractionActive: false,
    stabilityActive: false,
    aids: DEFAULT_AIDS,
    zone: 'loop',
    lineOffset: Number.NaN,
    headingError: Number.NaN,
    idle: 0,
    approximate: false,
    detached: false,
    faults: 0,
  };
}

/** Discrete drive events (sim-core detectors), forwarded by the kernel as bus 'drive:event'. Never per frame. */
export type DriveEvent = { readonly simTime: number } & (
  | { readonly kind: 'mode'; readonly mode: DriveMode; readonly previous: DriveMode; readonly cut: boolean }
  | { readonly kind: 'reset'; readonly spawn: string | null }
  /** An axle went past its peak slip: front = understeer, rear = oversteer. `lift` = throttle released < 0.5 s before. */
  | { readonly kind: 'slide'; readonly axle: AxleId; readonly lift: boolean }
  | { readonly kind: 'lockup'; readonly corner: number }
  | { readonly kind: 'wheelspin'; readonly corner: number }
  | { readonly kind: 'aid'; readonly aid: 'abs' | 'traction' | 'stability' }
  /** A wheel struck a kerb (`kerb`) or a bump: a fast compression well above its recent travel (11-05). */
  | { readonly kind: 'strike'; readonly corner: number; readonly kerb: boolean }
  /** Braking from `from` m/s to a standstill with a high mean deceleration (11-05). */
  | { readonly kind: 'hard-stop'; readonly from: number }
  | { readonly kind: 'zone'; readonly zone: string; readonly entered: boolean }
  | { readonly kind: 'out-of-bounds' }
  /** Returning reached the driving line and the simulation latched back to auto. */
  | { readonly kind: 'converged' }
  | { readonly kind: 'fault'; readonly count: number }
);

/** Mode-change and run control the simulation exposes (Simulation.drive). Only the kernel calls request/reset/play. */
export interface DriveControl {
  /** The current vehicle has a plant. */
  readonly available: boolean;
  readonly mode: DriveMode;
  /** Latest-wins device intent (features: the DRIVE service owner only). Ignored outside manual. */
  setIntent(intent: Readonly<DriveIntent>): void;
  /** Applied at the next fixed step. 'auto' from manual = returning; with `immediate` = release now (a cut). */
  request(mode: 'auto' | 'manual', immediate?: boolean): void;
  setAids(aids: DriveAids): void;
  /** Manual only: at rest on the nearest driving-line point (or a station spawn), heading along the line. */
  reset(spawn?: string): void;
  /** Start replaying from the recorded start state (mode 'replay'). False if the replay does not fit this simulation. */
  play(replay: DecodedReplay): boolean;
  /** The current manual or replay run since it started (newest REPLAY_LIMITS.maxSeconds), or null in auto. */
  recording(): DecodedReplay | null;
  /** Delivers and clears events queued since the last call (the kernel calls it once per render frame). */
  drainEvents(handler: (event: DriveEvent) => void): void;
}

// ---------------------------------------------------------------- replay format

export const REPLAY_FORMAT = 1;

export const REPLAY_LIMITS = {
  /** Longest run kept by the recorder, s. */
  maxSeconds: 600,
  /** Runs up to this long are shared in the URL fragment; longer ones go to the server. */
  fragmentSeconds: 60,
  /** Fixed steps between keyframe checksums (5 s). */
  keyframeTicks: 1200,
  /** Encoded and compressed size cap, bytes. */
  maxBytes: 65536,
} as const;

export interface ReplayHeader {
  readonly format: typeof REPLAY_FORMAT;
  /** APP_VERSION of the build that recorded it. */
  readonly simVersion: string;
  /** Hash (8 hex) of the vehicle, suspension and world definitions used (sim-core replay/format.ts). */
  readonly paramsHash: string;
  readonly trackId: string;
  readonly worldId: string | null;
  readonly vehicleId: string;
  readonly suspensionId: string;
  /** Fixed steps recorded (240 Hz). */
  readonly ticks: number;
}

export interface ReplayEventRecord {
  readonly tick: number;
  readonly kind: 'suspension' | 'aids' | 'reset';
  /** Suspension id; aids as 'abs,traction,stability,steering' subset; reset spawn id or ''. */
  readonly value: string;
}

export interface DecodedReplay {
  readonly header: ReplayHeader;
  /** Plant + ride state at tick 0 (sim-core PLANT_SNAPSHOT layout, float64). */
  readonly start: Float64Array;
  /** One latched intent per CONTROL_TICKS steps, 5 integers each: steer (+-INTENT_QUANT.steer), throttle, brake,
   * handbrake (0..INTENT_QUANT.pedal), flags (bit 0 digital, bits 1-3 DRIVE_SOURCES index). */
  readonly intents: Int16Array;
  readonly events: readonly ReplayEventRecord[];
  /** CRC32 of the rounded state every REPLAY_LIMITS.keyframeTicks steps (divergence detection). */
  readonly keyframes: Uint32Array;
}
