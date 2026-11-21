/**
 * The road ribbon (research 11 §A.5), sampled from the simulation's own surface: every vertex is
 * `track.toWorld(s, l)` (z = `roadHeight(s, l)`), so the wheels sit on what is drawn. Rows follow the tier's
 * resolution plus denser rows inside each closed-form feature; each row carries its own lateral columns and
 * consecutive rows are stitched by a merge walk (no T-junction cracks where the column sets differ).
 * UV = (l, s) in metres. Material groups follow the cross-section bands.
 */
import { Box3, BufferAttribute, BufferGeometry, Sphere, Vector3 } from 'three';
import type { BuiltTrack, RoadFeature, TrackSample } from '../../contracts/track';
import type { Frenet, GroundHit, GroundWorld } from '../../contracts/world';
import { buildGroundWorld } from '../../sim-core/world/ground';
import { createZoneLocal, ZONE_EDGE, type CompiledZone } from '../../sim-core/world/zones';

/** Materials: `road` = asphalt, kerbs and apron in one shader (fewer draw calls); cobbles replace the asphalt in the pavé. */
export const SURFACES = ['road', 'cobbles', 'grass'] as const;
export type Surface = (typeof SURFACES)[number];

/** Paved shoulder between the kerb and the grass, m. */
export const APRON = 2;
/** ISO 8608 rail spacing in sim-core: roughness is linear between multiples of it, so columns there are exact. */
const RAIL = 0.8;
/** Driving-line wheel tracks (half track, m) and their rubbered width (m) for the wear attribute. */
const WHEEL_HALF_TRACK = 0.8;
const WEAR_WIDTH = 0.35;
/** Kerbs are painted in stripes where the corner is tighter than this radius, m. */
const KERB_PAINT_RADIUS: readonly [full: number, none: number] = [150, 260];
const EPS = 1e-6;

/** A stretch of s with its own row spacing and extra lateral columns (one per closed-form feature). */
export interface Zone {
  /** A road feature, or a world zone overlaying the ribbon (dense rows, columns from its edge crossings). */
  readonly kind: RoadFeature['kind'] | 'world-zone';
  readonly s0: number;
  readonly s1: number;
  readonly rows: readonly number[];
  readonly cols: readonly number[];
}

const range = (a: number, b: number, step: number): number[] => {
  const n = Math.max(1, Math.ceil((b - a) / step - EPS));
  return Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
};

/** Feature zones in absolute s. `fine` = the high tier (denser washboard, a column per pavé stone). */
export function featureZones(track: BuiltTrack, fine: boolean): Zone[] {
  const hw = track.def.width / 2;
  const kw = track.def.kerbWidth;
  const zones: Zone[] = [];
  for (const sec of track.sections) {
    for (const f of sec.def.features ?? []) {
      const a = sec.s0 + f.s;
      switch (f.kind) {
        case 'cosine-bump':
          zones.push({ kind: f.kind, s0: a - 0.05, s1: a + f.length + 0.05, rows: range(a - 0.05, a + f.length + 0.05, 0.05), cols: range(f.lateral[0], f.lateral[1], 0.05) });
          break;
        case 'pothole':
          zones.push({ kind: f.kind, s0: a - f.radius, s1: a + f.radius, rows: range(a - f.radius, a + f.radius, 0.05), cols: range(f.l - f.radius, f.l + f.radius, 0.05) });
          break;
        case 'kerb-strike': {
          const side = f.side === 'left' ? 1 : -1;
          // Lateral ramps of 6 cm at both kerb edges (sim-core features.ts), resolved in 1.5 cm steps.
          const cols = [...range(hw, hw + 0.06, 0.015), ...range(hw + kw - 0.06, hw + kw, 0.015)].map((l) => side * l);
          zones.push({ kind: f.kind, s0: a, s1: a + f.length, rows: range(a, a + f.length, 0.1), cols });
          break;
        }
        case 'washboard':
          // At least 12 rows per shortest wave on the fine tier, 7 otherwise.
          zones.push({ kind: f.kind, s0: a, s1: a + f.length, rows: range(a, a + f.length, Math.min(f.wavelength[0], f.wavelength[1]) / (fine ? 12 : 7)), cols: [] });
          break;
        case 'humps': {
          const end = a + (f.count - 1) * f.spacing + f.length;
          zones.push({ kind: f.kind, s0: a, s1: end, rows: range(a, end, 0.15), cols: [] });
          break;
        }
        case 'pave': {
          // Stones sit on a grid of f.stone from the section start (s) and the centreline (l). Rows at the stone
          // centres; the fine tier adds a column per stone centre across the asphalt.
          const rows: number[] = [a];
          for (let u = f.stone / 2; u < f.length; u += f.stone) rows.push(a + u);
          rows.push(a + f.length);
          const cols: number[] = [];
          if (fine) for (let l = (Math.ceil(-hw / f.stone - 0.5) + 0.5) * f.stone; l < hw; l += f.stone) cols.push(l);
          zones.push({ kind: f.kind, s0: a, s1: a + f.length, rows, cols });
          break;
        }
        case 'vertical-curve':
          break; // part of the smooth macro elevation: the base rows resolve it
      }
    }
  }
  return zones;
}

/** Sorted unique values (tolerance EPS). */
function uniqueSorted(values: number[]): number[] {
  values.sort((x, y) => x - y);
  const out: number[] = [];
  for (const v of values) if (out.length === 0 || v - out[out.length - 1]! > EPS) out.push(v);
  return out;
}

/** Row stations in [0, L): a uniform base grid (so the loop closes evenly) minus zone interiors, plus zone rows. */
export function rowStations(length: number, resolution: number, zones: readonly Zone[]): number[] {
  const n = Math.ceil(length / resolution);
  const rows: number[] = [];
  for (let k = 0; k < n; k++) {
    const s = (k * length) / n;
    if (!zones.some((z) => s > z.s0 + EPS && s < z.s1 - EPS)) rows.push(s);
  }
  for (const z of zones) for (const s of z.rows) if (s >= 0 && s < length) rows.push(s);
  return uniqueSorted(rows);
}

/** The ribbon is drawn in this many pieces along s so off-screen parts are frustum-culled (2 groups each, 3 with the pavé). */
export const CHUNKS = 4;

export interface Ribbon {
  /** The whole ribbon (groups per surface); used for normals and checks, not drawn. */
  readonly geometry: BufferGeometry;
  /** Drawn pieces: share the attributes of `geometry`, own an index and groups (materialIndex = SURFACES order). */
  readonly chunks: readonly BufferGeometry[];
  /** Band boundaries across the road, m (left = +). */
  readonly bands: readonly number[];
  readonly rows: number;
}

/** Row spacing where a world zone overlays the ribbon, m. */
const CUT_ROW = 0.25;
/** Lateral scan step for a zone edge crossing a row, m. */
const CUT_SCAN = 0.5;

/** Half-width of the GroundWorld's road-to-terrain blend round the runoff edge, m (sim-core world/ground.ts EDGE_BLEND). */
const EDGE_BLEND = 0.5;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The simulation's ground: the ribbon's outer EDGE_BLEND metres follow it, and world zones that overlay the ribbon (the
 *  link roads where they join the loop) cut it. */
export interface RibbonGround {
  readonly world: GroundWorld;
  /** World zones (any order); only those reaching the corridor matter. */
  readonly zones?: readonly CompiledZone[];
}

interface CutSpan {
  readonly s0: number;
  readonly s1: number;
  readonly zones: readonly CompiledZone[];
}

/** s spans of the ribbon that the cut zones (footprint + ZONE_EDGE band) reach. */
function cutSpans(track: BuiltTrack, cut: Required<RibbonGround>, outer: number): CutSpan[] {
  const fr: Frenet = { s: 0, l: 0, heading: 0, curvature: 0, converged: true };
  const p = { x: 0, y: 0 };
  const spans: CutSpan[] = [];
  for (const z of cut.zones) {
    let s0 = Infinity;
    let s1 = -Infinity;
    const span = z.length + 2 * ZONE_EDGE;
    // coarse pass along the centre line first: a zone whose centre stays far from the loop never reaches the ribbon
    let near = false;
    for (let u = 0; u <= span && !near; u += 5) {
      z.toWorld(-ZONE_EDGE + u, 0, p);
      cut.world.project(p.x, p.y, NaN, fr);
      near = Math.abs(fr.l) < outer + z.halfWidth + 6;
    }
    if (!near) continue;
    const nu = Math.ceil(span / 0.25);
    for (let i = 0; i <= nu; i++)
      for (const w of [-z.halfWidth - ZONE_EDGE, 0, z.halfWidth + ZONE_EDGE]) {
        z.toWorld(-ZONE_EDGE + (i / nu) * span, w, p);
        cut.world.project(p.x, p.y, NaN, fr);
        if (Math.abs(fr.l) > outer + 1) continue;
        s0 = Math.min(s0, fr.s);
        s1 = Math.max(s1, fr.s);
      }
    if (s0 <= s1) spans.push({ s0: Math.max(0, s0 - 1), s1: Math.min(track.length, s1 + 1), zones: [z] });
  }
  return spans;
}

/** Builds the ribbon geometry. `resolution` = the tier's `trackResolution`; `fine` = high tier. The ribbon runs
 *  EDGE_BLEND past the runoff edge, where its heights are the GroundWorld's road-to-terrain blend (`world.sample`), so the
 *  terrain mesh starts where the ground is the terrain alone. Under a world zone that reaches the ribbon (a link road) it
 *  follows `world.sample` where the zone contributes, has columns on the zone's footprint and band edges and leaves out
 *  the triangles inside the footprint: the zone's own mesh is the surface there. Without `ground` the bare GroundWorld
 *  of the track is used. */
export function buildRibbon(track: BuiltTrack, resolution: number, fine: boolean, ground?: RibbonGround): Ribbon {
  const world = ground?.world ?? buildGroundWorld(track, null);
  const cut = ground?.zones?.length ? { world, zones: ground.zones } : undefined;
  const L = track.length;
  const hw = track.def.width / 2;
  const kw = track.def.kerbWidth;
  const runoff = hw + kw + track.def.runoff;
  const outer = runoff + EDGE_BLEND;
  const edges = [hw, hw + kw, hw + kw + APRON, outer];
  const bands = [...edges.map((e) => -e).reverse(), ...edges];
  // Band surfaces left to right across `bands` (index b covers bands[b]..bands[b + 1]).
  const bandSurface: Surface[] = ['grass', 'road', 'road', 'road', 'road', 'road', 'grass'];
  const ASPHALT_BAND = 3;
  const baseCols = uniqueSorted([
    ...bands,
    ...range(-Math.floor(hw / RAIL) * RAIL, Math.floor(hw / RAIL) * RAIL, RAIL),
    ...range(runoff - EDGE_BLEND, outer, EDGE_BLEND / 2).flatMap((l) => [l, -l]),
  ]);

  const zones = featureZones(track, fine);
  const spans = cut ? cutSpans(track, cut, outer) : [];
  const loc = createZoneLocal();
  const p2 = { x: 0, y: 0, z: 0 };
  /** Zone edge crossings (footprint, band middle, band edge) of the row at s, l in (-outer, outer). */
  const crossings = (s: number, span: CutSpan): number[] => {
    const out: number[] = [];
    const levels = [0, ZONE_EDGE / 2, ZONE_EDGE];
    for (const z of span.zones) {
      const signed = (l: number) => {
        track.toWorld(s, l, p2);
        z.local(p2.x, p2.y, loc);
        return loc.inside >= 0 ? -loc.inside : loc.outside;
      };
      let la = -outer;
      let da = signed(la);
      for (let l = -outer + CUT_SCAN; l <= outer + EPS; l += CUT_SCAN) {
        const db = signed(l);
        // signed() changes by at most |dl| between samples: far from the zone no level can be crossed
        if (Math.min(da, db) - CUT_SCAN <= ZONE_EDGE)
          for (const lv of levels)
            if ((da - lv) * (db - lv) < 0) {
              let a = la;
              let b = l;
              for (let k = 0; k < 18; k++) {
                const m = (a + b) / 2;
                if ((signed(m) - lv) * (da - lv) > 0) a = m;
                else b = m;
              }
              out.push((a + b) / 2);
            }
        la = l;
        da = db;
      }
    }
    return out;
  };
  for (const sp of spans) zones.push({ kind: 'world-zone', s0: sp.s0, s1: sp.s1, rows: range(sp.s0, sp.s1, CUT_ROW), cols: [] });
  const spanAt = (s: number) => spans.find((sp) => s >= sp.s0 - EPS && s <= sp.s1 + EPS);
  const stations = rowStations(L, resolution, zones);
  const paveZones = zones.filter((z) => z.kind === 'pave');
  const strikeZones = zones.filter((z) => z.kind === 'kerb-strike');

  // Columns per row; the closing row (s = L) repeats row 0 so the loop has no seam.
  const rowCols = stations.map((s) => {
    const extra = zones.filter((z) => s >= z.s0 - EPS && s <= z.s1 + EPS).flatMap((z) => z.cols);
    const sp = spanAt(s);
    if (sp) extra.push(...crossings(s, sp));
    return extra.length ? uniqueSorted([...baseCols, ...extra.filter((l) => l > -outer && l < outer)]) : baseCols;
  });
  stations.push(L);
  rowCols.push(rowCols[0]!);

  const rowStart: number[] = [];
  let count = 0;
  for (const cols of rowCols) {
    rowStart.push(count);
    count += cols.length;
  }
  const position = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const paint = new Float32Array(count * 2);
  const sample: TrackSample = { s: 0, x: 0, y: 0, z: 0, heading: 0, curvature: 0, bank: 0, grade: 0 };
  const hit: GroundHit = { h: 0, base: 0, surface: 'asphalt', zone: '', s: NaN, l: NaN };
  /** Terrain at +runoff, -runoff, +outer, -outer of the current row. */
  const edgeT = new Float64Array(4);

  for (let r = 0; r < stations.length; r++) {
    const s = stations[r]!;
    const cutRow = spanAt(s) !== undefined;
    track.sample(s, sample);
    const sin = Math.sin(sample.heading);
    const cos = Math.cos(sample.heading);
    const line = track.lineOffset(s);
    const radius = 1 / Math.max(Math.abs(sample.curvature), 1e-9);
    const corner = Math.min(1, Math.max(0, (KERB_PAINT_RADIUS[1] - radius) / (KERB_PAINT_RADIUS[1] - KERB_PAINT_RADIUS[0])));
    // Lateral side (+1 left, -1 right) of a kerb strike covering this row, 0 if none.
    const strike = strikeZones.find((z) => s >= z.s0 && s <= z.s1)?.cols[0] ?? 0;
    const cols = rowCols[r]!;
    // Terrain at the runoff edge and EDGE_BLEND past it on both sides (the GroundWorld blends road -> terrain by
    // smoothstep over runoff +- EDGE_BLEND; at runoff the weight is 1/2, at outer 1): the band's columns between them take
    // the terrain linearly in l (it is smooth there) and the road exactly.
    for (const side of [1, -1] as const) {
      const at = (l: number) => world.sample(sample.x - sin * l, sample.y + cos * l, s, hit).h;
      const t1 = at(side * outer);
      const t0 = 2 * at(side * runoff) - track.roadHeight(s, side * runoff);
      edgeT[side > 0 ? 0 : 1] = t0;
      edgeT[side > 0 ? 2 : 3] = t1;
    }
    for (let c = 0; c < cols.length; c++) {
      const l = cols[c]!;
      const v = rowStart[r]! + c;
      // Same formula as BuiltTrack.toWorld, then simToThree (x, z, -y).
      position[v * 3] = sample.x - sin * l;
      let h = track.roadHeight(s, l);
      const a = Math.abs(l);
      if (a > runoff - EDGE_BLEND + EPS) {
        const k = l > 0 ? 0 : 1;
        const t = edgeT[k]! + ((edgeT[k + 2]! - edgeT[k]!) * (a - runoff)) / EDGE_BLEND;
        h += (t - h) * smoothstep(runoff - EDGE_BLEND, outer, a);
      }
      if (cutRow) {
        // wherever a zone contributes (s NaN) the ground is the GroundWorld's zone blend
        world.sample(sample.x - sin * l, sample.y + cos * l, s, hit);
        if (hit.s !== hit.s) h = hit.h;
      }
      position[v * 3 + 1] = h;
      position[v * 3 + 2] = -(sample.y + cos * l);
      uv[v * 2] = l;
      uv[v * 2 + 1] = s;
      const dl = Math.abs(Math.abs(l - line) - WHEEL_HALF_TRACK) / WEAR_WIDTH;
      paint[v * 2] = Math.exp(-dl * dl);
      paint[v * 2 + 1] = strike * l > 0 ? 1 : corner;
    }
  }

  const indices = Array.from({ length: CHUNKS }, (): Record<Surface, number[]> => ({ road: [], cobbles: [], grass: [] }));
  for (let r = 0; r + 1 < stations.length; r++) {
    const mid = (stations[r]! + stations[r + 1]!) / 2;
    const chunk = indices[Math.min(CHUNKS - 1, Math.floor((mid / L) * CHUNKS))]!;
    const paved = paveZones.some((z) => mid > z.s0 && mid < z.s1);
    const span = spanAt(mid);
    /** false = the triangle lies inside a cut zone's footprint (that zone's mesh draws it). */
    const keep = (i: number, j: number, k: number): boolean => {
      if (!span) return true;
      const cs = (uv[i * 2 + 1]! + uv[j * 2 + 1]! + uv[k * 2 + 1]!) / 3;
      const cl = (uv[i * 2]! + uv[j * 2]! + uv[k * 2]!) / 3;
      track.toWorld(cs, cl, p2);
      for (const z of span.zones) if (z.local(p2.x, p2.y, loc).inside > 0) return false;
      return true;
    };
    const a = rowCols[r]!;
    const b = rowCols[r + 1]!;
    let ia = 0;
    let ib = 0;
    for (let k = 0; k + 1 < bands.length; k++) {
      const hi = bands[k + 1]!;
      const surface = k === ASPHALT_BAND && paved ? 'cobbles' : bandSurface[k]!;
      const out = chunk[surface];
      // Merge walk from the band's left edge column to its right edge column in both rows.
      let ea = ia;
      while (a[ea]! < hi - EPS) ea++;
      let eb = ib;
      while (b[eb]! < hi - EPS) eb++;
      const A = rowStart[r]!;
      const B = rowStart[r + 1]!;
      while (ia < ea || ib < eb) {
        if (ib === eb || (ia < ea && a[ia + 1]! <= b[ib + 1]! + EPS)) {
          if (keep(A + ia, B + ib, A + ia + 1)) out.push(A + ia, B + ib, A + ia + 1);
          ia++;
        } else {
          if (keep(A + ia, B + ib, B + ib + 1)) out.push(A + ia, B + ib, B + ib + 1);
          ib++;
        }
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  geometry.setAttribute('aPaint', new BufferAttribute(paint, 2));
  const IndexArray = count > 65535 ? Uint32Array : Uint16Array;
  const grouped = (parts: readonly Record<Surface, number[]>[], into: BufferGeometry): BufferGeometry => {
    const all: number[] = [];
    SURFACES.forEach((surface, materialIndex) => {
      const start = all.length;
      for (const part of parts) for (const i of part[surface]) all.push(i);
      if (all.length > start) into.addGroup(start, all.length - start, materialIndex);
    });
    into.setIndex(new BufferAttribute(new IndexArray(all), 1));
    return into;
  };
  grouped(indices, geometry);
  geometry.computeVertexNormals();
  // Weld the closing row's normals to row 0 (same positions, different UV).
  const normal = geometry.getAttribute('normal') as BufferAttribute;
  const first = rowStart[0]!;
  const last = rowStart[stations.length - 1]!;
  for (let c = 0; c < rowCols[0]!.length; c++) {
    for (let k = 0; k < 3; k++) {
      const sum = normal.array[(first + c) * 3 + k]! + normal.array[(last + c) * 3 + k]!;
      normal.array[(first + c) * 3 + k] = normal.array[(last + c) * 3 + k] = sum;
    }
  }
  geometry.normalizeNormals();
  geometry.computeBoundingSphere();
  const chunks = indices.map((part) => {
    const g = new BufferGeometry();
    for (const name of ['position', 'normal', 'uv', 'aPaint']) g.setAttribute(name, geometry.getAttribute(name));
    grouped([part], g);
    // Bounding sphere of this chunk's own vertices (computeBoundingSphere would span the shared buffer).
    const box = new Box3();
    const p = new Vector3();
    const idx = g.getIndex()!;
    for (let i = 0; i < idx.count; i++) box.expandByPoint(p.fromBufferAttribute(geometry.getAttribute('position'), idx.getX(i)));
    g.boundingBox = box;
    g.boundingSphere = box.getBoundingSphere(new Sphere());
    return g;
  });
  return { geometry, chunks, bands, rows: stations.length };
}
