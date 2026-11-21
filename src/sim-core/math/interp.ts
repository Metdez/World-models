/** Scalar helpers, angle wrapping, lookup tables and filters. Pure, allocation-free. */
import { dcos, dexp } from './det';

const TAU = 2 * Math.PI;

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** t such that lerp(a, b, t) = x (0 when a === b). */
export const invLerp = (a: number, b: number, x: number): number => (a === b ? 0 : (x - a) / (b - a));
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp(invLerp(e0, e1, x), 0, 1);
  return t * t * (3 - 2 * t);
}
/** Raised-cosine blend from a (t = 0) to b (t = 1), zero slope at both ends. */
export const cosineBlend = (a: number, b: number, t: number): number => a + ((b - a) * (1 - dcos(Math.PI * clamp(t, 0, 1)))) / 2;

/** x modulo period into [0, period) (also for negative x). */
export function wrap(x: number, period: number): number {
  const r = x % period;
  return r < 0 ? (r + period < period ? r + period : 0) : r + 0; // + 0 turns -0 into 0
}
/** x modulo period into [-period/2, period/2) (shortest signed difference on a loop). */
export const wrapHalf = (x: number, period: number): number => wrap(x + period / 2, period) - period / 2;
/** Angle into [-pi, pi). */
export const wrapAngle = (a: number): number => wrapHalf(a, TAU);
/** Interpolates angles along the shortest arc. */
export const lerpAngle = (a: number, b: number, t: number): number => a + wrapAngle(b - a) * t;

/**
 * Index i with xs[i] <= x < xs[i+1] for ascending xs (binary search), clamped to [0, n-2].
 * Requires xs.length >= 2.
 */
export function findInterval(xs: Float64Array, x: number): number {
  let lo = 0;
  let hi = xs.length - 1;
  if (x <= xs[0]!) return 0;
  if (x >= xs[hi]!) return hi - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! <= x) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Piecewise-linear lookup y(x) for ascending xs; clamped (held) outside [xs[0], xs[n-1]]. */
export function interp1(xs: Float64Array, ys: Float64Array, x: number): number {
  const i = findInterval(xs, x);
  const x0 = xs[i]!;
  const x1 = xs[i + 1]!;
  const t = clamp((x - x0) / (x1 - x0), 0, 1);
  return ys[i]! + (ys[i + 1]! - ys[i]!) * t;
}

/**
 * Bilinear lookup on a rectilinear grid, clamped at the edges. `values[i * ys.length + j]` is the value at
 * (xs[i], ys[j]); both axes ascending with >= 2 nodes.
 */
export function bilinear(xs: Float64Array, ys: Float64Array, values: Float64Array, x: number, y: number): number {
  const ny = ys.length;
  const i = findInterval(xs, x);
  const j = findInterval(ys, y);
  const tx = clamp((x - xs[i]!) / (xs[i + 1]! - xs[i]!), 0, 1);
  const ty = clamp((y - ys[j]!) / (ys[j + 1]! - ys[j]!), 0, 1);
  const v00 = values[i * ny + j]!;
  const v01 = values[i * ny + j + 1]!;
  const v10 = values[(i + 1) * ny + j]!;
  const v11 = values[(i + 1) * ny + j + 1]!;
  return (v00 * (1 - ty) + v01 * ty) * (1 - tx) + (v10 * (1 - ty) + v11 * ty) * tx;
}

/** out[k] = integral of y dx from xs[0] to xs[k] (trapezoid rule). out may alias neither xs nor ys. */
export function cumulativeTrapezoid(xs: Float64Array, ys: Float64Array, out: Float64Array): Float64Array {
  out[0] = 0;
  for (let k = 1; k < xs.length; k++) out[k] = out[k - 1]! + 0.5 * (ys[k]! + ys[k - 1]!) * (xs[k]! - xs[k - 1]!);
  return out;
}

/**
 * Gain of a first-order low-pass sampled every dt: y += alpha * (x - y). Exact discretisation of
 * 1 / (1 + s / (2 pi f)), so the result does not depend on the step size beyond sampling.
 */
export const lowPassAlpha = (dt: number, cutoffHz: number): number => 1 - dexp(-TAU * cutoffHz * dt);
