/**
 * Units, frames and sign conventions. BINDING for every module (see ARCHITECTURE.md §4).
 *
 * - SI everywhere in sim-core and TelemetryFrame: m, s, kg, N, rad, m/s, m/s^2, N/m, N*s/m.
 * - Display units (deg, mm, km/h, kN, g) exist only in UI code and in wire formats whose field
 *   names carry an explicit suffix (e.g. `camber_deg`).
 *
 * SIM WORLD frame: right-handed, X east, Y north, Z up. The track lies (mostly) in the XY plane.
 *   Heading psi is measured from +X, counter-clockwise positive (seen from above).
 * VEHICLE frame (ISO 8855 style): right-handed, X forward, Y left, Z up. Origin on the ground plane
 *   directly below the static sprung centre of gravity. Front axle at x = +cgToFront,
 *   rear axle at x = -(wheelbase - cgToFront).
 * AXLE frame (car suspension hardpoints): vehicle axes, origin on the centreline at ground level
 *   directly below that axle's wheel centres at static design ride height. LEFT side only;
 *   the right side is the mirror y -> -y. (Same convention as Project Chrono data.)
 *
 * Angles (all right-hand rule about the named axis):
 *   roll  = rotation about +X (forward): positive lifts the LEFT side.
 *   pitch = rotation about +Y (left):    positive is NOSE DOWN.
 *   yaw   = rotation about +Z (up):      positive turns LEFT.
 *   curvature kappa > 0 for a LEFT turn; lateral acceleration ay > 0 toward the LEFT.
 *   camber: negative = top of the wheel leans INBOARD (toward the car centreline), on both sides.
 *   toe:    positive = TOE-IN (front of the wheel points toward the centreline), on both sides.
 *   steer:  road-wheel angle about vehicle +Z, positive = steering LEFT.
 *   wheel travel: positive = BUMP (wheel moves up relative to the body, spring compresses).
 *   lateral road offset l: positive = LEFT of the centreline.
 *   bank: right-hand roll of the road cross-section about the forward tangent:
 *         positive = LEFT edge higher.
 *
 * THREE.JS render frame is Y-up and right-handed. The ONLY mapping is:
 *   three.x = sim.x,  three.y = sim.z,  three.z = -sim.y
 *   quaternion: three(x, y, z, w) = sim(qx, qz, -qy, qw)
 */

export type Vec3 = readonly [x: number, y: number, z: number];

/** Mutable output vector; structurally compatible with THREE.Vector3 fields (but frames differ!). */
export interface XYZ {
  x: number;
  y: number;
  z: number;
}

/** Mutable output quaternion (x, y, z, w). */
export interface XYZW {
  x: number;
  y: number;
  z: number;
  w: number;
}

export type AxleId = 'front' | 'rear';
/** Car corners: fl, fr, rl, rr (this order). Motorcycle: f, r (this order). */
export type CornerId = 'fl' | 'fr' | 'rl' | 'rr' | 'f' | 'r';
export const CAR_CORNERS = ['fl', 'fr', 'rl', 'rr'] as const satisfies readonly CornerId[];
export const MOTO_CORNERS = ['f', 'r'] as const satisfies readonly CornerId[];

/** Standard gravity, m/s^2. */
export const G = 9.80665;
/** Fixed simulation rate. */
export const SIM_HZ = 240;
export const SIM_DT = 1 / SIM_HZ;
/** Render frame dt is clamped to this before feeding the accumulator (s). */
export const MAX_FRAME_DT = 0.1;
/** Shared lap clock epoch: 2026-01-01T00:00:00Z. lapTime = ((serverNow - EPOCH_MS) / 1000) mod lapDuration. */
export const EPOCH_MS = 1767225600000;

/** Writes sim-frame (x, y, z) into a three.js-frame vector (e.g. a THREE.Vector3). */
export function simToThree(x: number, y: number, z: number, out: XYZ): XYZ {
  out.x = x;
  out.y = z;
  out.z = -y;
  return out;
}

/** Writes a sim-frame quaternion into a three.js-frame quaternion (e.g. a THREE.Quaternion). */
export function simQuatToThree(q: XYZW, out: XYZW): XYZW {
  const { x, y, z, w } = q;
  out.x = x;
  out.y = z;
  out.z = -y;
  out.w = w;
  return out;
}

export const RAD_TO_DEG = 180 / Math.PI;
export const DEG_TO_RAD = Math.PI / 180;
