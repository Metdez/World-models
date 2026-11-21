/**
 * Unit quaternions (x, y, z, w) as mutable tuples; `out` first, aliasing-safe. Hamilton product:
 * multiply(out, a, b) = a*b rotates by b first, then a (same as rotation-matrix order).
 */
import type { Vec3, XYZW } from '../../contracts/units';
import type { V3 } from './vec3';
import { dacos, dasin, datan2, dcos, dsin } from './det';

export type Quat = [x: number, y: number, z: number, w: number];
export type QuatLike = readonly [x: number, y: number, z: number, w: number];

export const create = (): Quat => [0, 0, 0, 1];

export function set(out: Quat, x: number, y: number, z: number, w: number): Quat {
  out[0] = x;
  out[1] = y;
  out[2] = z;
  out[3] = w;
  return out;
}

export const identity = (out: Quat): Quat => set(out, 0, 0, 0, 1);
export const copy = (out: Quat, q: QuatLike): Quat => set(out, q[0], q[1], q[2], q[3]);
export const conjugate = (out: Quat, q: QuatLike): Quat => set(out, -q[0], -q[1], -q[2], q[3]);
export const dot = (a: QuatLike, b: QuatLike): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];

export function normalize(out: Quat, q: QuatLike): Quat {
  const len = Math.sqrt(dot(q, q));
  return len > 0 ? set(out, q[0] / len, q[1] / len, q[2] / len, q[3] / len) : identity(out);
}

/** out = a * b */
export function multiply(out: Quat, a: QuatLike, b: QuatLike): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return set(
    out,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  );
}

/** `axis` must be unit length. */
export function fromAxisAngle(out: Quat, axis: Vec3, angle: number): Quat {
  const s = dsin(angle / 2);
  return set(out, axis[0] * s, axis[1] * s, axis[2] * s, dcos(angle / 2));
}

/** Exponential map: rotation by |w| about w/|w| (series near zero). */
export function fromRotationVector(out: Quat, w: Vec3): Quat {
  const t2 = w[0] * w[0] + w[1] * w[1] + w[2] * w[2];
  let k: number; // sin(t/2)/t
  let c: number;
  if (t2 < 1e-8) {
    k = 0.5 - t2 / 48;
    c = 1 - t2 / 8;
  } else {
    const t = Math.sqrt(t2);
    k = dsin(t / 2) / t;
    c = dcos(t / 2);
  }
  return set(out, w[0] * k, w[1] * k, w[2] * k, c);
}

/** Logarithmic map (inverse of fromRotationVector): angle in [0, pi]. `q` must be unit length. */
export function toRotationVector(out: V3, q: QuatLike): V3 {
  const sign = q[3] < 0 ? -1 : 1; // q and -q are the same rotation; take the short way
  const x = q[0] * sign;
  const y = q[1] * sign;
  const z = q[2] * sign;
  const s = Math.sqrt(x * x + y * y + z * z);
  const k = s < 1e-8 ? 2 : (2 * datan2(s, q[3] * sign)) / s;
  out[0] = x * k;
  out[1] = y * k;
  out[2] = z * k;
  return out;
}

/** out = q * v * q^-1 */
export const rotate = (out: V3, q: QuatLike, v: Vec3): V3 => rotateRaw(out, q[0], q[1], q[2], q[3], v);

/** out = q^-1 * v * q (world -> body for a body -> world rotation). */
export const rotateInverse = (out: V3, q: QuatLike, v: Vec3): V3 => rotateRaw(out, -q[0], -q[1], -q[2], q[3], v);

function rotateRaw(out: V3, qx: number, qy: number, qz: number, qw: number, v: Vec3): V3 {
  const [vx, vy, vz] = v;
  // t = 2 * (q.xyz x v); v' = v + w*t + q.xyz x t
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  out[0] = vx + qw * tx + qy * tz - qz * ty;
  out[1] = vy + qw * ty + qz * tx - qx * tz;
  out[2] = vz + qw * tz + qx * ty - qy * tx;
  return out;
}

/**
 * Body attitude from roll (about +X), pitch (about +Y), yaw (about +Z), all right-hand rule (units.ts):
 * q = Rz(yaw) * Ry(pitch) * Rx(roll), i.e. intrinsic yaw -> pitch -> roll (ISO 8855 / Tait-Bryan z-y'-x'').
 */
export function fromRollPitchYaw(out: Quat, roll: number, pitch: number, yaw: number): Quat {
  const cr = dcos(roll / 2);
  const sr = dsin(roll / 2);
  const cp = dcos(pitch / 2);
  const sp = dsin(pitch / 2);
  const cy = dcos(yaw / 2);
  const sy = dsin(yaw / 2);
  return set(out, sr * cp * cy - cr * sp * sy, cr * sp * cy + sr * cp * sy, cr * cp * sy - sr * sp * cy, cr * cp * cy + sr * sp * sy);
}

/** Inverse of fromRollPitchYaw: out = [roll, pitch, yaw] (pitch in [-pi/2, pi/2]). */
export function toRollPitchYaw(out: V3, q: QuatLike): V3 {
  const [x, y, z, w] = q;
  out[0] = datan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  out[1] = dasin(Math.max(-1, Math.min(1, 2 * (w * y - z * x))));
  out[2] = datan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  return out;
}

/** Shortest-path spherical interpolation (falls back to normalised lerp when nearly parallel). */
export function slerp(out: Quat, a: QuatLike, b: QuatLike, t: number): Quat {
  let cos = dot(a, b);
  const sign = cos < 0 ? -1 : 1;
  cos *= sign;
  let ka: number;
  let kb: number;
  if (cos > 0.9995) {
    ka = 1 - t;
    kb = t * sign;
  } else {
    const theta = dacos(cos);
    const sin = dsin(theta);
    ka = dsin((1 - t) * theta) / sin;
    kb = (dsin(t * theta) / sin) * sign;
  }
  set(out, ka * a[0] + kb * b[0], ka * a[1] + kb * b[1], ka * a[2] + kb * b[2], ka * a[3] + kb * b[3]);
  return normalize(out, out);
}

/** Angle of the rotation taking a to b, rad in [0, pi]. */
export const angleBetween = (a: QuatLike, b: QuatLike): number => 2 * dacos(Math.min(1, Math.abs(dot(a, b))));

export const fromXYZW = (out: Quat, q: Readonly<XYZW>): Quat => set(out, q.x, q.y, q.z, q.w);
export function toXYZW(q: QuatLike, out: XYZW): XYZW {
  out.x = q[0];
  out.y = q[1];
  out.z = q[2];
  out.w = q[3];
  return out;
}
