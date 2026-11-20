import type { SuspensionDefinition, VehicleKinematics } from './suspension';
import type { TelemetryFrame } from './telemetry';
import type { BuiltTrack, TrackDefinition } from './track';
import type { VehicleDefinition } from './vehicle';

/** Lookup the simulation uses to resolve ids (the kernel passes registry getters). */
export interface SimCatalog {
  track(id: string): TrackDefinition | undefined;
  vehicle(id: string): VehicleDefinition | undefined;
  suspension(id: string): SuspensionDefinition | undefined;
}

export interface SimulationOptions {
  readonly catalog: SimCatalog;
  readonly trackId: string;
  readonly vehicleId: string;
  readonly suspensionId: string;
  /** Initial lap time, s (default 0). */
  readonly lapTime?: number;
}

/** Kinematic path state: a PURE function of lap time for a given (track, vehicle). Suspension-independent. */
export interface PathState {
  lapTime: number;
  /** m along centreline. */
  s: number;
  /** Driving-line lateral offset, m (+ left). */
  l: number;
  /** m/s. */
  v: number;
  /** m/s^2 (path tangent / normal, + forward / + left). */
  ax: number;
  ay: number;
  /** Curvature of the driving line (centreline curvature + offset correction), 1/m. */
  curvature: number;
  /** Heading of the driving line, rad. */
  heading: number;
  /** World position of the driving line on the road surface at (s, l) (sim frame). */
  x: number;
  y: number;
  z: number;
  bank: number;
  grade: number;
  sectionIndex: number;
}

export type SimEvent =
  | { readonly kind: 'lap'; readonly lap: number; readonly duration: number }
  | { readonly kind: 'section'; readonly index: number; readonly id: string }
  | { readonly kind: 'bump-stop'; readonly corner: number }
  | { readonly kind: 'liftoff'; readonly corner: number }
  | { readonly kind: 'grip-limit'; readonly corner: number };

export interface Simulation {
  readonly track: BuiltTrack;
  readonly vehicle: VehicleDefinition;
  readonly suspension: SuspensionDefinition;
  /** Duration of one lap for the current vehicle, s (speed profile; identical for all suspension types). */
  readonly lapDuration: number;
  /** Lap time of the CURRENT fixed step, s. */
  readonly lapTime: number;
  readonly simTime: number;

  /** Advance exactly one fixed step. The kernel always passes SIM_DT; determinism is guaranteed only for SIM_DT. */
  step(dt: number): void;
  /**
   * Interpolate between the previous and current fixed step (alpha in [0,1]) and evaluate kinematics.
   * Returns the simulation-owned preallocated frame (valid until the next sample()/setVehicle()).
   * `amplification` (>= 1) scales roll, pitch, heave and wheel travel in POSE fields only.
   */
  sample(alpha: number, amplification?: number): TelemetryFrame;
  /** Swap suspension (same vehicle class). Path position is kept; ride state continues. Throws on class mismatch. */
  setSuspension(id: string): void;
  /** Swap vehicle (+ optional suspension, default vehicle.defaultSuspension). Allocates a new frame; keeps lap phase fraction. */
  setVehicle(id: string, suspensionId?: string): void;
  /** Jump to lap time: path set from stateAt(), ride model initialised at equilibrium and pre-rolled for SEEK_SETTLE_S. */
  seek(lapTime: number): void;
  /** PURE: path state at a lap time (no side effects). Same answer on every device for the same vehicle. */
  stateAt(lapTime: number, out: PathState): PathState;
  /** PURE inverse: lap time at which the driving line passes arc length s (e.g. a section start). */
  lapTimeAt(s: number): number;
  /** Precomputed curves + design summaries for the current suspension on the current vehicle. */
  kinematics(): VehicleKinematics;
  /** World points (pointOrder of that corner) at ZERO travel with the current body pose and steer: the "ghost" rest pose. */
  restPose(cornerIndex: number, out: Float64Array): Float64Array;
  /** Delivers and clears events queued since the last call (kernel calls once per render frame). */
  drainEvents(handler: (event: SimEvent) => void): void;
}

export type CreateSimulation = (options: SimulationOptions) => Simulation;

/** Ride-model pre-roll after seek(), s. */
export const SEEK_SETTLE_S = 1.5;
