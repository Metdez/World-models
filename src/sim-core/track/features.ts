/**
 * Closed-form road features (research 11 §A.4). `x` is metres from the owning segment start, `l` the lateral
 * offset (+ left). All shapes have zero height and slope at their edges unless noted, so wheels see no steps.
 */
import type { RoadFeature } from '../../contracts/track';
import { hashFloat } from '../math/rng';
import { smoothstep } from '../math/interp';

/** Soft lateral edge of a one-sided bump, inside its [l0, l1] band (m). */
const BUMP_EDGE = 0.15;
/** Kerb-strike lateral ramp (about 45 deg at typical heights) and longitudinal ramp-in/out, m. */
const KERB_RAMP_L = 0.06;
const KERB_RAMP_S = 0.5;
/** Washboard amplitude taper at both ends, m. */
const WASHBOARD_TAPER = 1;
/** Pave stone edge bevel down into the joint, m; whole-strip taper at both ends, m. */
const PAVE_BEVEL = 0.015;
const PAVE_TAPER = 0.3;

const TAU = 2 * Math.PI;

/** Raised cosine 0 -> h -> 0 over [0, len]. */
const raisedCosine = (u: number, len: number, h: number): number => (u <= 0 || u >= len ? 0 : 0.5 * h * (1 - Math.cos((TAU * u) / len)));

export interface RoadEdges {
  /** Half asphalt width and kerb width, m. */
  readonly halfWidth: number;
  readonly kerbWidth: number;
  readonly seed: number;
}

/** Height (m) of one feature at (x, l). Vertical curves belong to the macro elevation and return 0 here. */
export function featureHeight(f: RoadFeature, x: number, l: number, edges: RoadEdges): number {
  switch (f.kind) {
    case 'cosine-bump': {
      const l0 = f.lateral[0];
      const l1 = f.lateral[1];
      if (l <= l0 || l >= l1) return 0;
      const w = smoothstep(l0, l0 + BUMP_EDGE, l) * (1 - smoothstep(l1 - BUMP_EDGE, l1, l));
      return raisedCosine(x - f.s, f.length, f.height) * w;
    }
    case 'pothole': {
      const dx = x - f.s;
      const dl = l - f.l;
      const q = 1 - (dx * dx + dl * dl) / (f.radius * f.radius);
      return q <= 0 ? 0 : -f.depth * q * Math.sqrt(q);
    }
    case 'kerb-strike': {
      const u = x - f.s;
      if (u <= 0 || u >= f.length) return 0;
      const a = f.side === 'left' ? l : -l;
      const inner = edges.halfWidth;
      const outer = edges.halfWidth + edges.kerbWidth;
      if (a <= inner || a >= outer) return 0;
      const w = smoothstep(inner, inner + KERB_RAMP_L, a) * (1 - smoothstep(outer - KERB_RAMP_L, outer, a));
      return f.height * w * smoothstep(0, KERB_RAMP_S, u) * smoothstep(0, KERB_RAMP_S, f.length - u);
    }
    case 'washboard': {
      const u = x - f.s;
      if (u <= 0 || u >= f.length) return 0;
      const w0 = f.wavelength[0];
      const w1 = f.wavelength[1];
      // Linear wavelength chirp: phase = 2 pi * integral(du / lambda(u)).
      const phase = w1 === w0 ? (TAU * u) / w0 : ((TAU * f.length) / (w1 - w0)) * Math.log((w0 + ((w1 - w0) * u) / f.length) / w0);
      return f.amplitude * Math.sin(phase) * smoothstep(0, WASHBOARD_TAPER, u) * smoothstep(0, WASHBOARD_TAPER, f.length - u);
    }
    case 'pave': {
      const u = x - f.s;
      if (u <= 0 || u >= f.length) return 0;
      const i = Math.floor(u / f.stone);
      const j = Math.floor(l / f.stone);
      const du = u - i * f.stone;
      const dl = l - j * f.stone;
      const d = Math.min(du, f.stone - du, dl, f.stone - dl);
      const w = smoothstep(0, PAVE_BEVEL, d);
      const stone = f.amplitude * (2 * hashFloat(edges.seed, i, j) - 1);
      return (stone * w - f.jointDepth * (1 - w)) * smoothstep(0, PAVE_TAPER, u) * smoothstep(0, PAVE_TAPER, f.length - u);
    }
    case 'humps': {
      let h = 0;
      for (let k = 0; k < f.count; k++) h += raisedCosine(x - f.s - k * f.spacing, f.length, f.height);
      return h;
    }
    case 'vertical-curve':
      return 0;
  }
}

/** Macro elevation of a vertical-curve feature (raised cosine; + crest, - dip) and its slope. */
export const verticalCurveZ = (f: Extract<RoadFeature, { kind: 'vertical-curve' }>, x: number): number => raisedCosine(x - f.s, f.length, f.height);
export function verticalCurveGrade(f: Extract<RoadFeature, { kind: 'vertical-curve' }>, x: number): number {
  const u = x - f.s;
  return u <= 0 || u >= f.length ? 0 : ((f.height * Math.PI) / f.length) * Math.sin((TAU * u) / f.length);
}
