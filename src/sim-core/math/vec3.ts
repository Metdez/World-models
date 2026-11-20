/**
 * 3-vectors as mutable tuples (gl-matrix style: `out` first, returns `out`, aliasing-safe).
 * Inputs accept the contract's readonly `Vec3`. Import as a namespace: `import * as v3 from './math/vec3'`.
 */
import type { Vec3, XYZ } from '../../contracts/units';

export type V3 = [x: number, y: number, z: number];

export const create = (x = 0, y = 0, z = 0): V3 => [x, y, z];

export function set(out: V3, x: number, y: number, z: number): V3 {
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

export const copy = (out: V3, a: Vec3): V3 => set(out, a[0], a[1], a[2]);
export const add = (out: V3, a: Vec3, b: Vec3): V3 => set(out, a[0] + b[0], a[1] + b[1], a[2] + b[2]);
export const sub = (out: V3, a: Vec3, b: Vec3): V3 => set(out, a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const scale = (out: V3, a: Vec3, s: number): V3 => set(out, a[0] * s, a[1] * s, a[2] * s);
/** out = a + b * s */
export const scaleAndAdd = (out: V3, a: Vec3, b: Vec3, s: number): V3 => set(out, a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s);
export const negate = (out: V3, a: Vec3): V3 => set(out, -a[0], -a[1], -a[2]);
export const lerp = (out: V3, a: Vec3, b: Vec3, t: number): V3 =>
  set(out, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);

export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (out: V3, a: Vec3, b: Vec3): V3 =>
  set(out, a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]);

export const lengthSq = (a: Vec3): number => a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
export const length = (a: Vec3): number => Math.sqrt(lengthSq(a));
export function distanceSq(a: Vec3, b: Vec3): number {
  const x = a[0] - b[0];
  const y = a[1] - b[1];
  const z = a[2] - b[2];
  return x * x + y * y + z * z;
}
export const distance = (a: Vec3, b: Vec3): number => Math.sqrt(distanceSq(a, b));

/** Unit vector; a zero vector stays zero. */
export function normalize(out: V3, a: Vec3): V3 {
  const len = length(a);
  return len > 0 ? scale(out, a, 1 / len) : set(out, 0, 0, 0);
}

export const equals = (a: Vec3, b: Vec3, eps = 1e-12): boolean =>
  Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps && Math.abs(a[2] - b[2]) <= eps;

/** Reads xyz from a flat array (e.g. CornerFrame.points) at element offset `i`. */
export const read = (out: V3, arr: Float64Array, i: number): V3 => set(out, arr[i]!, arr[i + 1]!, arr[i + 2]!);
export function write(a: Vec3, arr: Float64Array, i: number): Float64Array {
  arr[i] = a[0];
  arr[i + 1] = a[1];
  arr[i + 2] = a[2];
  return arr;
}

export const fromXYZ = (out: V3, p: Readonly<XYZ>): V3 => set(out, p.x, p.y, p.z);
export function toXYZ(a: Vec3, out: XYZ): XYZ {
  out.x = a[0];
  out.y = a[1];
  out.z = a[2];
  return out;
}
