/**
 * World zones (ARCHITECTURE-M2 §8.1, 10-02): a WorldDefinition's rect / path footprints compiled into zone-local
 * coordinates (u along the zone from its start edge, w + left: the track's s / l convention, so the M1 RoadFeature
 * shapes apply unchanged), an own base plane (flat, or linear z0 -> z1 along u eased over ZONE_EASE at both ends),
 * closed-form features, seeded ISO 8608 roughness and surface patches; plus a 20 m grid that lists the zones near a
 * point in priority order. ground.ts composes them with the loop corridor and the terrain. Pure; the per-query
 * functions are allocation-free.
 * Path zones (the spurs) integrate their primitives with track/closure.ts at 0.25 m and project onto the nearest node
 * with one arc-exact correction (error ~1e-6 m); beyond their ends they extend along the end tangents.
 */
import type { SurfaceKind, WorldDefinition, ZoneDefinition } from '../../contracts/world';
import type { TrackSegmentDefinition } from '../../contracts/track';
import { dcos, dsin } from '../math/det';
import { hash32 } from '../math/rng';
import { smoothstep, wrap } from '../math/interp';
import { featureHeight, type RoadEdges } from '../track/features';
import { classScale, createRoughness, type Roughness } from '../track/iso8608';
import { advancePose, integratePlan } from '../track/closure';

/** Width of the smoothstep edge band OUTSIDE each footprint in which a zone blends into what lies beneath, m. */
export const ZONE_EDGE = 0.5;
/** Length over which a sloped zone base eases in and out at both ends, m. */
export const ZONE_EASE = 10;
/** Terrain skirt round every footprint: the terrain meets the zone base minus SKIRT_DROP at the footprint and returns
 *  to itself over SKIRT + SKIRT_SLOPE * (height difference), at most SKIRT_MAX metres. */
export const SKIRT = 3;
export const SKIRT_SLOPE = 10;
export const SKIRT_MAX = 12;
export const SKIRT_DROP = 0.05;
/** Kerb width handed to RoadFeature edges in zones (kerb-strike features), m. */
const ZONE_KERB = 0.3;
/** Length of the shared periodic roughness profile; zones read it at their own offsets, m. */
const ROUGH_LENGTH = 512;
/** Grid cell for the zone cull, m; zones are listed in every cell their footprint + GRID_MARGIN touches. */
const GRID = 20;
/** Margin of the cull grid round each footprint: the bounds margin (ground.ts) covers the skirt and the edge band. */
export const GRID_MARGIN = 30;

/** Zone-local coordinates of the last `local` call. */
export interface ZoneLocal {
  u: number;
  w: number;
  /** Distance inside the footprint to its nearest edge (>= 0 inside, < 0 outside). */
  inside: number;
  /** Euclidean distance outside the footprint (0 inside). */
  outside: number;
}
export const createZoneLocal = (): ZoneLocal => ({ u: 0, w: 0, inside: 0, outside: 0 });

export interface CompiledZone {
  readonly def: ZoneDefinition;
  readonly length: number;
  readonly halfWidth: number;
  /** Axis-aligned bounding box of the footprint, world m. */
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  /** Zone-local coordinates and edge distances of world (x, y). */
  local(x: number, y: number, out: ZoneLocal): ZoneLocal;
  /** World point of zone-local (u, w) (outline / markings for the renderer). */
  toWorld(u: number, w: number, out: { x: number; y: number }): void;
  /** Own base plane at u (u clamped to the zone). */
  base(u: number): number;
  /** Roughness + features above the base at (u, w); the features fade out over the ZONE_EDGE metres inside the
   *  footprint's edges (`inside` = ZoneLocal.inside), so a zone edge never adds a feature to the edge-band blend. */
  relief(u: number, w: number, inside: number): number;
  surfaceAt(u: number, w: number): SurfaceKind;
}

/** FNV-1a of a string, mixed: the roughness seed of a world id. */
export function seedOf(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  return hash32(h);
}

/** Eased linear profile from 0 to 1 over [0, length]: slope ramps in and out over `ease` at both ends. */
function easedRamp(u: number, length: number, ease: number): number {
  const e = Math.min(ease, length / 2);
  const m = 1 / (length - e);
  if (u <= 0) return 0;
  if (u >= length) return 1;
  if (u < e) return (m * u * u) / (2 * e);
  if (u > length - e) return 1 - (m * (length - u) * (length - u)) / (2 * e);
  return m * (e / 2 + u - e);
}

function compileZone(def: ZoneDefinition, index: number, roughness: Roughness, seed: number): CompiledZone {
  const shape = def.shape;
  const halfWidth = shape.width / 2;
  const z0 = typeof def.z === 'number' ? def.z : def.z[0];
  const z1 = typeof def.z === 'number' ? def.z : def.z[1];
  const features = def.features ?? [];
  const patches = def.patches ?? [];
  const edges: RoadEdges = { halfWidth, kerbWidth: ZONE_KERB, seed };
  const roughScale = def.roughness ? classScale(def.roughness) : 0;
  const roughOffset = (index * 97.3) % ROUGH_LENGTH;
  const c0 = dcos(shape.heading);
  const s0 = dsin(shape.heading);

  let length: number;
  let local: CompiledZone['local'];
  let toWorld: CompiledZone['toWorld'];
  if (shape.kind === 'rect') {
    length = shape.length;
    local = (x, y, out) => {
      const dx = x - shape.x;
      const dy = y - shape.y;
      out.u = dx * c0 + dy * s0;
      out.w = -dx * s0 + dy * c0;
      return edgeDistances(out);
    };
    toWorld = (u, w, out) => {
      out.x = shape.x + u * c0 - w * s0;
      out.y = shape.y + u * s0 + w * c0;
    };
  } else {
    const plan = integratePlan([{ primitives: shape.primitives } as unknown as TrackSegmentDefinition]);
    length = plan.length;
    const n = plan.x.length;
    const nx = new Float64Array(n);
    const ny = new Float64Array(n);
    const nc = new Float64Array(n);
    const ns = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      nx[i] = shape.x + plan.x[i]! * c0 - plan.y[i]! * s0;
      ny[i] = shape.y + plan.x[i]! * s0 + plan.y[i]! * c0;
      nc[i] = dcos(shape.heading + plan.psi[i]!);
      ns[i] = dsin(shape.heading + plan.psi[i]!);
    }
    const pose = { x: 0, y: 0, psi: 0 };
    local = (x, y, out) => {
      let bi = 0;
      let bd = Infinity;
      for (let i = 0; i < n; i++) {
        const dx = x - nx[i]!;
        const dy = y - ny[i]!;
        const d = dx * dx + dy * dy;
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      const dx = x - nx[bi]!;
      const dy = y - ny[bi]!;
      const f = dx * nc[bi]! + dy * ns[bi]!;
      if ((bi === 0 && f <= 0) || (bi === n - 1 && f >= 0)) {
        // beyond an end: the straight extension of the end tangent
        out.u = plan.s[bi]! + f;
        out.w = -dx * ns[bi]! + dy * nc[bi]!;
        return edgeDistances(out);
      }
      // one arc-exact correction from the node pose
      advancePose(nx[bi]!, ny[bi]!, shape.heading + plan.psi[bi]!, plan.k[bi]!, plan.dk[bi]!, f, pose);
      const ex = x - pose.x;
      const ey = y - pose.y;
      const c = dcos(pose.psi);
      const s = dsin(pose.psi);
      out.u = plan.s[bi]! + f + ex * c + ey * s;
      out.w = -ex * s + ey * c;
      return edgeDistances(out);
    };
    toWorld = (u, w, out) => {
      const uc = Math.min(Math.max(u, 0), length);
      let i = Math.min(n - 1, Math.max(0, Math.floor((uc / length) * (n - 1))));
      while (i > 0 && plan.s[i]! > uc) i--;
      while (i < n - 1 && plan.s[i + 1]! <= uc) i++;
      advancePose(nx[i]!, ny[i]!, shape.heading + plan.psi[i]!, plan.k[i]!, plan.dk[i]!, uc - plan.s[i]!, pose);
      const ext = u - uc; // straight beyond the ends
      const c = dcos(pose.psi);
      const s = dsin(pose.psi);
      out.x = pose.x + ext * c - w * s;
      out.y = pose.y + ext * s + w * c;
    };
  }

  function edgeDistances(out: ZoneLocal): ZoneLocal {
    const aw = Math.abs(out.w);
    out.inside = Math.min(out.u, length - out.u, halfWidth - aw);
    const ou = out.u < 0 ? -out.u : out.u > length ? out.u - length : 0;
    const ow = aw > halfWidth ? aw - halfWidth : 0;
    out.outside = ou === 0 ? ow : ow === 0 ? ou : Math.sqrt(ou * ou + ow * ow);
    return out;
  }

  // bounding box from the outline
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const p = { x: 0, y: 0 };
  const steps = Math.max(2, Math.ceil(length / 0.5));
  for (let i = 0; i <= steps; i++)
    for (const w of [-halfWidth, halfWidth]) {
      toWorld((i / steps) * length, w, p);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }

  return {
    def,
    length,
    halfWidth,
    minX,
    minY,
    maxX,
    maxY,
    local,
    toWorld,
    base: z0 === z1 ? () => z0 : (u) => z0 + (z1 - z0) * easedRamp(u, length, ZONE_EASE),
    relief(u, w, inside) {
      const h = roughScale === 0 ? 0 : roughScale * roughness.at(wrap(u + roughOffset, ROUGH_LENGTH), w);
      if (features.length === 0 || inside <= 0) return h;
      let f = 0;
      for (let j = 0; j < features.length; j++) f += featureHeight(features[j]!, u, w, edges);
      return h + (inside >= ZONE_EDGE ? f : f * smoothstep(0, ZONE_EDGE, inside));
    },
    surfaceAt(u, w) {
      for (let j = 0; j < patches.length; j++) {
        const pt = patches[j]!;
        if (u >= pt.u[0] && u <= pt.u[1] && w >= pt.w[0] && w <= pt.w[1]) return pt.surface;
      }
      return def.surface;
    },
  };
}

/** Weight of a zone at a point: 1 inside the footprint, smoothstep down to 0 over the ZONE_EDGE band outside it. */
export const zoneWeight = (loc: ZoneLocal): number => (loc.inside >= 0 ? 1 : 1 - smoothstep(0, ZONE_EDGE, loc.outside));

export interface ZoneSet {
  /** Zones in priority order (highest first; definition order among equals). */
  readonly zones: readonly CompiledZone[];
  /** Writes into `out` the [from, to) range of `list` holding the indices of the zones near (x, y), highest first. */
  cell(x: number, y: number, out: Int32Array): void;
  readonly list: Int32Array;
}

export function compileZones(def: WorldDefinition): ZoneSet {
  const seed = seedOf(def.id);
  const roughness = createRoughness(ROUGH_LENGTH, seed);
  const zones = def.zones
    .map((z, i) => compileZone(z, i, roughness, seed))
    .map((z, i) => ({ z, i }))
    .sort((a, b) => b.z.def.priority - a.z.def.priority || a.i - b.i)
    .map((e) => e.z);
  const m = GRID_MARGIN + ZONE_EDGE;
  let gx0 = Infinity;
  let gy0 = Infinity;
  let gx1 = -Infinity;
  let gy1 = -Infinity;
  for (const z of zones) {
    gx0 = Math.min(gx0, z.minX - m);
    gy0 = Math.min(gy0, z.minY - m);
    gx1 = Math.max(gx1, z.maxX + m);
    gy1 = Math.max(gy1, z.maxY + m);
  }
  const cols = zones.length ? Math.ceil((gx1 - gx0) / GRID) : 0;
  const rows = zones.length ? Math.ceil((gy1 - gy0) / GRID) : 0;
  const start = new Int32Array(cols * rows + 1);
  const entries: number[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      start[r * cols + c] = entries.length;
      const x0 = gx0 + c * GRID;
      const y0 = gy0 + r * GRID;
      zones.forEach((z, k) => {
        if (z.maxX + m >= x0 && z.minX - m <= x0 + GRID && z.maxY + m >= y0 && z.minY - m <= y0 + GRID) entries.push(k);
      });
    }
  start[cols * rows] = entries.length;
  const list = Int32Array.from(entries);
  return {
    zones,
    list,
    cell(x, y, out) {
      const c = Math.floor((x - gx0) / GRID);
      const r = Math.floor((y - gy0) / GRID);
      if (c < 0 || r < 0 || c >= cols || r >= rows) {
        out[0] = 0;
        out[1] = 0;
        return;
      }
      out[0] = start[r * cols + c]!;
      out[1] = start[r * cols + c + 1]!;
    },
  };
}

/**
 * Closed outline of a zone footprint as world (x, y) pairs, counter-clockwise from the start edge's right corner,
 * sampled every `step` m along u (renderer: zone meshes, 10-03).
 */
export function zoneOutline(zone: CompiledZone, step = 0.5): Float64Array {
  const n = Math.max(1, Math.ceil(zone.length / step));
  const out = new Float64Array(4 * (n + 1));
  const p = { x: 0, y: 0 };
  for (let i = 0; i <= n; i++) {
    zone.toWorld((i / n) * zone.length, -zone.halfWidth, p);
    out[2 * i] = p.x;
    out[2 * i + 1] = p.y;
    zone.toWorld(((n - i) / n) * zone.length, zone.halfWidth, p);
    out[2 * (n + 1 + i)] = p.x;
    out[2 * (n + 1 + i) + 1] = p.y;
  }
  return out;
}
