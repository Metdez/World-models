/**
 * Reference lines for the PathDriver (ARCHITECTURE-M2 §7.1, §7.9; research m2/09 §2.5, §3).
 * `loopLine`: the Auto driving line of the loop — the GLOBAL nearest centreline point (world.project), the driving-line
 * offset knots (`track.lineOffset`), and heading, curvature, speed and acceleration exactly as the speed profile's
 * PathState defines them at that s (so a car that tracks it IS the Auto car, and the latch has nothing to jump).
 * `recordedLine`: an open polyline (x, y, speed every RECORDED_DS m of travel) for the ghost runs (11-04).
 * Pure, allocation-free per call; det kernels only.
 */
import type { PathState } from '../../contracts/sim';
import type { BuiltTrack } from '../../contracts/track';
import type { Frenet, GroundWorld } from '../../contracts/world';
import { datan2, dwrapPi } from '../math/det';
import type { SpeedProfile } from '../path/speed-profile';

export interface RefPoint {
  s: number;
  x: number;
  y: number;
  heading: number;
  curvature: number;
  speed: number;
  accel: number;
}

export interface ReferenceLine {
  readonly length: number;
  readonly closed: boolean;
  /** Nearest line point: s along the line, l = offset from THIS line (+ left), the line's heading and curvature. */
  project(x: number, y: number, hint: number, out: Frenet): Frenet;
  at(s: number, out: RefPoint): RefPoint;
}

/** Sample spacing of a recorded line, m of travel. */
export const RECORDED_DS = 0.5;

export const createRefPoint = (): RefPoint => ({ s: 0, x: 0, y: 0, heading: 0, curvature: 0, speed: 0, accel: 0 });

export function loopLine(track: BuiltTrack, profile: SpeedProfile, world: GroundWorld): ReferenceLine {
  const path: PathState = { lapTime: 0, s: 0, l: 0, v: 0, ax: 0, ay: 0, curvature: 0, heading: 0, x: 0, y: 0, z: 0, bank: 0, grade: 0, sectionIndex: 0 };
  const fr: Frenet = { s: 0, l: 0, heading: 0, curvature: 0, converged: true };
  // the profile state at the s of the last call (project and at share it)
  const last = new Float64Array(1).fill(NaN);
  const stateAtS = (s: number): PathState => {
    if (s !== last[0]) {
      profile.stateAt(profile.timeAtS(s), path);
      last[0] = s;
    }
    return path;
  };
  return {
    length: track.length,
    closed: true,
    project(x, y, hint, out) {
      world.project(x, y, hint, fr);
      const p = stateAtS(fr.s);
      // Offset from the driving line along the centreline normal (the profile's small-offset line, §7.2.1).
      out.s = fr.s;
      out.l = fr.l - p.l;
      out.heading = p.heading;
      out.curvature = p.curvature;
      out.converged = fr.converged;
      return out;
    },
    at(s, out) {
      const p = stateAtS(s);
      out.s = p.s;
      out.x = p.x;
      out.y = p.y;
      out.heading = p.heading;
      out.curvature = p.curvature;
      out.speed = p.v;
      out.accel = p.ax;
      return out;
    },
  };
}

/** Open line through recorded (x, y, speed) triples spaced RECORDED_DS apart (>= 2 samples). */
export function recordedLine(samples: Float64Array): ReferenceLine {
  const n = Math.floor(samples.length / 3);
  if (n < 2) throw new Error('recordedLine: needs at least two samples');
  const length = (n - 1) * RECORDED_DS;
  // per-sample heading (central differences; one-sided at the ends), curvature from the heading change, speed, accel
  const heading = new Float64Array(n);
  const curvature = new Float64Array(n);
  const accel = new Float64Array(n);
  const X = (i: number) => samples[3 * i]!;
  const Y = (i: number) => samples[3 * i + 1]!;
  const V = (i: number) => samples[3 * i + 2]!;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    heading[i] = datan2(Y(b) - Y(a), X(b) - X(a));
  }
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    curvature[i] = dwrapPi(heading[b]! - heading[a]!) / ((b - a) * RECORDED_DS);
    accel[i] = (V(i) * (V(b) - V(a))) / ((b - a) * RECORDED_DS);
  }
  const WINDOW = 80; // segments searched around a finite hint (+-40 m)
  const lerpAt = (arr: Float64Array, i: number, f: number) => arr[i]! + (arr[Math.min(n - 1, i + 1)]! - arr[i]!) * f;
  return {
    length,
    closed: false,
    project(x, y, hint, out) {
      let lo = 0;
      let hi = n - 2;
      if (hint === hint) {
        const k = Math.round(hint / RECORDED_DS);
        lo = Math.max(0, k - WINDOW);
        hi = Math.min(n - 2, k + WINDOW);
      }
      let best = Infinity;
      let bi = 0;
      let bf = 0;
      for (let i = lo; i <= hi; i++) {
        const dx = X(i + 1) - X(i);
        const dy = Y(i + 1) - Y(i);
        const d2 = dx * dx + dy * dy;
        let f = d2 > 0 ? ((x - X(i)) * dx + (y - Y(i)) * dy) / d2 : 0;
        f = f < 0 ? 0 : f > 1 ? 1 : f;
        const ex = x - X(i) - f * dx;
        const ey = y - Y(i) - f * dy;
        const e2 = ex * ex + ey * ey;
        if (e2 < best) {
          best = e2;
          bi = i;
          bf = f;
        }
      }
      const h = heading[bi]! + dwrapPi(heading[bi + 1]! - heading[bi]!) * bf;
      out.s = (bi + bf) * RECORDED_DS;
      // signed distance to the segment, + left of the travel direction
      const dx = X(bi + 1) - X(bi);
      const dy = Y(bi + 1) - Y(bi);
      const cross = dx * (y - Y(bi)) - dy * (x - X(bi));
      out.l = (cross >= 0 ? 1 : -1) * Math.sqrt(best);
      out.heading = h;
      out.curvature = lerpAt(curvature, bi, bf);
      out.converged = true;
      return out;
    },
    at(sIn, out) {
      const s = sIn < 0 ? 0 : sIn > length ? length : sIn;
      const xi = s / RECORDED_DS;
      const i = Math.min(n - 2, Math.floor(xi));
      const f = xi - i;
      out.s = s;
      out.x = X(i) + (X(i + 1) - X(i)) * f;
      out.y = Y(i) + (Y(i + 1) - Y(i)) * f;
      out.heading = heading[i]! + dwrapPi(heading[i + 1]! - heading[i]!) * f;
      out.curvature = lerpAt(curvature, i, f);
      out.speed = V(i) + (V(i + 1) - V(i)) * f;
      out.accel = lerpAt(accel, i, f);
      return out;
    },
  };
}
