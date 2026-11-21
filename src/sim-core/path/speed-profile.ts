/**
 * Quasi-steady-state speed profile for a closed track (ARCHITECTURE §7.2.1, research 05 §5). Own implementation of
 * the published forward/backward idea (OpenLAP/TUMFTM are GPL/LGPL: algorithm only, no code):
 * v_lim from lateral grip on the driving-line curvature, backward (braking) and forward (traction, drag) passes with
 * a friction ellipse, each run twice so the loop wraps; 10 m smoothing; t(s) by trapezoid. Small-offset driving line:
 * kappa = kappa_c + l'', heading = psi_c + atan(l'), path speed = ds/dt along the centreline.
 * PathState x/y/z lie on the SMOOTH road surface at (s, l) (macro elevation + bank); roughness and features are
 * left to the ride model, which samples roadHeight per wheel.
 */
import type { PathState } from '../../contracts/sim';
import type { BuiltTrack, TrackSample } from '../../contracts/track';
import type { DrivingLimits } from '../../contracts/vehicle';
import { findInterval, lerp, lowPassAlpha, wrap } from '../math/interp';
import { datan, dcos, dsin, dtan } from '../math/det';

export interface SpeedProfile {
  readonly lapDuration: number;
  /** Pure: same lapTime -> same state. Allocation-free. */
  stateAt(lapTime: number, out: PathState): PathState;
  timeAtS(s: number): number;
}

const GRID_DS = 0.5;
/** Half-width of the moving-average speed smoothing (10 m span). */
const SMOOTH_HALF = 5;
/** Driving-line derivative step for l' and l'' (central differences), m. */
const LINE_H = 0.25;
/** Cut-off of the first-order low-pass applied to ax/ay (8 Hz equivalent), Hz. */
const ACCEL_FILTER_HZ = 8;
/** Air density for drag, kg/m^3 (ISA sea level). */
const RHO_AIR = 1.225;

export function buildSpeedProfile(track: BuiltTrack, limits: DrivingLimits, dragArea: number, mass: number): SpeedProfile {
  const n = Math.max(8, Math.round(track.length / GRID_DS));
  const ds = track.length / n;
  // Node arrays carry n + 1 entries; entry n repeats entry 0 so interpolation never wraps.
  const kappa = new Float64Array(n + 1);
  const dHeading = new Float64Array(n + 1);
  const vLim = new Float64Array(n);
  const targetSpeed = (s: number): number => track.sections[track.sectionIndexAt(s)]!.def.targetSpeed ?? Infinity;
  const tmp: TrackSample = { s: 0, x: 0, y: 0, z: 0, heading: 0, curvature: 0, bank: 0, grade: 0 };
  for (let i = 0; i < n; i++) {
    const s = i * ds;
    const lm = track.lineOffset(s - LINE_H);
    const l0 = track.lineOffset(s);
    const lp = track.lineOffset(s + LINE_H);
    kappa[i] = track.sample(s, tmp).curvature + (lp - 2 * l0 + lm) / (LINE_H * LINE_H);
    dHeading[i] = datan((lp - lm) / (2 * LINE_H));
    // A node also takes the caps of its neighbours' sections, so no interpolated point near a boundary exceeds them.
    const target = Math.min(targetSpeed(s - ds), targetSpeed(s), targetSpeed(s + ds));
    vLim[i] = Math.min(limits.vMax, target, Math.sqrt(limits.lateral / Math.max(Math.abs(kappa[i]!), 1e-9)));
  }
  kappa[n] = kappa[0]!;
  dHeading[n] = dHeading[0]!;

  const ellipse = (v: number, k: number): number => {
    const r = (v * v * Math.abs(k)) / limits.lateral;
    return r >= 1 ? 0 : Math.sqrt(1 - r * r);
  };
  const dragAccel = (v: number): number => (0.5 * RHO_AIR * dragArea * v * v) / mass;
  /** Lowers v (in place) until every step respects braking and traction limits around the closed loop. */
  const limitPasses = (v: Float64Array): void => {
    for (let lap = 0; lap < 2; lap++)
      for (let i = n - 1; i >= 0; i--) {
        const j = (i + 1) % n;
        const vj = v[j]!;
        // Braking: total deceleration (tyres + drag) capped at the brake limit, shared with lateral via the ellipse.
        v[i] = Math.min(v[i]!, Math.sqrt(vj * vj + 2 * limits.brake * ellipse(vj, kappa[j]!) * ds));
      }
    for (let lap = 0; lap < 2; lap++)
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const vi = v[i]!;
        const a = limits.accel * ellipse(vi, kappa[i]!) - dragAccel(vi);
        v[j] = Math.min(v[j]!, Math.sqrt(Math.max(0, vi * vi + 2 * a * ds)));
      }
  };

  const raw = Float64Array.from(vLim);
  limitPasses(raw);
  // 10 m moving average, never above the raw profile (keeps apex speeds at the grip limit), then re-limit.
  const w = Math.round(SMOOTH_HALF / ds);
  const v = new Float64Array(n + 1);
  let acc = 0;
  for (let k = -w; k <= w; k++) acc += raw[(k + n) % n]!;
  for (let i = 0; i < n; i++) {
    v[i] = Math.min(raw[i]!, acc / (2 * w + 1));
    acc += raw[(i + w + 1) % n]! - raw[(i - w + n) % n]!;
  }
  limitPasses(v);
  v[n] = v[0]!;

  // Time along the grid, then ax / ay with an 8 Hz first-order low-pass in time (two laps: periodic steady state).
  const time = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) time[i + 1] = time[i]! + (2 * ds) / (v[i]! + v[i + 1]!);
  const lapDuration = time[n]!;
  const ax = new Float64Array(n + 1);
  const ay = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const vp = v[i + 1]!;
    const vm = v[(i + n - 1) % n]!;
    ax[i] = (vp * vp - vm * vm) / (4 * ds);
    ay[i] = v[i]! * v[i]! * kappa[i]!;
  }
  for (const a of [ax, ay]) {
    const x = Float64Array.from(a);
    let y = x[0]!;
    for (let lap = 0; lap < 2; lap++)
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        y += lowPassAlpha(time[i + 1]! - time[i]!, ACCEL_FILTER_HZ) * (x[j]! - y);
        if (lap === 1) a[j] = y;
      }
    a[n] = a[0]!;
  }

  const sample: TrackSample = { s: 0, x: 0, y: 0, z: 0, heading: 0, curvature: 0, bank: 0, grade: 0 };
  return {
    lapDuration,
    stateAt(lapTime, out) {
      const t = wrap(lapTime, lapDuration);
      const i = findInterval(time, t);
      const f = (t - time[i]!) / (time[i + 1]! - time[i]!);
      const s = (i + f) * ds;
      const l = track.lineOffset(s);
      track.sample(s, sample);
      const c = dcos(sample.heading);
      const sn = dsin(sample.heading);
      out.lapTime = t;
      out.s = s;
      out.l = l;
      out.v = lerp(v[i]!, v[i + 1]!, f);
      out.ax = lerp(ax[i]!, ax[i + 1]!, f);
      out.ay = lerp(ay[i]!, ay[i + 1]!, f);
      out.curvature = lerp(kappa[i]!, kappa[i + 1]!, f);
      out.heading = sample.heading + lerp(dHeading[i]!, dHeading[i + 1]!, f);
      out.x = sample.x - sn * l;
      out.y = sample.y + c * l;
      out.z = sample.z + l * dtan(sample.bank);
      out.bank = sample.bank;
      out.grade = sample.grade;
      out.sectionIndex = track.sectionIndexAt(s);
      return out;
    },
    timeAtS(sIn) {
      const x = wrap(sIn, track.length) / ds;
      const i = Math.min(Math.floor(x), n - 1);
      return lerp(time[i]!, time[i + 1]!, x - i);
    },
  };
}
