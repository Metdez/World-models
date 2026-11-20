/**
 * The road ribbon (research 11 §A.5), sampled from the simulation's own surface: every vertex is
 * `track.toWorld(s, l)` (z = `roadHeight(s, l)`), so the wheels sit on what is drawn. Rows follow the tier's
 * resolution plus denser rows inside each closed-form feature; each row carries its own lateral columns and
 * consecutive rows are stitched by a merge walk (no T-junction cracks where the column sets differ).
 * UV = (l, s) in metres. Material groups follow the cross-section bands.
 */
import { Box3, BufferAttribute, BufferGeometry, Sphere, Vector3 } from 'three';
import type { BuiltTrack, RoadFeature, TrackSample } from '../../contracts/track';

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
  readonly kind: RoadFeature['kind'];
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

/** Builds the ribbon geometry. `resolution` = the tier's `trackResolution`; `fine` = high tier. */
export function buildRibbon(track: BuiltTrack, resolution: number, fine: boolean): Ribbon {
  const L = track.length;
  const hw = track.def.width / 2;
  const kw = track.def.kerbWidth;
  const outer = hw + kw + track.def.runoff;
  const edges = [hw, hw + kw, hw + kw + APRON, outer];
  const bands = [...edges.map((e) => -e).reverse(), ...edges];
  // Band surfaces left to right across `bands` (index b covers bands[b]..bands[b + 1]).
  const bandSurface: Surface[] = ['grass', 'road', 'road', 'road', 'road', 'road', 'grass'];
  const ASPHALT_BAND = 3;
  const baseCols = uniqueSorted([
    ...bands,
    ...range(-Math.floor(hw / RAIL) * RAIL, Math.floor(hw / RAIL) * RAIL, RAIL),
  ]);

  const zones = featureZones(track, fine);
  const stations = rowStations(L, resolution, zones);
  const paveZones = zones.filter((z) => z.kind === 'pave');
  const strikeZones = zones.filter((z) => z.kind === 'kerb-strike');

  // Columns per row; the closing row (s = L) repeats row 0 so the loop has no seam.
  const rowCols = stations.map((s) => {
    const extra = zones.filter((z) => s >= z.s0 - EPS && s <= z.s1 + EPS).flatMap((z) => z.cols);
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

  for (let r = 0; r < stations.length; r++) {
    const s = stations[r]!;
    track.sample(s, sample);
    const sin = Math.sin(sample.heading);
    const cos = Math.cos(sample.heading);
    const line = track.lineOffset(s);
    const radius = 1 / Math.max(Math.abs(sample.curvature), 1e-9);
    const corner = Math.min(1, Math.max(0, (KERB_PAINT_RADIUS[1] - radius) / (KERB_PAINT_RADIUS[1] - KERB_PAINT_RADIUS[0])));
    // Lateral side (+1 left, -1 right) of a kerb strike covering this row, 0 if none.
    const strike = strikeZones.find((z) => s >= z.s0 && s <= z.s1)?.cols[0] ?? 0;
    const cols = rowCols[r]!;
    for (let c = 0; c < cols.length; c++) {
      const l = cols[c]!;
      const v = rowStart[r]! + c;
      // Same formula as BuiltTrack.toWorld, then simToThree (x, z, -y).
      position[v * 3] = sample.x - sin * l;
      position[v * 3 + 1] = track.roadHeight(s, l);
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
          out.push(A + ia, B + ib, A + ia + 1);
          ia++;
        } else {
          out.push(A + ia, B + ib, B + ib + 1);
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
