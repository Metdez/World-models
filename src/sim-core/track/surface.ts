/**
 * The analytic road surface (research 11 §A.4), single source of truth for physics and mesh generation.
 * Macro elevation = swell + vertical curves (smooth: this is what TrackSample.z / grade report);
 * roadHeight adds bank, ISO 8608 roughness (class blended across section boundaries) and closed-form features.
 * All functions take a wrapped s in [0, length) plus its section index, and allocate nothing.
 */
import type { BuiltSection, RoadFeature, TrackDefinition } from '../../contracts/track';
import { lerp } from '../math/interp';
import { primitiveLength } from './closure';
import { featureHeight, verticalCurveGrade, verticalCurveZ, type RoadEdges } from './features';
import { classScale, createRoughness } from './iso8608';

/** Half-length of the linear roughness-class blend around each section boundary, m. */
const CLASS_BLEND = 5;

export interface Surface {
  elevation(s: number, section: number): number;
  grade(s: number, section: number): number;
  bank(s: number, section: number): number;
  roadHeight(s: number, l: number, section: number): number;
}

type VerticalCurve = Extract<RoadFeature, { kind: 'vertical-curve' }>;

export function createSurface(def: TrackDefinition, sections: readonly BuiltSection[], length: number): Surface {
  const n = sections.length;
  const roughness = createRoughness(length, def.seed);
  const edges: RoadEdges = { halfWidth: def.width / 2, kerbWidth: def.kerbWidth, seed: def.seed };
  const scale = sections.map((sec) => classScale(sec.def.roughness));
  const curves = sections.map((sec) => (sec.def.features ?? []).filter((f): f is VerticalCurve => f.kind === 'vertical-curve'));
  const bumps = sections.map((sec) => (sec.def.features ?? []).filter((f) => f.kind !== 'vertical-curve'));
  // Bank ramps linearly over a leading / trailing clothoid (contracts/track.ts).
  const ramps = sections.map((sec) => {
    const p = sec.def.primitives;
    const first = p[0];
    const last = p[p.length - 1];
    return {
      bank: sec.def.bank ?? 0,
      rampIn: first?.kind === 'clothoid' ? primitiveLength(first) : 0,
      rampOut: last?.kind === 'clothoid' ? primitiveLength(last) : 0,
    };
  });
  const swellK = (2 * Math.PI * def.swell.cycles) / length;

  const surface: Surface = {
    elevation(s, i) {
      let z = def.swell.amplitude * Math.sin(swellK * s);
      const x = s - sections[i]!.s0;
      const c = curves[i]!;
      for (let j = 0; j < c.length; j++) z += verticalCurveZ(c[j]!, x);
      return z;
    },
    grade(s, i) {
      let g = def.swell.amplitude * swellK * Math.cos(swellK * s);
      const x = s - sections[i]!.s0;
      const c = curves[i]!;
      for (let j = 0; j < c.length; j++) g += verticalCurveGrade(c[j]!, x);
      return g;
    },
    bank(s, i) {
      const r = ramps[i]!;
      if (r.bank === 0) return 0;
      const sec = sections[i]!;
      const x = s - sec.s0;
      const y = sec.s1 - s;
      let f = 1;
      if (r.rampIn > 0 && x < r.rampIn) f = x / r.rampIn;
      if (r.rampOut > 0 && y < r.rampOut) f = Math.min(f, y / r.rampOut);
      return r.bank * f;
    },
    roadHeight(s, l, i) {
      const sec = sections[i]!;
      const x = s - sec.s0;
      let k = scale[i]!;
      if (x < CLASS_BLEND) k = lerp(scale[(i + n - 1) % n]!, k, 0.5 + x / (2 * CLASS_BLEND));
      else if (sec.s1 - s < CLASS_BLEND) k = lerp(k, scale[(i + 1) % n]!, 0.5 - (sec.s1 - s) / (2 * CLASS_BLEND));
      let h = surface.elevation(s, i) + l * Math.tan(surface.bank(s, i)) + k * roughness.at(s, l);
      const b = bumps[i]!;
      for (let j = 0; j < b.length; j++) h += featureHeight(b[j]!, x, l, edges);
      return h;
    },
  };
  return surface;
}
