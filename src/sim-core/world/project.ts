/**
 * Projection of a world point onto the loop centreline (ARCHITECTURE-M2 §7.1, research m2/09 §3): warm-started Newton
 * on f(s) = (p - r(s)) . t(s) with the arc-exact step atan2(f kappa, 1 - kappa d) / kappa (= f / (1 - kappa d) to first
 * order; it stays bounded inside a tight radius, where the plain Newton denominator vanishes), with a
 * strided fallback over precomputed nodes (+-60 m around the hint, else the whole loop). Pure, allocation-free.
 * The loop's non-adjacent sections keep >= 30 m clearance (the hairpin finger is 41 m from the launch straight), so a
 * point within the 18 m corridor has one nearest section.
 */
import type { BuiltTrack, TrackSample } from '../../contracts/track';
import type { Frenet } from '../../contracts/world';
import { wrap } from '../math/interp';
import { datan2, dcos, dsin } from '../math/det';

/** Node spacing of the fallback search, m. */
const NODE_STEP = 2;
/** Fallback search span around a finite hint, m. */
const WINDOW = 60;
/** Newton: max iterations, convergence step (m), step clamp (m). */
const MAX_IT = 8;
const TOL = 1e-5;
const MAX_STEP = 10;
/** A cold (strided) search whose Newton result lies farther than this re-checks against the whole loop, m. */
const FAR = 25;

export type LoopProjector = (x: number, y: number, hint: number, out: Frenet) => Frenet;

export interface ProjectorCore {
  readonly project: LoopProjector;
  /** Newton samples of the last call (diagnostics/tests). */
  readonly iterations: () => number;
  /** Track sample at the last Newton iterate (heading, curvature, bank, z at ~out.s). */
  readonly sample: TrackSample;
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

  /** Nearest node over [from, from + count) (wrapped), as an arc length. */
  function scan(px: number, py: number, from: number, count: number): number {
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < count; k++) {
      const i = (((from + k) % n) + n) % n;
      const dx = px - nx[i]!;
      const dy = py - ny[i]!;
      const dd = dx * dx + dy * dy;
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    }
    return best * step;
  }

  const project: LoopProjector = (x, y, hint, out) => {
    it[0] = 0;
    let ok = false;
    const warm = hint === hint;
    // A warm start that converges near its hint is the nearest point whatever the distance (the loop's branches are
    // far apart in s); FAR only guards the cold searches below.
    if (warm) ok = newton(x, y, wrap(hint, L));
    if (ok && warm) {
      // A converged jump of more than the span means Newton slid onto another branch: re-check (span).
      let ds = Math.abs(res[0]! - wrap(hint, L));
      if (ds > L / 2) ds = L - ds;
      if (ds > WINDOW) ok = false;
    }
    out.converged = ok;
    if (!ok) {
      const s0 = warm ? scan(x, y, Math.floor((wrap(hint, L) - WINDOW) / step), Math.ceil((2 * WINDOW) / step) + 1) : scan(x, y, 0, n);
      if (!newton(x, y, s0) || (warm && Math.abs(res[1]!) > FAR)) {
        if (!newton(x, y, scan(x, y, 0, n))) {
          // Not converged even from the nearest node (a point near a centre of curvature): take the node itself.
          const sn = scan(x, y, 0, n);
          track.sample(sn, ts);
          res[0] = sn;
          res[1] = -(x - ts.x) * dsin(ts.heading) + (y - ts.y) * dcos(ts.heading);
        }
      }
    }
    out.s = res[0]!;
    out.l = res[1]!;
    out.heading = ts.heading;
    out.curvature = ts.curvature;
    return out;
  };

  return { project, iterations: () => it[0]!, sample: ts };
}

export function createLoopProjector(track: BuiltTrack): LoopProjector {
  return createProjectorCore(track).project;
}
