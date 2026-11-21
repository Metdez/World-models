/**
 * GroundWorld (ARCHITECTURE-M2 §8.1): ONE analytic ground for the plant and the renderer. 08-02: the loop corridor
 * (projection onto the existing roadHeight) and the terrain; 10-02 adds world zones, the field and their bounds
 * (buildZonedWorld below; without a world definition the 09-04 code path runs unchanged, bit for bit).
 * Loop corridor (|l| <= LOOP_CORRIDOR): h = track.roadHeight(s, l), base = swell(s) + l tan(bank(s)) (vertical curves,
 * roughness and features stay in h exactly as the M1 ride input sees them); surface bands by |l|. Between |l| 17.5 and
 * 18.5 h and base blend to the terrain. Pure; sample/project are allocation-free.
 * Off the corridor (09-04) the terrain is a continuous function of (x, y): where several loop sections are near (the
 * hairpin finger runs 41 m from the launch straight, 1-3 m higher or lower), the M1 terrain of each local nearest
 * centreline node within TERRAIN_REACH of the nearest contributes with inverse-square weights on the distance beyond
 * the ribbon (terrain.ts createBlendedTerrain: the nearest section dominates at its own edge), instead of jumping where
 * the nearest section changes.
 * The projection is the global nearest point (the hint only names the API). `terrainHeight(x, y)` is that same
 * function (with a world: plus the field and the zone skirts): the renderer's terrain must call it.
 */
import type { BuiltTrack, TrackSample } from '../../contracts/track';
import type { Frenet, GroundWorld, StationDefinition, SurfaceKind, WorldDefinition } from '../../contracts/world';
import { wrap } from '../math/interp';
import { dsin, dtan } from '../math/det';
import { createProjectorCore, MAX_REACH, type ProjectorCore } from './project';
import { createBlendedTerrain, loopTerrainHeight } from './terrain';
import { compileZones, createZoneLocal, SKIRT, SKIRT_DROP, SKIRT_MAX, SKIRT_SLOPE, ZONE_EDGE, zoneWeight } from './zones';

/** m: |l| of the drawn ribbon (width/2 + kerb + runoff of the proving loop). */
export const LOOP_CORRIDOR = 18;
/** m beyond the loop centreline (zones / field margins: 10-02). */
export const OUT_OF_BOUNDS = 60;
/** Half-width of the corridor-to-terrain blend around LOOP_CORRIDOR, m. */
const EDGE_BLEND = 0.5;
/** Asphalt apron beyond the kerb, m. */
const APRON = 2;
/** Off-corridor terrain blends the sections whose distance is within this of the nearest, m. */
const TERRAIN_REACH = MAX_REACH;
/** Inside this distance from the centreline the terrain (hidden under the ribbon) is the nearest section's alone, m. */
const BLEND_FROM = LOOP_CORRIDOR - 1;

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

  const blended = createBlendedTerrain(track, core, BLEND_FROM, TERRAIN_REACH);
  /** Terrain at (x, y) whose nearest centreline point is in `fr`. */
  function terrainAt(x: number, y: number): number {
    const b = blended(x, y, Math.abs(fr.l));
    return b === b ? b : loopTerrainHeight(track, x, y, fr.s, fr.l, scratch);
  }
  const swellA = track.def.swell.amplitude;
  const swellK = (2 * Math.PI * track.def.swell.cycles) / track.length;

  // a definition without zones and field (a stub registered by a test) grounds like no world
  if (def?.zones && def.field) return buildZonedWorld(track, def, core, fr, terrainAt, swellA, swellK, stations);

  const world: GroundWorld = {
    def,
    sample(x, y, _hint, out) {
      // The nearest point only; off (or at the edge of) the ribbon all candidates within the terrain reach.
      core.project(x, y, NaN, fr);
      const s = fr.s;
      const l = fr.l;
      const a = Math.abs(l);
      if (a <= LOOP_CORRIDOR + EDGE_BLEND) {
        // ts holds the last Newton iterate (within 1e-5 m of s): its bank is the bank at s.
        let h = track.roadHeight(s, l);
        let base = swellA * dsin(swellK * s) + l * dtan(ts.bank);
        if (a > LOOP_CORRIDOR - EDGE_BLEND) {
          const w = smoothstep(LOOP_CORRIDOR - EDGE_BLEND, LOOP_CORRIDOR + EDGE_BLEND, a);
          const t = terrainAt(x, y);
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
      const t = terrainAt(x, y);
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
      return terrainAt(x, y);
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

/** Zones reaching within this distance of the loop centreline take the loop's base plane near it (the spurs), m. */
export const LOOP_JOIN = 60;
/** Margin round the field rectangle that is still in bounds, m (§8.1). */
export const FIELD_MARGIN = 40;
/** Distance from a zone footprint that is still in bounds, m (§8.1). */
export const ZONE_MARGIN = 30;

/**
 * GroundWorld with a world definition (10-02, §8.1). sample(x, y): (1) zones, highest priority first: inside a
 * footprint a zone weighs 1, in the ZONE_EDGE band outside it smoothstep down to 0; the zones cover max(weight) of the
 * point, each zone the part beyond what the zones above it cover (abutting zones meet without a dip, two bands crossing
 * at a corner are no steeper than one, a zone edge on open ground blends into the terrain below);
 * (2) the loop corridor exactly as without a world; (3) the field and (4) the terrain. The surface (and zone id) is the
 * largest contributor's; s / l are NaN wherever a zone contributes (the plant then uses h, not the loop envelope).
 * Zone base: the zone's own plane, except that a zone within LOOP_JOIN of the loop centreline follows the loop's base
 * plane (swell + bank, lateral clamped to the corridor) there and blends to its own plane by smoothstep on the loop
 * offset from LOOP_CORRIDOR to LOOP_JOIN: a spur meets the loop at the loop's own height and reaches the field at its own.
 * terrainHeight: the 09-04 blended terrain; the field rectangle at field.z, blended over field.blend outside it; then
 * every zone skirt (lowest priority first): at the footprint the terrain is the zone base - SKIRT_DROP (hidden under the
 * zone mesh), returning to the terrain over SKIRT + SKIRT_SLOPE |difference| (<= SKIRT_MAX); inside the loop corridor a
 * skirt only lowers the terrain (it never pushes ground up through the loop ribbon).
 */
function buildZonedWorld(
  track: BuiltTrack,
  def: WorldDefinition,
  core: ProjectorCore,
  fr: Frenet,
  terrainAt: (x: number, y: number) => number,
  swellA: number,
  swellK: number,
  stations: ReadonlyMap<string, StationDefinition>,
): GroundWorld {
  const ts = core.sample;
  const set = compileZones(def);
  const zones = set.zones;
  const list = set.list;
  const range = new Int32Array(2);
  const loc = createZoneLocal();
  const field = def.field;
  // loop node bounding box: farther than the corridor from it, no projection is needed for the corridor test
  let lx0 = Infinity;
  let ly0 = Infinity;
  let lx1 = -Infinity;
  let ly1 = -Infinity;
  for (let i = 0; i < core.nodes.x.length; i++) {
    lx0 = Math.min(lx0, core.nodes.x[i]!);
    lx1 = Math.max(lx1, core.nodes.x[i]!);
    ly0 = Math.min(ly0, core.nodes.y[i]!);
    ly1 = Math.max(ly1, core.nodes.y[i]!);
  }
  const nearBox = (x: number, y: number, m: number): boolean => x >= lx0 - m && x <= lx1 + m && y >= ly0 - m && y <= ly1 + m;
  let projected = false;
  const ensureProjected = (x: number, y: number): void => {
    if (!projected) {
      core.project(x, y, NaN, fr);
      projected = true;
    }
  };
  // zones that come within LOOP_JOIN of the loop (footprint sampled every metre)
  const nearLoop = new Uint8Array(zones.length);
  {
    const p = { x: 0, y: 0 };
    zones.forEach((z, k) => {
      const nu = Math.ceil(z.length);
      const nw = Math.ceil(2 * z.halfWidth);
      for (let i = 0; i <= nu && !nearLoop[k]; i++)
        for (let j = 0; j <= nw; j++) {
          z.toWorld((i / nu) * z.length, -z.halfWidth + (j / nw) * 2 * z.halfWidth, p);
          if (!nearBox(p.x, p.y, LOOP_JOIN)) continue;
          core.project(p.x, p.y, NaN, fr);
          if (Math.abs(fr.l) < LOOP_JOIN) {
            nearLoop[k] = 1;
            break;
          }
        }
    });
  }

  /** Base of zone k at (x, y) with local u (loop join for zones near the loop). */
  function zoneBase(k: number, x: number, y: number, u: number): number {
    const z = zones[k]!;
    const own = z.base(u);
    if (!nearLoop[k]) return own;
    ensureProjected(x, y);
    const a = Math.abs(fr.l);
    if (a >= LOOP_JOIN) return own;
    const lc = Math.max(-LOOP_CORRIDOR, Math.min(LOOP_CORRIDOR, fr.l));
    const ref = swellA * dsin(swellK * fr.s) + lc * dtan(ts.bank);
    return ref + (own - ref) * smoothstep(LOOP_CORRIDOR, LOOP_JOIN, a);
  }

  /** Field weight at (x, y): 1 inside the rectangle, smoothstep to 0 over field.blend outside it. */
  function fieldWeight(x: number, y: number): number {
    const ox = x < field.minX ? field.minX - x : x > field.maxX ? x - field.maxX : 0;
    const oy = y < field.minY ? field.minY - y : y > field.maxY ? y - field.maxY : 0;
    if (ox === 0 && oy === 0) return 1;
    return 1 - smoothstep(0, field.blend, Math.sqrt(ox * ox + oy * oy));
  }

  /** Terrain with field and skirts; may project (sets `projected`). */
  function terrain(x: number, y: number): number {
    const fw = fieldWeight(x, y);
    let t: number;
    if (fw >= 1) t = field.z;
    else {
      ensureProjected(x, y);
      t = terrainAt(x, y);
      if (fw > 0) t += (field.z - t) * fw;
    }
    set.cell(x, y, range);
    for (let j = range[1]! - 1; j >= range[0]!; j--) {
      const k = list[j]!;
      const z = zones[k]!;
      if (x < z.minX - SKIRT_MAX || x > z.maxX + SKIRT_MAX || y < z.minY - SKIRT_MAX || y > z.maxY + SKIRT_MAX) continue;
      z.local(x, y, loc);
      if (loc.outside >= SKIRT_MAX) continue;
      const target = zoneBase(k, x, y, Math.max(0, Math.min(z.length, loc.u))) - SKIRT_DROP;
      const width = Math.min(SKIRT_MAX, SKIRT + SKIRT_SLOPE * Math.abs(target - t));
      const s = smoothstep(0, width, loc.outside);
      if (s >= 1) continue;
      let next = target + (t - target) * s;
      if (next > t && nearBox(x, y, LOOP_CORRIDOR + 1)) {
        ensureProjected(x, y);
        next = t + (next - t) * smoothstep(LOOP_CORRIDOR - 1, LOOP_CORRIDOR + 1, Math.abs(fr.l));
      }
      t = next;
    }
    return t;
  }

  const inField = (x: number, y: number): boolean => x >= field.minX && x <= field.maxX && y >= field.minY && y <= field.maxY;

  return {
    def,
    sample(x, y, _hint, out) {
      projected = false;
      let rem = 1;
      let h = 0;
      let base = 0;
      let best = 0;
      let surface: SurfaceKind = 'grass';
      let zone = '';
      set.cell(x, y, range);
      for (let j = range[0]!; j < range[1]! && rem > 0; j++) {
        const k = list[j]!;
        const z = zones[k]!;
        if (x < z.minX - ZONE_EDGE || x > z.maxX + ZONE_EDGE || y < z.minY - ZONE_EDGE || y > z.maxY + ZONE_EDGE) continue;
        z.local(x, y, loc);
        const wt = zoneWeight(loc);
        if (wt <= 0) continue;
        // coverage = the largest weight so far: each zone adds what it covers beyond the zones above it (two edge
        // bands crossing at a corner fall off no faster than one)
        const c = wt - (1 - rem);
        if (c <= 0) continue;
        const zb = zoneBase(k, x, y, loc.u);
        h += c * (zb + z.relief(loc.u, loc.w, loc.inside));
        base += c * zb;
        if (c > best) {
          best = c;
          surface = z.surfaceAt(loc.u, loc.w);
          zone = z.def.id;
        }
        rem -= c;
      }
      if (rem <= 0) {
        out.h = h;
        out.base = base;
        out.surface = surface;
        out.zone = zone;
        out.s = NaN;
        out.l = NaN;
        return out;
      }
      // beneath the zones: the loop corridor, else the field / terrain
      let rh: number;
      let rb: number;
      let rs: SurfaceKind;
      let rz: string;
      let s = NaN;
      let l = NaN;
      let a = Infinity;
      if (nearBox(x, y, LOOP_CORRIDOR + EDGE_BLEND)) {
        ensureProjected(x, y);
        a = Math.abs(fr.l);
      }
      if (a <= LOOP_CORRIDOR + EDGE_BLEND) {
        s = fr.s;
        l = fr.l;
        rh = track.roadHeight(s, l);
        rb = swellA * dsin(swellK * s) + l * dtan(ts.bank);
        if (a > LOOP_CORRIDOR - EDGE_BLEND) {
          const w = smoothstep(LOOP_CORRIDOR - EDGE_BLEND, LOOP_CORRIDOR + EDGE_BLEND, a);
          const t = terrain(x, y);
          rh += (t - rh) * w;
          rb += (t - rb) * w;
        }
        rs = loopSurface(track, s, l);
        rz = a <= LOOP_CORRIDOR ? 'loop' : 'terrain';
        if (a > LOOP_CORRIDOR) {
          s = NaN;
          l = NaN;
        }
      } else {
        rh = rb = terrain(x, y);
        rs = 'grass';
        rz = inField(x, y) ? 'field' : 'terrain';
      }
      if (rem === 1) {
        out.h = rh;
        out.base = rb;
        out.surface = rs;
        out.zone = rz;
        out.s = s;
        out.l = l;
        return out;
      }
      out.h = h + rem * rh;
      out.base = base + rem * rb;
      out.surface = rem > best ? rs : surface;
      out.zone = rem > best ? rz : zone;
      out.s = NaN;
      out.l = NaN;
      return out;
    },
    terrainHeight(x, y) {
      projected = false;
      return terrain(x, y);
    },
    project: (x, y, hint, out) => core.project(x, y, hint, out),
    inBounds(x, y) {
      if (x >= field.minX - FIELD_MARGIN && x <= field.maxX + FIELD_MARGIN && y >= field.minY - FIELD_MARGIN && y <= field.maxY + FIELD_MARGIN) return true;
      set.cell(x, y, range);
      for (let j = range[0]!; j < range[1]!; j++) {
        const z = zones[list[j]!]!;
        if (x < z.minX - ZONE_MARGIN || x > z.maxX + ZONE_MARGIN || y < z.minY - ZONE_MARGIN || y > z.maxY + ZONE_MARGIN) continue;
        if (z.local(x, y, loc).outside <= ZONE_MARGIN) return true;
      }
      if (!nearBox(x, y, OUT_OF_BOUNDS)) return false;
      core.project(x, y, NaN, fr);
      return Math.abs(fr.l) <= OUT_OF_BOUNDS;
    },
    station: (id) => stations.get(id),
  };
}
