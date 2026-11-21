/**
 * Projection of a world point onto the loop centreline (ARCHITECTURE-M2 §7.1, research m2/09 §3): Newton on
 * f(s) = (p - r(s)) . t(s) with the arc-exact step atan2(f kappa, 1 - kappa d) / kappa (= f / (1 - kappa d) to first
 * order; it stays bounded inside a tight radius, where the plain Newton denominator vanishes), started from every local
 * nearest node that a precomputed 8 m grid lists for the point's cell (09-04): the result is the GLOBAL nearest point, a
 * function of (x, y) alone. The hint is no longer used: a warm start kept a wheel projected on the section it came from
 * after it crossed the line where another section becomes nearer, so the ground under it depended on its history.
 * The grid's "far" runs (every node within MAX_REACH of the nearest point) serve the terrain blend. Pure,
 * allocation-free.
 */
import type { BuiltTrack, TrackSample } from '../../contracts/track';
import type { Frenet } from '../../contracts/world';
import { wrap } from '../math/interp';
import { datan2, dcos, dsin } from '../math/det';

/** Node spacing of the candidate search, m. */
const NODE_STEP = 2;
/** Newton: max iterations, convergence step (m), step clamp (m). */
const MAX_IT = 8;
const TOL = 1e-5;
const MAX_STEP = 10;
/** Candidate grid: cell size (m), margin around the node bounding box (m). */
const CELL = 8;
const GRID_MARGIN = 110;
/** The terrain blend's reach beyond the nearest point (world/terrain.ts), m. */
export const MAX_REACH = 30;

export type LoopProjector = (x: number, y: number, hint: number, out: Frenet) => Frenet;

export interface ProjectorCore {
  /** Global nearest point; the hint is ignored (see the header). */
  readonly project: LoopProjector;
  /** Newton samples of the last call (diagnostics/tests). */
  readonly iterations: () => number;
  /** Track sample at the nearest point of the last call (heading, curvature, bank, z). */
  readonly sample: TrackSample;
  /** Centreline nodes (every `step` m of s, node i at s = i * step). */
  readonly nodes: { readonly x: Float64Array; readonly y: Float64Array; readonly step: number };
  /**
   * Node runs ((start, length) pairs in `runs`, never wrapping) holding every node within MAX_REACH of the nearest
   * centreline point of any query in (x, y)'s grid cell: writes the [from, to) indices into `runs` to `out`.
   */
  cellRuns(x: number, y: number, out: Int32Array): void;
  readonly runs: Int32Array;
}

export function createProjectorCore(track: BuiltTrack): ProjectorCore {
  const L = track.length;
  const n = Math.ceil(L / NODE_STEP);
  const step = L / n;
  const nx = new Float64Array(n);
  const ny = new Float64Array(n);
  const ts: TrackSample = { s: 0, x: 0, y: 0, z: 0, heading: 0, curvature: 0, bank: 0, grade: 0 };
  for (let i = 0; i < n; i++) {
    track.sample(i * step, ts);
    nx[i] = ts.x;
    ny[i] = ts.y;
  }
  const it = new Int32Array(1);
  /** [s, l] of the last Newton run. */
  const res = new Float64Array(2);

  /** Newton from s0; true when converged. Writes res and ts. */
  function newton(px: number, py: number, s0: number): boolean {
    let s = s0;
    for (let k = 0; k < MAX_IT; k++) {
      track.sample(s, ts);
      it[0] = it[0]! + 1;
      const dx = px - ts.x;
      const dy = py - ts.y;
      const c = dcos(ts.heading);
      const sn = dsin(ts.heading);
      const f = dx * c + dy * sn;
      const d = -dx * sn + dy * c;
      // Exact for an arc (rotate about its centre of curvature), Newton f / (1 - kappa d) on a straight.
      const k = ts.curvature;
      const kd = 1 - k * d;
      const raw = Math.abs(k) < 1e-7 ? f / Math.max(0.2, kd) : datan2(f * k, kd) / k;
      const ds = Math.max(-MAX_STEP, Math.min(MAX_STEP, raw));
      s = wrap(s + ds, L);
      if (Math.abs(ds) < TOL) {
        res[0] = s;
        res[1] = d;
        return true;
      }
    }
    return false;
  }

  // ---- grids: per cell the node runs that can hold the nearest point of a query in it ("near": every local minimum
  // within one node spacing of the nearest node) and every node within MAX_REACH of it ("far": terrain blending)
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, nx[i]!);
    maxX = Math.max(maxX, nx[i]!);
    minY = Math.min(minY, ny[i]!);
    maxY = Math.max(maxY, ny[i]!);
  }
  const gx0 = minX - GRID_MARGIN;
  const gy0 = minY - GRID_MARGIN;
  const cols = Math.ceil((maxX - minX + 2 * GRID_MARGIN) / CELL);
  const rows = Math.ceil((maxY - minY + 2 * GRID_MARGIN) / CELL);
  const cells = cols * rows;
  const nearStart = new Int32Array(cells + 1);
  const farStart = new Int32Array(cells + 1);
  const nearList: number[] = [];
  const farList: number[] = [];
  {
    const half = (CELL * Math.SQRT2) / 2;
    const d = new Float64Array(n);
    const runsWithin = (lim: number, list: number[]): void => {
      let i = 0;
      while (i < n) {
        if (d[i]! <= lim) {
          const a = i;
          while (i < n && d[i]! <= lim) i++;
          list.push(a, i - a);
        } else i++;
      }
    };
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const px = gx0 + (c + 0.5) * CELL;
        const py = gy0 + (r + 0.5) * CELL;
        let best = Infinity;
        for (let i = 0; i < n; i++) {
          const dx = px - nx[i]!;
          const dy = py - ny[i]!;
          d[i] = Math.sqrt(dx * dx + dy * dy);
          if (d[i]! < best) best = d[i]!;
        }
        // a query in the cell is within `half` of the centre: its nearest node within best + half of the centre, so
        // any node as near (+ one spacing: nodes sample the curve) within best + 2 half + 2 step; far: + MAX_REACH
        const k = r * cols + c;
        nearStart[k] = nearList.length;
        runsWithin(best + 2 * half + 2 * step, nearList);
        farStart[k] = farList.length;
        runsWithin(best + 2 * half + MAX_REACH + 2 * step, farList);
      }
    }
    nearStart[cells] = nearList.length;
    farStart[cells] = farList.length;
  }
  // a last run of all nodes for queries outside the grid
  const nearRuns = Int32Array.from([...nearList, 0, n]);
  const runs = Int32Array.from([...farList, 0, n]);
  const cellOf = (x: number, y: number): number => {
    const c = Math.floor((x - gx0) / CELL);
    const r = Math.floor((y - gy0) / CELL);
    return c >= 0 && r >= 0 && c < cols && r < rows ? r * cols + c : -1;
  };
  function cellRuns(x: number, y: number, out: Int32Array): void {
    const k = cellOf(x, y);
    out[0] = k < 0 ? farList.length : farStart[k]!;
    out[1] = k < 0 ? farList.length + 2 : farStart[k + 1]!;
  }
  const dist2 = (px: number, py: number, i: number): number => {
    const k = i < 0 ? i + n : i >= n ? i - n : i;
    const dx = px - nx[k]!;
    const dy = py - ny[k]!;
    return dx * dx + dy * dy;
  };

  /**
   * Global nearest point into res and ts: Newton from every local minimum of the node distance within one node
   * spacing of the nearest node (a point near the medial line of two sections has two), the nearer result wins.
   */
  function nearest(x: number, y: number): void {
    it[0] = 0;
    const k = cellOf(x, y);
    const r0 = k < 0 ? nearList.length : nearStart[k]!;
    const r1 = k < 0 ? nearList.length + 2 : nearStart[k + 1]!;
    let best = Infinity;
    for (let j = r0; j < r1; j += 2) {
      const a = nearRuns[j]!;
      const end = a + nearRuns[j + 1]!;
      for (let i = a; i < end; i++) {
        const dx = x - nx[i]!;
        const dy = y - ny[i]!;
        const dd = dx * dx + dy * dy;
        if (dd < best) best = dd;
      }
    }
    const lim = Math.sqrt(best) + step;
    const lim2 = lim * lim;
    let bestS = 0;
    let bestL = Infinity;
    for (let j = r0; j < r1; j += 2) {
      const a = nearRuns[j]!;
      const end = a + nearRuns[j + 1]!;
      let dPrev = dist2(x, y, a - 1);
      let dCur = dist2(x, y, a);
      for (let i = a; i < end; i++) {
        const dNext = dist2(x, y, i + 1);
        if (dCur <= lim2 && dCur <= dPrev && dCur < dNext) {
          const s0 = i * step;
          if (!newton(x, y, s0)) {
            // not converged (a point near a centre of curvature): the node with its perpendicular offset
            track.sample(s0, ts);
            res[0] = s0;
            res[1] = -(x - ts.x) * dsin(ts.heading) + (y - ts.y) * dcos(ts.heading);
          }
          if (Math.abs(res[1]!) < Math.abs(bestL)) {
            bestS = res[0]!;
            bestL = res[1]!;
          }
        }
        dPrev = dCur;
        dCur = dNext;
      }
    }
    if (bestL === Infinity) {
      // no strict local minimum (equal distances): the nearest node
      let bi = 0;
      for (let i = 1; i < n; i++) if (dist2(x, y, i) < dist2(x, y, bi)) bi = i;
      bestS = bi * step;
      track.sample(bestS, ts);
      bestL = -(x - ts.x) * dsin(ts.heading) + (y - ts.y) * dcos(ts.heading);
    }
    res[0] = bestS;
    res[1] = bestL;
    if (ts.s !== bestS) track.sample(bestS, ts);
  }

  const project: LoopProjector = (x, y, _hint, out) => {
    nearest(x, y);
    out.converged = true;
    out.s = res[0]!;
    out.l = res[1]!;
    out.heading = ts.heading;
    out.curvature = ts.curvature;
    return out;
  };

  return { project, iterations: () => it[0]!, sample: ts, nodes: { x: nx, y: ny, step }, cellRuns, runs };
}

export function createLoopProjector(track: BuiltTrack): LoopProjector {
  return createProjectorCore(track).project;
}
