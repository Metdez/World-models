/**
 * 3x3 matrices, ROW-major 9-tuples: m[3*row + col]. `out` first, aliasing-safe.
 * Rotation matrices map body -> world: p_world = R * p_body.
 */
import type { Vec3 } from '../../contracts/units';
import type { V3 } from './vec3';
import type { Quat, QuatLike } from './quat';

export type Mat3 = [number, number, number, number, number, number, number, number, number];
export type Mat3Like = Readonly<Mat3>;

export const create = (): Mat3 => [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function set(out: Mat3, a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number): Mat3 {
  out[0] = a;
  out[1] = b;
  out[2] = c;
  out[3] = d;
  out[4] = e;
  out[5] = f;
  out[6] = g;
  out[7] = h;
  out[8] = i;
  return out;
}

export const identity = (out: Mat3): Mat3 => set(out, 1, 0, 0, 0, 1, 0, 0, 0, 1);
export const copy = (out: Mat3, m: Mat3Like): Mat3 => set(out, m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]);
export const transpose = (out: Mat3, m: Mat3Like): Mat3 => set(out, m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]);

/** out = a * b */
export function multiply(out: Mat3, a: Mat3Like, b: Mat3Like): Mat3 {
  const [a0, a1, a2, a3, a4, a5, a6, a7, a8] = a;
  const [b0, b1, b2, b3, b4, b5, b6, b7, b8] = b;
  return set(
    out,
    a0 * b0 + a1 * b3 + a2 * b6,
    a0 * b1 + a1 * b4 + a2 * b7,
    a0 * b2 + a1 * b5 + a2 * b8,
    a3 * b0 + a4 * b3 + a5 * b6,
    a3 * b1 + a4 * b4 + a5 * b7,
    a3 * b2 + a4 * b5 + a5 * b8,
    a6 * b0 + a7 * b3 + a8 * b6,
    a6 * b1 + a7 * b4 + a8 * b7,
    a6 * b2 + a7 * b5 + a8 * b8,
  );
}

/** out = m * v */
export function transformVec3(out: V3, m: Mat3Like, v: Vec3): V3 {
  const [x, y, z] = v;
  out[0] = m[0] * x + m[1] * y + m[2] * z;
  out[1] = m[3] * x + m[4] * y + m[5] * z;
  out[2] = m[6] * x + m[7] * y + m[8] * z;
  return out;
}

/** out = m^T * v (inverse rotation for orthonormal m). */
export function transformTransposeVec3(out: V3, m: Mat3Like, v: Vec3): V3 {
  const [x, y, z] = v;
  out[0] = m[0] * x + m[3] * y + m[6] * z;
  out[1] = m[1] * x + m[4] * y + m[7] * z;
  out[2] = m[2] * x + m[5] * y + m[8] * z;
  return out;
}

/** Cross-product matrix: skew(v) * u = v x u. */
export const skew = (out: Mat3, v: Vec3): Mat3 => set(out, 0, -v[2], v[1], v[2], 0, -v[0], -v[1], v[0], 0);

/**
 * Rodrigues: rotation by |w| about w/|w|. R = I + A*K + B*K^2 with K = skew(w), A = sin(t)/t, B = (1-cos t)/t^2.
 * Series below 1e-4 rad keeps it exact to double precision near zero (the solver differentiates through it).
 */
export function fromRotationVector(out: Mat3, w: Vec3): Mat3 {
  const [x, y, z] = w;
  const t2 = x * x + y * y + z * z;
  let a: number;
  let b: number;
  if (t2 < 1e-8) {
    a = 1 - t2 / 6 + (t2 * t2) / 120;
    b = 0.5 - t2 / 24 + (t2 * t2) / 720;
  } else {
    const t = Math.sqrt(t2);
    a = Math.sin(t) / t;
    b = (1 - Math.cos(t)) / t2;
  }
  return set(
    out,
    1 - b * (y * y + z * z),
    -a * z + b * x * y,
    a * y + b * x * z,
    a * z + b * x * y,
    1 - b * (x * x + z * z),
    -a * x + b * y * z,
    -a * y + b * x * z,
    a * x + b * y * z,
    1 - b * (x * x + y * y),
  );
}

/** Rotation matrix of a unit quaternion (x, y, z, w). */
export function fromQuat(out: Mat3, q: QuatLike): Mat3 {
  const [x, y, z, w] = q;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  return set(out, 1 - yy - zz, xy - wz, xz + wy, xy + wz, 1 - xx - zz, yz - wx, xz - wy, yz + wx, 1 - xx - yy);
}

export function determinant(m: Mat3Like): number {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

/** Inverse by adjugate. Returns false (out untouched) when |det| < 1e-300. */
export function invert(out: Mat3, m: Mat3Like): boolean {
  const det = determinant(m);
  if (!(Math.abs(det) >= 1e-300)) return false;
  const d = 1 / det;
  const [a, b, c, e, f, g, h, i, j] = m;
  set(
    out,
    (f * j - g * i) * d,
    (c * i - b * j) * d,
    (b * g - c * f) * d,
    (g * h - e * j) * d,
    (a * j - c * h) * d,
    (c * e - a * g) * d,
    (e * i - f * h) * d,
    (b * h - a * i) * d,
    (a * f - b * e) * d,
  );
  return true;
}

/** Unit quaternion of a rotation matrix (Shepperd's method, robust for all angles). */
export function toQuat(out: Quat, m: Mat3Like): Quat {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    out[0] = (m21 - m12) / s;
    out[1] = (m02 - m20) / s;
    out[2] = (m10 - m01) / s;
    out[3] = 0.25 * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    out[0] = 0.25 * s;
    out[1] = (m01 + m10) / s;
    out[2] = (m02 + m20) / s;
    out[3] = (m21 - m12) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    out[0] = (m01 + m10) / s;
    out[1] = 0.25 * s;
    out[2] = (m12 + m21) / s;
    out[3] = (m02 - m20) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    out[0] = (m02 + m20) / s;
    out[1] = (m12 + m21) / s;
    out[2] = 0.25 * s;
    out[3] = (m10 - m01) / s;
  }
  return out;
}
