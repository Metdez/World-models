/**
 * Ground out to the fogged horizon (research 11 §A.5), re-baked from the simulation's own GroundWorld (09-04, 10-03):
 * every visible vertex is `world.sample(x, y).h` (= `terrainHeight` off the ribbon and the zones, the road / terrain blend
 * in the 0.5 m past the ribbon edge): the blended loop terrain (continuous where two loop sections run close), the world
 * field and the zone skirts, so the drawn grass is the ground the car drives on. Hidden vertices (under the ribbon or a
 * zone mesh) are `terrainHeight`, which lies below those surfaces.
 * One indexed mesh: over the loop, the field and the zones (FINE region) 4 m cells, each split into four (to 2 m, then
 * 1 m) while the linear surface misses the function by more than TOLERANCE at its edge midpoints or centre and the cell is
 * not hidden under the ribbon or a zone (tested where the coarse grid bends); outside it cells grow geometrically to HORIZON. A cell next to finer cells is a
 * fan round its centre through every vertex on its edges, so no T-junction cracks. The terrain maths lives in sim-core
 * (`world/terrain.ts`): this file only samples it.
 */
import { BufferAttribute, BufferGeometry } from 'three';
import type { BuiltTrack, TrackSample } from '../../contracts/track';
import type { GroundHit, GroundWorld } from '../../contracts/world';
import { farField, loopTerrainHeight } from '../../sim-core/world/terrain';

/** The M1 single-section terrain profile, now sim-core's (kept as an alias for tests/sim-core/world-ground.test.ts). */
export const groundHeight: (track: BuiltTrack, x: number, y: number, s: number, l: number, sample: TrackSample) => number = loopTerrainHeight;

const CELL = 4;
/** Finest cell, m (two halvings of CELL). */
const MIN_CELL = 1;
const GROWTH = 1.25;
/** Half-size of the ground beyond the fine region, m (fog is opaque by about 700 m). */
const HORIZON = 4500;
/** Fine-cell margin round the loop, field and zones, m. */
const FINE_MARGIN = 40;
/** Largest linear-interpolation error accepted on visible ground, m. */
export const TOLERANCE = 0.01;
/** A coarse cell is tested for splitting only where the 4 m grid bends by more than this (second difference), m. */
const CANDIDATE = 0.02;
/** Beyond the runoff edge the loop terrain is the far field from this distance on (sim-core terrain BLEND_FAR = 220 m, plus
 *  the 30 m blend reach of the other sections), m. */
const FAR_REACH = 251;
/** Centreline sample step for the loop bounding box, m. */
const SEARCH_STEP = 2;

/** Axis coordinates: CELL steps over [lo, hi], then geometrically growing steps out to HORIZON. */
function axis(lo: number, hi: number): { values: number[]; inner0: number; innerN: number } {
  const n = Math.ceil((hi - lo) / CELL);
  const inner = Array.from({ length: n + 1 }, (_, i) => lo + i * CELL);
  const outer: number[] = [];
  for (let step = CELL * GROWTH, d = step; d < HORIZON; step *= GROWTH, d += step) outer.push(d);
  outer.push(HORIZON);
  return { values: [...outer.map((d) => lo - d).reverse(), ...inner, ...outer.map((d) => inner[n]! + d)], inner0: outer.length, innerN: n };
}

export interface TerrainStats {
  readonly vertices: number;
  readonly triangles: number;
  /** Leaves per size (4, 2, 1 m) in the fine region. */
  readonly leaves: readonly [number, number, number];
}

export function buildTerrain(track: BuiltTrack, world: GroundWorld): BufferGeometry & { userData: { stats?: TerrainStats } } {
  // Fine region: the loop, the world field (with its blend) and the zones.
  const sample: TrackSample = { s: 0, x: 0, y: 0, z: 0, heading: 0, curvature: 0, bank: 0, grade: 0 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const grow = (x0: number, y0: number, x1: number, y1: number) => {
    minX = Math.min(minX, x0);
    minY = Math.min(minY, y0);
    maxX = Math.max(maxX, x1);
    maxY = Math.max(maxY, y1);
  };
  for (let s = 0; s < track.length; s += SEARCH_STEP) {
    track.sample(s, sample);
    grow(sample.x, sample.y, sample.x, sample.y);
  }
  const loopBox = [minX, minY, maxX, maxY] as const;
  const f = world.def?.field;
  if (f) grow(f.minX - f.blend, f.minY - f.blend, f.maxX + f.blend, f.maxY + f.blend);
  const lo = (v: number) => Math.floor((v - FINE_MARGIN) / CELL) * CELL;
  const hi = (v: number) => Math.ceil((v + FINE_MARGIN) / CELL) * CELL;
  const ax = axis(lo(minX), hi(maxX));
  const ay = axis(lo(minY), hi(maxY));
  const xs = ax.values;
  const ys = ay.values;
  const w = xs.length;

  // Visible ground is what the car drives on (`sample`: in the 0.5 m band past the ribbon edge that is the road /
  // terrain blend); hidden ground (under the ribbon or a zone mesh) is the terrain function, which lies below them.
  const hit: GroundHit = { h: 0, base: 0, surface: 'grass', zone: '', s: NaN, l: NaN };
  let hidden = false;
  // Beyond REACH of the loop's bounding box and outside the field (with its blend) the ground is the far field alone.
  const reach = track.def.width / 2 + track.def.kerbWidth + track.def.runoff + FAR_REACH;
  const far = (x: number, y: number) =>
    (x < loopBox[0] - reach || x > loopBox[2] + reach || y < loopBox[1] - reach || y > loopBox[3] + reach) &&
    (!f || x < f.minX - f.blend || x > f.maxX + f.blend || y < f.minY - f.blend || y > f.maxY + f.blend);
  const heightAt = (x: number, y: number): number => {
    if (far(x, y)) {
      hidden = false;
      return farField(x, y);
    }
    world.sample(x, y, NaN, hit);
    hidden = hit.zone !== 'terrain' && hit.zone !== 'field';
    return hidden ? world.terrainHeight(x, y) : hit.h;
  };

  // Vertices: the whole axis grid, then the finer lattice points the quadtree uses.
  const pos: number[] = [];
  const hiddenGrid = new Uint8Array(xs.length * ys.length);
  for (const y of ys)
    for (const x of xs) {
      pos.push(x, heightAt(x, y), -y);
      hiddenGrid[pos.length / 3 - 1] = hidden ? 2 : 1;
    }

  const per = CELL / MIN_CELL; // lattice points per coarse cell
  const lx0 = xs[ax.inner0]!;
  const ly0 = ys[ay.inner0]!;
  const LW = ax.innerN * per + 1;
  const LH = ay.innerN * per + 1;
  const lattice = new Int32Array(LW * LH).fill(-1);
  const heights = new Float64Array(LW * LH).fill(NaN);
  const covered = new Uint8Array(LW * LH); // 1 = visible, 2 = hidden (once evaluated)
  for (let j = 0; j <= ay.innerN; j++)
    for (let i = 0; i <= ax.innerN; i++) {
      const v = (ay.inner0 + j) * w + ax.inner0 + i;
      lattice[j * per * LW + i * per] = v;
      heights[j * per * LW + i * per] = pos[v * 3 + 1]!;
      covered[j * per * LW + i * per] = hiddenGrid[v]!;
    }
  const height = (li: number, lj: number): number => {
    const k = lj * LW + li;
    if (heights[k] !== heights[k]) {
      heights[k] = heightAt(lx0 + li * MIN_CELL, ly0 + lj * MIN_CELL);
      covered[k] = hidden ? 2 : 1;
    }
    return heights[k]!;
  };
  const vertex = (li: number, lj: number): number => {
    const k = lj * LW + li;
    let v = lattice[k]!;
    if (v < 0) {
      v = pos.length / 3;
      pos.push(lx0 + li * MIN_CELL, height(li, lj), -(ly0 + lj * MIN_CELL));
      lattice[k] = v;
    }
    return v;
  };
  const isHidden = (li: number, lj: number): boolean => {
    const k = lj * LW + li;
    if (!covered[k]) {
      heightAt(lx0 + li * MIN_CELL, ly0 + lj * MIN_CELL);
      covered[k] = hidden ? 2 : 1;
    }
    return covered[k] === 2;
  };
  /** All four corners of coarse cell (i, j) hidden (it lies under the ribbon or a zone: never split). */
  const coarseHidden = (i: number, j: number): boolean => {
    const v = (ay.inner0 + j) * w + ax.inner0 + i;
    return hiddenGrid[v] === 2 && hiddenGrid[v + 1] === 2 && hiddenGrid[v + w] === 2 && hiddenGrid[v + w + 1] === 2;
  };
  /** Second difference of the coarse grid at inner node (i, j) along x and y (curvature proxy for the cell test). */
  const G = (i: number, j: number) => pos[((ay.inner0 + j) * w + ax.inner0 + i) * 3 + 1]!;
  const bend = (i: number, j: number): number =>
    Math.max(Math.abs(G(i - 1, j) - 2 * G(i, j) + G(i + 1, j)), Math.abs(G(i, j - 1) - 2 * G(i, j) + G(i, j + 1)));

  // Quadtree leaves (lattice x, y, size in lattice units).
  const leaves: number[] = [];
  const used = new Uint8Array(LW * LH);
  const counts: [number, number, number] = [0, 0, 0];
  const refine = (i: number, j: number, s: number) => {
    const h2 = s / 2;
    let split = false;
    if (s > 1) {
      const a = height(i, j);
      const b = height(i + s, j);
      const c = height(i, j + s);
      const d = height(i + s, j + s);
      // the unsplit cell is two triangles on the (b, c) diagonal
      const err = Math.max(
        Math.abs(height(i + h2, j) - (a + b) / 2),
        Math.abs(height(i, j + h2) - (a + c) / 2),
        Math.abs(height(i + s, j + h2) - (b + d) / 2),
        Math.abs(height(i + h2, j + s) - (c + d) / 2),
        Math.abs(height(i + h2, j + h2) - (b + c) / 2),
      );
      split = err > TOLERANCE && !(isHidden(i, j) && isHidden(i + s, j) && isHidden(i, j + s) && isHidden(i + s, j + s) && isHidden(i + h2, j + h2));
    }
    if (split) {
      refine(i, j, h2);
      refine(i + h2, j, h2);
      refine(i, j + h2, h2);
      refine(i + h2, j + h2, h2);
      return;
    }
    leaves.push(i, j, s);
    counts[s === per ? 0 : s === per / 2 ? 1 : 2]++;
    used[j * LW + i] = used[j * LW + i + s] = used[(j + s) * LW + i] = used[(j + s) * LW + i + s] = 1;
  };
  for (let j = 0; j < ay.innerN; j++)
    for (let i = 0; i < ax.innerN; i++) {
      const border = i === 0 || j === 0 || i === ax.innerN - 1 || j === ay.innerN - 1;
      if (border) {
        leaves.push(i * per, j * per, per);
        counts[0]++;
        const p = j * per * LW + i * per;
        used[p] = used[p + per] = used[p + per * LW] = used[p + per * LW + per] = 1;
      } else if (!coarseHidden(i, j) && Math.max(bend(i, j), bend(i + 1, j), bend(i, j + 1), bend(i + 1, j + 1)) > CANDIDATE) refine(i * per, j * per, per);
      else {
        leaves.push(i * per, j * per, per);
        counts[0]++;
        const p = j * per * LW + i * per;
        used[p] = used[p + per] = used[p + per * LW] = used[p + per * LW + per] = 1;
      }
    }

  const index: number[] = [];
  // Outer ring: plain cells of the axis grid.
  for (let j = 0; j + 1 < ys.length; j++)
    for (let i = 0; i + 1 < w; i++) {
      const inner = i >= ax.inner0 && i < ax.inner0 + ax.innerN && j >= ay.inner0 && j < ay.inner0 + ay.innerN;
      if (inner) continue;
      const a = j * w + i;
      // rows go +y (three -z), columns +x: (a, a+1, a+w) is counter-clockwise seen from above
      index.push(a, a + 1, a + w, a + 1, a + w + 1, a + w);
    }
  // Fine region: two triangles, or a fan round the centre through the finer neighbours' vertices on the edges.
  const ring: number[] = [];
  for (let k = 0; k < leaves.length; k += 3) {
    const i = leaves[k]!;
    const j = leaves[k + 1]!;
    const s = leaves[k + 2]!;
    ring.length = 0;
    const visit = (li: number, lj: number) => {
      if (used[lj * LW + li]) ring.push(vertex(li, lj));
    };
    for (let t = 0; t < s; t++) visit(i + t, j); // bottom, +x
    for (let t = 0; t < s; t++) visit(i + s, j + t); // right, +y
    for (let t = s; t > 0; t--) visit(i + t, j + s); // top, -x
    for (let t = s; t > 0; t--) visit(i, j + t); // left, -y
    if (ring.length === 4) {
      const [a, b, d, c] = ring as [number, number, number, number];
      index.push(a, b, c, b, d, c);
    } else {
      const centre = vertex(i + s / 2, j + s / 2);
      for (let t = 0; t < ring.length; t++) index.push(centre, ring[t]!, ring[(t + 1) % ring.length]!);
    }
  }

  const geometry = new BufferGeometry() as BufferGeometry & { userData: { stats?: TerrainStats } };
  const count = pos.length / 3;
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geometry.setIndex(new BufferAttribute(count > 65535 ? new Uint32Array(index) : new Uint16Array(index), 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData.stats = { vertices: count, triangles: index.length / 3, leaves: counts };
  return geometry;
}
