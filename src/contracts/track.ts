import type { XYZ } from './units';

/** Plan-view primitives, integrated in order. Curvature/angle sign: + = LEFT (CCW). */
export type TrackPrimitive =
  | { readonly kind: 'line'; readonly length: number }
  | { readonly kind: 'arc'; readonly radius: number; readonly angle: number }
  | { readonly kind: 'clothoid'; readonly length: number; readonly k0: number; readonly k1: number };

/** ISO 8608 roughness class of a segment (A smooth .. D poor). Generated deterministically from TrackDefinition.seed. */
export type RoughnessClass = 'A' | 'B' | 'C' | 'D';

/**
 * Closed-form road features. `s` is measured from the START of the owning segment (m);
 * lateral offsets l are + LEFT of centreline (m). Heights in m (+ up).
 */
export type RoadFeature =
  | { readonly kind: 'cosine-bump'; readonly s: number; readonly length: number; readonly height: number; readonly lateral: readonly [l0: number, l1: number] }
  | { readonly kind: 'pothole'; readonly s: number; readonly l: number; readonly radius: number; readonly depth: number }
  | { readonly kind: 'kerb-strike'; readonly s: number; readonly length: number; readonly height: number; readonly side: 'left' | 'right' }
  | { readonly kind: 'washboard'; readonly s: number; readonly length: number; readonly amplitude: number; readonly wavelength: readonly [start: number, end: number] }
  | { readonly kind: 'pave'; readonly s: number; readonly length: number; readonly stone: number; readonly amplitude: number; readonly jointDepth: number }
  | { readonly kind: 'humps'; readonly s: number; readonly count: number; readonly spacing: number; readonly length: number; readonly height: number }
  /** + height = crest, - height = dip (raised-cosine vertical profile). */
  | { readonly kind: 'vertical-curve'; readonly s: number; readonly length: number; readonly height: number };

/** The single suspension phenomenon a section showcases (drives insights, director shots, AI context). */
export type Phenomenon =
  | 'ride-resonance'
  | 'brake-dive'
  | 'steering-lock'
  | 'single-wheel-bump'
  | 'sustained-roll'
  | 'harshness'
  | 'roll-reversal'
  | 'heave'
  | 'steady-state-roll'
  | 'lane-change'
  | 'off-camber'
  | 'settle';

export type TrackProp = { readonly kind: 'cone'; readonly s: number; readonly l: number } | { readonly kind: 'start-line'; readonly s: number };

export interface TrackSegmentDefinition {
  /** Stable id, kebab-case; used in URLs, AI tool enums and analytics. */
  readonly id: string;
  /** Display name, e.g. "Chicane". */
  readonly name: string;
  readonly primitives: readonly TrackPrimitive[];
  readonly phenomenon: Phenomenon;
  /** One-line caption, no numbers. */
  readonly caption: string;
  /** Section bank (rad, + left edge up). Ramps linearly over a leading/trailing clothoid if present. */
  readonly bank?: number;
  readonly roughness: RoughnessClass;
  readonly features?: readonly RoadFeature[];
  /** Optional speed cap for the autopilot in this section, m/s. */
  readonly targetSpeed?: number;
  /**
   * Driving-line lateral offset knots [s from segment start, l (m, + left)], cosine-interpolated between knots;
   * 0 before the first and after the last knot. Used for the lane change and the kerb clip.
   */
  readonly line?: readonly (readonly [s: number, l: number])[];
  /** Props; `s` relative to segment start. */
  readonly props?: readonly TrackProp[];
}

export interface TrackDefinition {
  readonly id: string;
  readonly name: string;
  /** Asphalt width, kerb width each side, runoff width each side (m). */
  readonly width: number;
  readonly kerbWidth: number;
  readonly runoff: number;
  readonly segments: readonly TrackSegmentDefinition[];
  /** Ids of two segments whose single 'line' primitive length is solved so the loop closes in position. */
  readonly closure: readonly [string, string];
  /** Gentle macro elevation: z += amplitude * sin(2*pi*cycles*s/length). */
  readonly swell: { readonly amplitude: number; readonly cycles: number };
  /** Seed for ISO 8608 roughness and pave stones (deterministic: renderer == physics == every device). */
  readonly seed: number;
  readonly visualKey: string;
}

export interface TrackSample {
  s: number;
  /** Centreline world position (z = road height at l = 0). */
  x: number;
  y: number;
  z: number;
  heading: number;
  curvature: number;
  bank: number;
  /** dz/ds of the centreline. */
  grade: number;
}

export interface BuiltSection {
  readonly index: number;
  readonly id: string;
  readonly s0: number;
  readonly s1: number;
  readonly def: TrackSegmentDefinition;
}

/** Runtime track produced by sim-core `buildTrack(def)`. Pure, deterministic; shared by physics and mesh generation. */
export interface BuiltTrack {
  readonly def: TrackDefinition;
  /** Closed loop length, m. All `s` inputs are wrapped modulo length. */
  readonly length: number;
  readonly sections: readonly BuiltSection[];
  /** Props resolved to absolute s. */
  readonly props: readonly TrackProp[];
  sectionIndexAt(s: number): number;
  sample(s: number, out: TrackSample): TrackSample;
  /** Driving-line lateral offset at s (m, + left). */
  lineOffset(s: number): number;
  /** World z of the road surface at (s, l): elevation + bank + roughness + features + kerbs. Single source of truth. */
  roadHeight(s: number, l: number): number;
  /** World position of the road surface point at (s, l). */
  toWorld(s: number, l: number, out: XYZ): XYZ;
}
