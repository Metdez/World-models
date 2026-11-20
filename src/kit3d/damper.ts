/**
 * Telescoping damper (research 22 B5): a body of fixed length hangs from the lower mount, a chrome rod of fixed
 * length hangs from the upper mount; the visible rod grows and shrinks as the mounts move. Mount eyes, a jounce
 * bumper on the rod and the body's end cap are separate meshes placed along the same axis. No allocation in
 * `update`.
 */
import { Group, Mesh, Vector3, type BufferGeometry, type Material } from 'three';
import { placeAlong, updateTube } from './tube';

export interface DamperDims {
  /** Body length measured from the lower mount toward the upper mount, m. */
  readonly bodyLength: number;
  /** Body extension below the lower mount (strut clamp), m (0 for an eye mount). */
  readonly bodyBelow: number;
  readonly bodyRadius: number;
  /** Rod length measured from the upper mount toward the lower mount, m. */
  readonly rodLength: number;
  readonly rodRadius: number;
  /** End-fitting radius at both mounts (0 = none, e.g. a strut clamp and a top-mount bearing). */
  readonly eyeRadius: number;
}

export interface DamperMaterials {
  readonly body: Material;
  readonly rod: Material;
  readonly rubber: Material;
}

export interface Damper {
  readonly group: Group;
  /** Mount points in the group's parent space. Returns the mount-to-mount length. */
  update(lower: Vector3, upper: Vector3): number;
}

const _dir = new Vector3();
const _a = new Vector3();
const _b = new Vector3();

/** `cylinder` is a shared unit cylinder (radius 1, height 1 along +Y). */
export function createDamper(cylinder: BufferGeometry, mats: DamperMaterials, dims: DamperDims): Damper {
  const group = new Group();
  const body = new Mesh(cylinder, mats.body);
  const cap = new Mesh(cylinder, mats.rod);
  const rod = new Mesh(cylinder, mats.rod);
  const bumper = new Mesh(cylinder, mats.rubber);
  const eyes = dims.eyeRadius > 0 ? [new Mesh(cylinder, mats.body), new Mesh(cylinder, mats.body)] : [];
  for (const e of eyes) e.scale.set(dims.eyeRadius, dims.eyeRadius * 2.2, dims.eyeRadius);
  group.add(body, cap, rod, bumper, ...eyes);
  for (const m of group.children) m.castShadow = true;
  const bumperLen = Math.min(0.045, dims.rodLength * 0.2);
  return {
    group,
    update(lower, upper) {
      _dir.subVectors(upper, lower);
      const len = _dir.length();
      if (len < 1e-7) return 0;
      _dir.multiplyScalar(1 / len);
      _a.copy(lower).addScaledVector(_dir, -dims.bodyBelow);
      _b.copy(lower).addScaledVector(_dir, dims.bodyLength);
      updateTube(body, _a, _b, dims.bodyRadius);
      // Seal cap on top of the body.
      _a.copy(_b).addScaledVector(_dir, -0.004);
      _b.addScaledVector(_dir, 0.008);
      updateTube(cap, _a, _b, dims.bodyRadius * 0.62);
      _a.copy(upper).addScaledVector(_dir, -dims.rodLength);
      updateTube(rod, _a, upper, dims.rodRadius);
      // Jounce bumper just under the upper mount.
      _a.copy(upper).addScaledVector(_dir, -dims.eyeRadius - 0.012);
      _b.copy(_a).addScaledVector(_dir, -bumperLen);
      updateTube(bumper, _b, _a, dims.rodRadius * 1.9);
      if (eyes.length === 2) {
        placeAlong(eyes[0]!, _a.copy(lower).addScaledVector(_dir, dims.eyeRadius * 0.6), _dir);
        placeAlong(eyes[1]!, _b.copy(upper).addScaledVector(_dir, -dims.eyeRadius * 0.6), _dir);
      }
      return len;
    },
  } satisfies Damper;
}
