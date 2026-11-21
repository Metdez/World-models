import type { ComponentRole, VehicleClass } from './suspension';

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

// ---------------------------------------------------------------- Manual Drive (M2): REPRESENTATIVE model inputs

/** Simplified Magic Formula tyre for the plant (research m2/04). Peak mu, its load sensitivity and the camber loss
 * come from TyreParams (the same peakMu() as Auto); these add the slip behaviour. Model values, never data. */
export interface TyreHandling {
  /** Cornering stiffness per unit load at nominal load, 1/rad (C_alpha / Fz). */
  readonly corneringStiffness: number;
  /** Longitudinal slip stiffness per unit load at nominal load (C_kappa / Fz). */
  readonly slipStiffness: number;
  /** Load shape k: C(Fz) = C0 * g(Fz / (k * Fz0)) / g(1 / k) with g(x) = 2x / (1 + x^2) (= sin(2 atan x)). */
  readonly stiffnessLoadShape: number;
  /** Magic Formula shape C and curvature E of the one normalised combined-slip curve. */
  readonly shape: number;
  readonly curvature: number;
  /** Camber stiffness / cornering stiffness (equivalent slip per unit inclination). */
  readonly camberRatio: number;
  /** Relaxation lengths of the contact-patch deflection states, m. */
  readonly relaxationLateral: number;
  readonly relaxationLongitudinal: number;
  /** Rotating inertia of wheel, tyre, hub and brake disc, kg m^2. */
  readonly wheelInertia: number;
}

export interface CarPowertrain {
  /** Full-throttle engine torque (N m) at rpm knots (ascending), linear between knots. */
  readonly torqueCurve: { readonly rpm: readonly number[]; readonly torque: readonly number[] };
  readonly idleRpm: number;
  readonly redlineRpm: number;
  /** Closed-throttle engine braking torque = a + b * rpm, N m. */
  readonly frictionTorque: readonly [a: number, b: number];
  /** Engine + flywheel + converter rotating inertia, kg m^2 (reflected to the driven wheels through the ratio). */
  readonly engineInertia: number;
  /** Forward ratios (first gear first), reverse ratio (> 0), final drive, driveline efficiency. */
  readonly gears: readonly number[];
  readonly reverse: number;
  readonly finalDrive: number;
  readonly efficiency: number;
  /** Automatic shift: torque cut, ramp back and lockout (s); upshift rpm at light and full throttle; downshift rpm. */
  readonly shift: { readonly cut: number; readonly ramp: number; readonly lockout: number };
  readonly upshiftRpm: readonly [light: number, full: number];
  readonly downshiftRpm: number;
  /** Speed-sensitive limited-slip ratio of the driven axle (Jolt form); Infinity = open differential. */
  readonly limitedSlipRatio: number;
  /** Reverse: speed cap (m/s) and throttle scale. */
  readonly reverseSpeedCap: number;
  readonly reverseThrottle: number;
}

export interface CarBrakes {
  /** Total brake torque at full pedal, N m, split by each CarAxleSpec.brakeShare. */
  readonly maxTorque: number;
  /** Rear-axle handbrake torque at full lever, N m. */
  readonly handbrakeTorque: number;
}

export interface CarSteering {
  /** Steering actuator: first-order lag (s) and road-wheel rate limit (rad/s). */
  readonly lag: number;
  readonly rate: number;
}

/** Elastokinematics (research m2/23): ONE shared role-based bushing table for every suspension type. */
export interface CarCompliance {
  /** Axial stiffness of a link's chassis-side bushing (N/m) by component role; strut = top-mount radial rate. */
  readonly bushingRates: Readonly<Partial<Record<ComponentRole, number>>>;
  /** Clamp on compliance toe and camber, rad. */
  readonly maxAngle: number;
  /** First-order filter on the compliance angles, s. */
  readonly filter: number;
}

export interface CarHandling {
  readonly tyres: { readonly front: TyreHandling; readonly rear: TyreHandling };
  readonly powertrain: CarPowertrain;
  readonly brakes: CarBrakes;
  readonly steering: CarSteering;
  readonly compliance: CarCompliance;
}

export interface CarDefinition extends VehicleBase {
  readonly class: 'car';
  readonly front: CarAxleSpec;
  readonly rear: CarAxleSpec;
  /** Max road-wheel steer angle, rad (Ackermann applied by sim-core). */
  readonly maxSteer: number;
  /** Manual Drive plant inputs (M2). Absent = this car is Auto-only. */
  readonly handling?: CarHandling;
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
