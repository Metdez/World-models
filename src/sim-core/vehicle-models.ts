/** Vehicle model seam (ARCHITECTURE §7.2.4): simulation.ts owns time and path, a model owns dynamics + kinematics. */
import type { PathState, SimEvent } from '../contracts/sim';
import type { SuspensionDefinition, VehicleClass, VehicleKinematics } from '../contracts/suspension';
import type { CornerLayout, TelemetryFrame } from '../contracts/telemetry';
import type { BuiltTrack } from '../contracts/track';
import type { VehicleDefinition } from '../contracts/vehicle';
import { createCarModel } from './car/car-model';
import { createMotoModel } from './moto/model';

export interface VehicleModel {
  readonly corners: readonly CornerLayout[];
  readonly kinematics: VehicleKinematics;
  /** Static equilibrium at a path state. */
  reset(path: PathState): void;
  /** One fixed step; `path` is the state at the END of the step. Push events into `events`. */
  step(dt: number, path: PathState, events: SimEvent[]): void;
  /** Interpolated write of TRUE + POSE fields into `out` (no allocation). */
  sample(alpha: number, amplification: number, path: PathState, out: TelemetryFrame): void;
  restPose(corner: number, path: PathState, out: Float64Array): Float64Array;
  /** Swap geometry tables + extras. Throws on class mismatch. */
  setSuspension(suspension: SuspensionDefinition): void;
}

export type CreateVehicleModel = (vehicle: VehicleDefinition, suspension: SuspensionDefinition, track: BuiltTrack) => VehicleModel;

export const VEHICLE_MODELS: Record<VehicleClass, CreateVehicleModel> = { car: createCarModel, motorcycle: createMotoModel };
