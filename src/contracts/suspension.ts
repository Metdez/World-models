import type { AxleId, Vec3 } from './units';

export type VehicleClass = 'car' | 'motorcycle';

/** Semantic part roles. Used for colour coding, highlighting, labels and the AI highlight tool. */
export type ComponentRole =
  | 'upper-arm'
  | 'lower-arm'
  | 'lateral-link'
  | 'trailing-link'
  | 'tie-rod'
  | 'strut'
  | 'spring'
  | 'damper'
  | 'upright'
  | 'anti-roll-bar'
  | 'fork'
  | 'swingarm'
  | 'linkage'
  | 'tyre';

/**
 * One colour per role, identical across every suspension type and both vehicle classes.
 * sRGB hex for THREE.Color (converted to linear on set). Rubber/bushings use RUBBER_COLOR; brake parts BRAKE_COLORS.
 */
export const COMPONENT_COLORS: Readonly<Record<ComponentRole, number>> = {
  'upper-arm': 0xb8a1ff,
  'lower-arm': 0xc5c9d0,
  'lateral-link': 0x8e9aaf,
  'trailing-link': 0x8e9aaf,
  'tie-rod': 0xd4782a,
  strut: 0x2f62b0,
  spring: 0xe2c114,
  damper: 0x2f62b0,
  upright: 0x3ec8d8,
  'anti-roll-bar': 0xc43333,
  fork: 0xd9b45a,
  swingarm: 0x3a3e46,
  linkage: 0x8e9aaf,
  tyre: 0x14161a,
};
export const RUBBER_COLOR = 0x2c2f34;
export const BRAKE_COLORS = { disc: 0x5a5e66, caliper: 0xb3262a } as const;

/** Qualitative tendency used for non-computable tradeoffs (cost, packaging). Never shown as a number. */
export type Tendency = 'lower' | 'medium' | 'higher';

/** User-facing copy. RULE: no digits/measurements in any string (enforced by test); numbers come from the sim. */
export interface SuspensionCopy {
  /** Segmented-control label, e.g. "Double wishbone". */
  readonly label: string;
  /** Mobile label, e.g. "Wishbone". */
  readonly short: string;
  /** One line under the selection, <= 60 chars. */
  readonly descriptor: string;
  /** Tendencies, worded as "typically ...". */
  readonly strengths: readonly string[];
  readonly costs: readonly string[];
  readonly qualitative: { readonly cost: Tendency; readonly packaging: Tendency; readonly complexity: Tendency };
}

export type PointName = string;

/**
 * Car linkage constraint on the upright (one rigid body, 6 DOF). A layout must supply exactly
 * 5 independent equations: each 'distance' is 1 equation, each 'strut' is 2.
 */
export type LinkConstraint =
  | {
      readonly kind: 'distance';
      readonly upright: PointName;
      readonly chassis: PointName;
      readonly role: ComponentRole;
      /** Constraints sharing a member name form one rigid arm (e.g. an A-arm = 2 distances to 1 ball joint). */
      readonly member: string;
    }
  | {
      /** MacPherson: chassis top mount must lie on the upright-fixed strut axis through `upright`. */
      readonly kind: 'strut';
      readonly upright: PointName;
      readonly chassis: PointName;
    };

export type SpringLowerMount =
  | { readonly on: 'upright'; readonly point: PointName }
  /** Point rigidly attached to an arm member; rotates about that member's chassis pivot axis. */
  | { readonly on: 'arm'; readonly member: string; readonly point: PointName }
  /** Point at `fraction` (0 = chassis end, 1 = upright end) along a single-rod member. */
  | { readonly on: 'link'; readonly member: string; readonly fraction: number };

export interface SpringMount {
  /** Chassis point (top mount). */
  readonly upper: PointName;
  readonly lower: SpringLowerMount;
}

/** One car axle's linkage. AXLE frame, LEFT side, metres (see units.ts). */
export interface AxleLinkage {
  /** All named points. MUST include 'wheelCentre'. */
  readonly points: Readonly<Record<PointName, Vec3>>;
  /** Names of points rigidly attached to the upright (MUST include 'wheelCentre'); all others are chassis or arm points. */
  readonly uprightPoints: readonly PointName[];
  readonly constraints: readonly LinkConstraint[];
  /** Chassis point displaced along +Y by rack travel (steered axle only). */
  readonly steer?: PointName;
  readonly spring: SpringMount;
  /** Drop-link pickup for the anti-roll bar visual (optional; physics uses vehicle ARB stiffness). */
  readonly antiRollBarMount?: { readonly member: string; readonly point: PointName };
  /** Static alignment at design ride height, rad (camber < 0 = top inboard; toe > 0 = toe-in). */
  readonly alignment: { readonly camber: number; readonly toe: number };
  /** Usable wheel travel magnitudes from design ride height, m (both > 0). Bump stops beyond. */
  readonly travel: { readonly bump: number; readonly droop: number };
}

interface SuspensionBase {
  readonly id: string;
  readonly copy: SuspensionCopy;
  /** Key into Registries.suspensionVisuals. */
  readonly visualKey: string;
}

export interface CarSuspensionDefinition extends SuspensionBase {
  readonly vehicleClass: 'car';
  readonly axles: { readonly front: AxleLinkage; readonly rear: AxleLinkage };
  /** Honest per-type extras. Springs/dampers/ARB targets come from the VEHICLE and are identical across types. */
  readonly extras: {
    /** Coulomb friction in the damper/strut, referred to the wheel, N (strut side-load stiction). */
    readonly damperFriction: number;
    /** Unsprung mass delta per corner vs the vehicle baseline, kg. */
    readonly unsprungMassDelta: number;
  };
}

export interface SpringSpec {
  /** N/m along the spring/shock axis. */
  readonly rate: number;
  /** N at full extension. */
  readonly preload: number;
  /** Optional second rate after `crossover` m of spring compression (dual-rate twin-shock springs). */
  readonly dualRate?: { readonly rate: number; readonly crossover: number };
  /** Progressive term p in F = k*x*(1 + p*(x/xmax)^2) (fork air spring). 0 = linear. */
  readonly progression: number;
}

export interface DamperSpec {
  /** N*s/m along the damper axis. */
  readonly bump: number;
  readonly rebound: number;
}

/** Motorcycle points are in the VEHICLE frame (x fwd, z up) at static ride height; y used only for visuals. */
export interface TelescopicFront {
  readonly kind: 'telescopic';
  /** true = USD (upside-down) fork. */
  readonly inverted: boolean;
  /** Steering-axis angle from vertical, rad. */
  readonly rake: number;
  /** Triple-clamp offset, m. */
  readonly offset: number;
  /** Steering-head (top) point on the steering axis. */
  readonly steeringHead: Vec3;
  readonly travel: number;
  readonly spring: SpringSpec;
  readonly damper: DamperSpec;
  /** Breakaway friction of the slider bushes, N along the fork axis. */
  readonly stiction: number;
  readonly unsprungMass: number;
  readonly stanchionDiameter: number;
}

export interface TeleleverFront {
  readonly kind: 'telelever';
  readonly rake: number;
  readonly offset: number;
  readonly steeringHead: Vec3;
  /** A-arm chassis pivot and its ball joint on the fork lower bridge. */
  readonly armPivot: Vec3;
  readonly armJoint: Vec3;
  /** Shock between chassis point and a point on the A-arm. */
  readonly shockTop: Vec3;
  readonly shockArm: Vec3;
  readonly travel: number;
  readonly spring: SpringSpec;
  readonly damper: DamperSpec;
  readonly unsprungMass: number;
}

export interface SwingarmRear {
  readonly kind: 'swingarm';
  readonly pivot: Vec3;
  readonly axle: Vec3;
  /** 2 = twin shock (one per side, y = +/-), 1 = single shock on the arm. */
  readonly shocks: 1 | 2;
  readonly singleSided: boolean;
  readonly shockTop: Vec3;
  readonly shockLower: Vec3;
  readonly travel: number;
  /** Per shock. */
  readonly spring: SpringSpec;
  readonly damper: DamperSpec;
  readonly unsprungMass: number;
}

export interface LinkageRear {
  readonly kind: 'swingarm-linkage';
  readonly pivot: Vec3;
  readonly axle: Vec3;
  readonly rockerPivot: Vec3;
  /** Dog-bone link from swingarm point to rocker point. */
  readonly swingarmLink: Vec3;
  readonly rockerLink: Vec3;
  /** Shock from chassis top to rocker point. */
  readonly rockerShock: Vec3;
  readonly shockTop: Vec3;
  readonly travel: number;
  readonly spring: SpringSpec;
  readonly damper: DamperSpec;
  readonly unsprungMass: number;
}

export interface MotorcycleSuspensionDefinition extends SuspensionBase {
  readonly vehicleClass: 'motorcycle';
  readonly front: TelescopicFront | TeleleverFront;
  readonly rear: SwingarmRear | LinkageRear;
}

export type SuspensionDefinition = CarSuspensionDefinition | MotorcycleSuspensionDefinition;

/**
 * Precomputed kinematic curves over wheel travel (computed by sim-core from the definition).
 * All arrays share `travel` as x-axis (ascending, m). Values body-relative, SI.
 */
export interface KinematicsCurves {
  readonly travel: Float64Array;
  /** rad. Motorcycle: zeros. */
  readonly camber: Float64Array;
  /** rad, + toe-in (bump steer). Motorcycle: zeros. */
  readonly toe: Float64Array;
  /** Kinematic roll-centre height above ground for symmetric travel, m. Motorcycle: NaN. */
  readonly rollCentreHeight: Float64Array;
  /** d(spring length)/d(wheel travel), > 0. Motorcycle rear: 1/leverage ratio. */
  readonly motionRatio: Float64Array;
  /** Contact-patch lateral change (car track change, m, + outward) / motorcycle: 0. */
  readonly lateral: Float64Array;
  /** Wheel-centre longitudinal change (m, + forward): car wheelbase change, motorcycle wheelbase change. */
  readonly longitudinal: Float64Array;
}

/** Design-point summary metrics per axle (SI). Used for tradeoff bars; all computed, never hand-typed. */
export interface AxleKinematicsSummary {
  /** d camber / d travel at design, rad/m (car). */
  readonly camberGain: number;
  /** Camber change per unit body roll (rad/rad), to ROAD (car). */
  readonly rollCamber: number;
  /** d toe / d travel at design, rad/m. */
  readonly bumpSteer: number;
  readonly rollCentreHeight: number;
  /** Roll-centre lateral migration for 2 deg body roll, m (car). */
  readonly rollCentreMigration: number;
  readonly kingpinInclination: number;
  readonly caster: number;
  readonly scrubRadius: number;
  readonly trail: number;
  /** Anti-dive (front) / anti-squat (rear) as a fraction (1 = 100 %). Negative = pro-dive. */
  readonly antiPitch: number;
  readonly motionRatio: number;
}

export interface AxleKinematics {
  readonly axle: AxleId;
  readonly curves: KinematicsCurves;
  readonly summary: AxleKinematicsSummary;
}

export type VehicleKinematics = Readonly<Record<AxleId, AxleKinematics>>;
