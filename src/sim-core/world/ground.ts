/**
 * GroundWorld (ARCHITECTURE-M2 §8.1): ONE analytic ground for the plant and the renderer. 08-02: the loop corridor
 * (projection onto the existing roadHeight) and the terrain; 10-02 adds world zones, the field and their bounds.
 * Loop corridor (|l| <= LOOP_CORRIDOR): h = track.roadHeight(s, l), base = swell(s) + l tan(bank(s)) (vertical curves,
 * roughness and features stay in h exactly as the M1 ride input sees them); surface bands by |l|. Between |l| 17.5 and
 * 18.5 h and base blend to the terrain. Pure; sample/project are allocation-free.
 */
import type { BuiltTrack, TrackSample } from '../../contracts/track';
import type { Frenet, GroundHit, GroundWorld, SurfaceKind, WorldDefinition } from '../../contracts/world';
import { wrap } from '../math/interp';
import { dsin, dtan } from '../math/det';
import { createProjectorCore } from './project';
import { loopTerrainHeight } from './terrain';

/** m: |l| of the drawn ribbon (width/2 + kerb + runoff of the proving loop). */
export const LOOP_CORRIDOR = 18;
/** m beyond the loop centreline (zones / field margins: 10-02). */
export const OUT_OF_BOUNDS = 60;
/** Half-width of the corridor-to-terrain blend around LOOP_CORRIDOR, m. */
const EDGE_BLEND = 0.5;
/** Asphalt apron beyond the kerb, m. */
const APRON = 2;

interface Bands {
  readonly half: number;
  readonly kerb: number;
  readonly apron: number;
  /** Absolute [s0, s1) spans of pave features (flattened pairs). */
  readonly pave: Float64Array;
}
const bandsByTrack = new WeakMap<BuiltTrack, Bands>();
function bandsFor(track: BuiltTrack): Bands {
  let b = bandsByTrack.get(track);
  if (!b) {
    const spans: number[] = [];
    for (const sec of track.sections)
      for (const f of sec.def.features ?? []) if (f.kind === 'pave') spans.push(sec.s0 + f.s, sec.s0 + f.s + f.length);
    const half = track.def.width / 2;
    b = { half, kerb: half + track.def.kerbWidth, apron: half + track.def.kerbWidth + APRON, pave: Float64Array.from(spans) };
    bandsByTrack.set(track, b);
  }
  return b;
}

/** Corridor surface band at (s, l): asphalt (pave inside a pave feature span), kerb, asphalt apron, grass. */
export function loopSurface(track: BuiltTrack, s: number, l: number): SurfaceKind {
  const b = bandsFor(track);
  const a = Math.abs(l);
  if (a <= b.half) {
    const sw = wrap(s, track.length);
    for (let i = 0; i < b.pave.length; i += 2) if (sw >= b.pave[i]! && sw < b.pave[i + 1]!) return 'pave';
    return 'asphalt';
  }
  if (a <= b.kerb) return 'kerb';
  if (a <= b.apron) return 'asphalt';
  return 'grass';
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function buildGroundWorld(track: BuiltTrack, def: WorldDefinition | null): GroundWorld {
  const core = createProjectorCore(track);
  const ts = core.sample;
  const scratch: TrackSample = { s: 0, x: 0, y: 0, z: 0, heading: 0, curvature: 0, bank: 0, grade: 0 };
  const fr: Frenet = { s: 0, l: 0, heading: 0, curvature: 0, converged: true };
  const stations = new Map((def?.stations ?? []).map((st) => [st.id, st] as const));
  const swellA = track.def.swell.amplitude;
  const swellK = (2 * Math.PI * track.def.swell.cycles) / track.length;

  const world: GroundWorld = {
    def,
    sample(x, y, hint, out) {
      core.project(x, y, hint, fr);
      const s = fr.s;
      const l = fr.l;
      const a = Math.abs(l);
      if (a <= LOOP_CORRIDOR + EDGE_BLEND) {
        // ts holds the last Newton iterate (within 1e-5 m of s): its bank is the bank at s.
        let h = track.roadHeight(s, l);
        let base = swellA * dsin(swellK * s) + l * dtan(ts.bank);
        if (a > LOOP_CORRIDOR - EDGE_BLEND) {
          const w = smoothstep(LOOP_CORRIDOR - EDGE_BLEND, LOOP_CORRIDOR + EDGE_BLEND, a);
          const t = loopTerrainHeight(track, x, y, s, l, scratch);
          h += (t - h) * w;
          base += (t - base) * w;
        }
        out.h = h;
        out.base = base;
        out.surface = loopSurface(track, s, l);
        out.zone = a <= LOOP_CORRIDOR ? 'loop' : 'terrain';
        out.s = a <= LOOP_CORRIDOR ? s : NaN;
        out.l = a <= LOOP_CORRIDOR ? l : NaN;
        return out;
      }
      const t = loopTerrainHeight(track, x, y, s, l, scratch);
      out.h = t;
      out.base = t;
      out.surface = 'grass';
      out.zone = 'terrain';
      out.s = NaN;
      out.l = NaN;
      return out;
    },
    terrainHeight(x, y) {
      core.project(x, y, NaN, fr);
      return loopTerrainHeight(track, x, y, fr.s, fr.l, scratch);
    },
    project: (x, y, hint, out) => core.project(x, y, hint, out),
    inBounds(x, y) {
      core.project(x, y, NaN, fr);
      return Math.abs(fr.l) <= OUT_OF_BOUNDS;
    },
    station: (id) => stations.get(id),
  };
  return world;
}
