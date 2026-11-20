import type { VehicleClass } from './suspension';

export interface TyreParams {
  /** Unloaded radius, m. */
  readonly radius: number;
  readonly width: number;
  /** N/m. */
  readonly verticalStiffness: number;
  /** N*s/m. */
  readonly verticalDamping: number;
  /** Peak friction coefficient at nominalLoad. */
  readonly mu: number;
  /** d(mu)/d(Fz), 1/N (negative). */
  readonly loadSensitivity: number;
  /** N. */
  readonly nominalLoad: number;
  /** Motorcycle only: tyre crown radius, m (lean correction). */
  readonly crownRadius?: number;
}

/** Inputs to the friction-limited speed profile (identical for every suspension type of a vehicle). */
export interface DrivingLimits {
  /** Max lateral acceleration used by the autopilot, m/s^2 (already includes driver margin). */
  readonly lateral: number;
  /** Max longitudinal acceleration, m/s^2. */
  readonly accel: number;
  /** Max braking deceleration (positive number), m/s^2. */
  readonly brake: number;
  /** Speed cap, m/s. */
  readonly vMax: number;
}

interface VehicleBase {
  readonly id: string;
  readonly class: VehicleClass;
  /** e.g. "GT coupe". Never a manufacturer claim. */
  readonly name: string;
  /** e.g. "Representative parameters". */
  readonly subtitle: string;
  /** Key into Registries.vehicleVisuals. */
  readonly visualKey: string;
  /** Total mass incl. driver/rider, kg. */
  readonly mass: number;
  readonly sprungMass: number;
  /** Static sprung CG height above ground, m. */
  readonly cgHeight: number;
  /** Sprung-body inertias about the CG, kg*m^2. */
  readonly inertia: { readonly roll: number; readonly pitch: number; readonly yaw: number };
  /** m. */
  readonly wheelbase: number;
  /** Horizontal distance CG -> front axle, m (rear = wheelbase - cgToFront). */
  readonly cgToFront: number;
  readonly limits: DrivingLimits;
  /** Drag area Cd*A, m^2. */
  readonly dragArea: number;
  /** Suspension definition ids allowed for this vehicle, in UI order. */
  readonly suspensions: readonly string[];
  readonly defaultSuspension: string;
}

export interface CarAxleSpec {
  /** Wheel-centre to wheel-centre, m. Must match the visual model. */
  readonly track: number;
  /** Baseline unsprung mass per corner, kg (suspension extras add a delta). */
  readonly unsprungMass: number;
  /** Target body ride frequency at this axle, Hz (wheel rate derived from it; identical across suspension types). */
  readonly rideFrequency: number;
  /** Damping ratios at the wheel. */
  readonly damping: { readonly bump: number; readonly rebound: number };
  /** Anti-roll-bar roll stiffness for the axle, N*m/rad. */
  readonly antiRollStiffness: number;
  readonly tyre: TyreParams;
  readonly steered: boolean;
  readonly driven: boolean;
  /** Fraction of total braking force on this axle (front + rear = 1). */
  readonly brakeShare: number;
}

export interface CarDefinition extends VehicleBase {
  readonly class: 'car';
  readonly front: CarAxleSpec;
  readonly rear: CarAxleSpec;
  /** Max road-wheel steer angle, rad (Ackermann applied by sim-core). */
  readonly maxSteer: number;
}

export interface MotoEndSpec {
  readonly tyre: TyreParams;
  readonly brakeShare: number;
  readonly driven: boolean;
}

export interface MotorcycleDefinition extends VehicleBase {
  readonly class: 'motorcycle';
  readonly front: MotoEndSpec;
  readonly rear: MotoEndSpec;
  /** Chain geometry for anti-squat: gearbox sprocket centre (vehicle frame) and radii, m. */
  readonly chain: {
    readonly sprocketCentre: readonly [x: number, z: number];
    readonly frontRadius: number;
    readonly rearRadius: number;
  };
}

export type VehicleDefinition = CarDefinition | MotorcycleDefinition;
