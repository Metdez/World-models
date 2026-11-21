/**
 * Zone meshes (ARCHITECTURE-M2 §8.4): every vertex is the GroundWorld itself, `world.sample(x, y).h`, so the wheels sit
 * on what is drawn. Each zone is a grid in its own (u, w) coordinates (u along the zone, w + left), extended by
 * ZONE_EDGE beyond the footprint (the band where the physics blends the zone into what lies beneath). Rows carry their
 * own columns (dense columns only where a feature needs them) and consecutive rows are stitched by a merge walk, as the
 * track ribbon does (no T-junction cracks). Rows and columns sit on every patch / lane edge, so each quad has a single
 * surface. A triangle is kept only by the zone that owns its centroid (the first footprint in priority order holding it,
 * else the nearest footprint whose band holds it): abutting and overlapping zones never draw the same ground twice.
 * Vertex colours tint the asphalt per zone and paint the ride-street features (concrete sleepers and blocks, the dark
 * pothole), so the visitor sees what the wheels are about to hit.
 */
import { BufferAttribute, BufferGeometry } from 'three';
import type { RoadFeature } from '../../contracts/track';
import type { GroundHit, GroundWorld, SurfaceKind } from '../../contracts/world';
import { featureHeight } from '../../sim-core/track/features';
import { createZoneLocal, ZONE_EDGE, type CompiledZone, type ZoneLocal } from '../../sim-core/world/zones';

/** Material slots of the annex meshes (index = materialIndex). */
export const ANNEX_MATERIALS = ['asphalt', 'cobbles', 'wetAsphalt', 'wetTiles'] as const;
export type AnnexMaterial = (typeof ANNEX_MATERIALS)[number];
const SLOT: Readonly<Record<SurfaceKind, number>> = { asphalt: 0, kerb: 0, grass: 0, pave: 1, 'asphalt-wet': 2, 'ceramic-wet': 3 };

/** Base grid spacing per tier, m, and the quad budget per zone (the dynamics pad gets a coarser grid at high). */
export const ZONE_STEP = { low: 2, medium: 1.5, high: 1 } as const;
const MAX_QUADS = 60_000;
/** Ride street (class B roughness): base row spacing per tier, m; columns on the roughness rails (exact laterally). */
const STREET_ROW = { low: 0.5, medium: 0.5, high: 0.25 } as const;
const RAIL = 0.8;
const EPS = 1e-6;
/** Asphalt tint (x the texture) by the zone's role: large pads newer and lighter, patched platforms light, feature
 *  streets a touch darker, link roads as the loop. */
function zoneTint(zone: CompiledZone): number {
  if (zone.def.shape.kind === 'path') return 1;
  if (zone.def.features?.length) return 0.95;
  if (zone.def.patches?.length) return 1.2;
  return zone.length * zone.halfWidth * 2 > 20_000 ? 1.3 : 1.05;
}
const CONCRETE = [2.35, 2.3, 2.15] as const;
const POTHOLE = 0.55;

type Tier = keyof typeof ZONE_STEP;

const range = (a: number, b: number, step: number): number[] => {
  const n = Math.max(1, Math.ceil((b - a) / step - EPS));
  return Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
};

function uniqueSorted(values: number[]): number[] {
  values.sort((x, y) => x - y);
  const out: number[] = [];
  for (const v of values) if (out.length === 0 || v - out[out.length - 1]! > EPS) out.push(v);
  return out;
}

/** A stretch of u with its own extra rows and the extra columns its rows carry. */
interface Span {
  readonly u0: number;
  readonly u1: number;
  readonly rows: readonly number[];
  readonly cols: readonly number[];
}

/** Dense rows / columns of one closed-form feature (zone-local u, w). */
function featureSpans(f: RoadFeature, halfWidth: number): Span[] {
  switch (f.kind) {
    case 'cosine-bump': {
      const [l0, l1] = f.lateral;
      // smoothstep lateral edges 0.15 m wide inside the band (sim-core features.ts BUMP_EDGE)
      return [{ u0: f.s, u1: f.s + f.length, rows: range(f.s, f.s + f.length, 0.05), cols: [...range(l0, l0 + 0.15, 0.03), ...range(l1 - 0.15, l1, 0.03)] }];
    }
    case 'pothole':
      return [{ u0: f.s - f.radius, u1: f.s + f.radius, rows: range(f.s - f.radius, f.s + f.radius, 0.05), cols: range(f.l - f.radius, f.l + f.radius, 0.05) }];
    case 'humps':
      return Array.from({ length: f.count }, (_, k) => {
        const a = f.s + k * f.spacing;
        return { u0: a, u1: a + f.length, rows: range(a, a + f.length, 0.03), cols: [] };
      });
    case 'washboard':
      return [{ u0: f.s, u1: f.s + f.length, rows: range(f.s, f.s + f.length, Math.min(f.wavelength[0], f.wavelength[1]) / 12), cols: [] }];
    case 'pave': {
      // Stones on a grid of f.stone from the feature start (u) and w = 0: rows and columns at the stone centres (each
      // stone's own height; the joints between them are in the cobbles texture: resolving them needs 3 rows per stone).
      const rows: number[] = [f.s, f.s + f.length];
      for (let u = f.stone / 2; u < f.length; u += f.stone) rows.push(f.s + u);
      const cols: number[] = [];
      for (let j = Math.floor(-halfWidth / f.stone); (j + 0.5) * f.stone < halfWidth; j++) if ((j + 0.5) * f.stone > -halfWidth) cols.push((j + 0.5) * f.stone);
      return [{ u0: f.s, u1: f.s + f.length, rows, cols }];
    }
    case 'kerb-strike':
    case 'vertical-curve':
      return [];
  }
}

export interface ZoneGrid {
  readonly rows: readonly number[];
  readonly cols: readonly (readonly number[])[];
}

/** Rows (u) and per-row columns (w) of a zone mesh at a tier. */
export function zoneGrid(zone: CompiledZone, tier: Tier): ZoneGrid {
  const { length: L, halfWidth: hw } = zone;
  const E = ZONE_EDGE;
  const features = zone.def.features ?? [];
  const area = (L + 2 * E) * (2 * hw + 2 * E);
  const street = features.length > 0;
  let step: number = ZONE_STEP[tier];
  if (!street) step = Math.max(step, Math.sqrt(area / MAX_QUADS));
  const rowStep = street ? STREET_ROW[tier] : step;

  const spans = features.flatMap((f) => featureSpans(f, hw));
  const rowValues = [-E, L + E, ...range(0, L, rowStep)].filter((u) => !spans.some((s) => u > s.u0 + EPS && u < s.u1 - EPS));
  for (const s of spans) rowValues.push(...s.rows);
  const baseCols = [-hw - E, hw + E, ...range(-hw, hw, step)];
  if (street) baseCols.push(...range(-Math.floor(hw / RAIL) * RAIL, Math.floor(hw / RAIL) * RAIL, RAIL), -hw + E, hw - E);
  for (const p of zone.def.patches ?? []) {
    rowValues.push(...p.u);
    baseCols.push(...p.w);
  }
  const rows = uniqueSorted(rowValues.filter((u) => u >= -E - EPS && u <= L + E + EPS));
  const base = uniqueSorted(baseCols.filter((w) => w >= -hw - E - EPS && w <= hw + E + EPS));
  const cols = rows.map((u) => {
    const extra = spans.filter((s) => u >= s.u0 - EPS && u <= s.u1 + EPS).flatMap((s) => s.cols);
    return extra.length ? uniqueSorted([...base, ...extra.filter((w) => w > -hw && w < hw)]) : base;
  });
  return { rows, cols };
}

/** Ownership of a world point: the first footprint (priority order) holding it, else the nearest band holding it. */
export function createOwner(zones: readonly CompiledZone[]): (x: number, y: number) => number {
  const loc: ZoneLocal = createZoneLocal();
  return (x, y) => {
    let best = -1;
    let bestOut = ZONE_EDGE;
    for (let k = 0; k < zones.length; k++) {
      const z = zones[k]!;
      if (x < z.minX - ZONE_EDGE || x > z.maxX + ZONE_EDGE || y < z.minY - ZONE_EDGE || y > z.maxY + ZONE_EDGE) continue;
      z.local(x, y, loc);
      if (loc.inside >= 0) return k;
      if (loc.outside < bestOut) {
        bestOut = loc.outside;
        best = k;
      }
    }
    return best;
  };
}

/** Vertex colour of the asphalt at zone-local (u, w): zone tint, concrete sleepers / blocks, the dark pothole. */
function tintAt(zone: CompiledZone, u: number, w: number, out: Float32Array, o: number): void {
  const t = zoneTint(zone);
  let r = t;
  let g = t;
  let b = t;
  const edges = { halfWidth: zone.halfWidth, kerbWidth: 0.3, seed: 0 };
  for (const f of zone.def.features ?? []) {
    if (f.kind === 'humps' || f.kind === 'cosine-bump') {
      const k = featureHeight(f, u, w, edges) / f.height;
      if (k > 0) {
        const m = Math.min(1, k * 4);
        r += (CONCRETE[0] - r) * m;
        g += (CONCRETE[1] - g) * m;
        b += (CONCRETE[2] - b) * m;
      }
    } else if (f.kind === 'pothole') {
      const k = -featureHeight(f, u, w, edges) / f.depth;
      if (k > 0) {
        const m = POTHOLE + (1 - POTHOLE) * (1 - Math.min(1, k * 3));
        r *= m;
        g *= m;
        b *= m;
      }
    }
  }
  out[o] = r;
  out[o + 1] = g;
  out[o + 2] = b;
}

export interface ZoneMesh {
  readonly geometry: BufferGeometry;
  readonly triangles: number;
}

/**
 * Builds the meshes of `zones` (all of the world's compiled zones in priority order are needed for ownership: pass them
 * as `all`) into ONE geometry whose groups follow ANNEX_MATERIALS. Three coordinates: (x, h, -y); uv = world (x, y) m.
 */
export function buildZoneMesh(world: GroundWorld, all: readonly CompiledZone[], zones: readonly CompiledZone[], tier: Tier): ZoneMesh {
  const owner = createOwner(all);
  const hit: GroundHit = { h: 0, base: 0, surface: 'asphalt', zone: '', s: NaN, l: NaN };
  const p = { x: 0, y: 0 };
  const grids = zones.map((z) => zoneGrid(z, tier));
  let count = 0;
  for (const g of grids) for (const c of g.cols) count += c.length;
  const position = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const color = new Float32Array(count * 3);
  const local = new Float64Array(count * 2);
  const slots: number[][] = ANNEX_MATERIALS.map(() => []);
  let v = 0;
  zones.forEach((zone, zi) => {
    const self = all.indexOf(zone);
    const { rows, cols } = grids[zi]!;
    const rowStart: number[] = [];
    for (let r = 0; r < rows.length; r++) {
      rowStart.push(v);
      for (const w of cols[r]!) {
        zone.toWorld(rows[r]!, w, p);
        world.sample(p.x, p.y, NaN, hit);
        position[v * 3] = p.x;
        position[v * 3 + 1] = hit.h;
        position[v * 3 + 2] = -p.y;
        uv[v * 2] = p.x;
        uv[v * 2 + 1] = p.y;
        local[v * 2] = rows[r]!;
        local[v * 2 + 1] = w;
        tintAt(zone, rows[r]!, w, color, v * 3);
        v++;
      }
    }
    const emit = (a: number, b: number, c: number) => {
      const cu = (local[a * 2]! + local[b * 2]! + local[c * 2]!) / 3;
      const cw = (local[a * 2 + 1]! + local[b * 2 + 1]! + local[c * 2 + 1]!) / 3;
      zone.toWorld(cu, cw, p);
      if (owner(p.x, p.y) !== self) return;
      slots[SLOT[zone.surfaceAt(cu, cw)]]!.push(a, b, c);
    };
    for (let r = 0; r + 1 < rows.length; r++) {
      const a = cols[r]!;
      const b = cols[r + 1]!;
      const A = rowStart[r]!;
      const B = rowStart[r + 1]!;
      let ia = 0;
      let ib = 0;
      // Merge walk across the row pair (both rows span the same w extent). Counter-clockwise seen from above in three
      // (x, -y): u runs along the zone heading, w to its left.
      while (ia < a.length - 1 || ib < b.length - 1) {
        if (ib === b.length - 1 || (ia < a.length - 1 && a[ia + 1]! <= b[ib + 1]! + EPS)) {
          emit(A + ia, B + ib, A + ia + 1);
          ia++;
        } else {
          emit(A + ia, B + ib, B + ib + 1);
          ib++;
        }
      }
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  geometry.setAttribute('color', new BufferAttribute(color, 3));
  const all3 = slots.flat();
  const index = new (count > 65535 ? Uint32Array : Uint16Array)(all3);
  geometry.setIndex(new BufferAttribute(index, 1));
  let start = 0;
  slots.forEach((s, i) => {
    if (s.length) geometry.addGroup(start, s.length, i);
    start += s.length;
  });
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return { geometry, triangles: all3.length / 3 };
}
