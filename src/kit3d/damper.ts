/**
 * Telescoping damper / coil-over (research 22 B5) as TWO rigid halves on one axis: the body half (body, seal cap,
 * lower end fitting, lower spring seat) rides on the lower mount, the rod half (chrome rod, jounce bumper, upper
 * end fitting, upper spring seat) on the upper mount. Lengths are fixed, so the visible rod grows and shrinks as
 * the mounts move. Each half is one painted mesh (one draw call). No allocation in `update`.
 */
import { Group, Mesh, Vector3, type BufferGeometry, type Material } from 'three';
import { paint, type Finish } from './materials';
import { bakedTube, mergeParts, placeAlong } from './tube';

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
  /** Spring seats: distance from the lower mount (on the body) and from the upper mount (on the rod), and radius. */
  readonly seats?: { readonly low: number; readonly high: number; readonly radius: number };
}

export interface Damper {
  readonly group: Group;
  /** Mount points in the group's parent space. Returns the mount-to-mount length. */
  update(lower: Vector3, upper: Vector3): number;
}

const _dir = new Vector3();
const Y = (y: number) => new Vector3(0, y, 0);

function disc(y: number, r: number, h: number, finish: Finish): BufferGeometry {
  return paint(bakedTube(Y(y - h / 2), Y(y + h / 2), r, r, 28), finish);
}

/** `finish` colours the body (damper or strut role); `material` is that role's palette material. */
export function createDamper(material: Material, finish: Finish, dims: DamperDims): Damper {
  const { bodyLength: Lb, bodyBelow, bodyRadius: rb, rodLength: Lr, rodRadius: rr, eyeRadius: re } = dims;
  const lowerParts = [paint(bakedTube(Y(-bodyBelow), Y(Lb), rb, rb, 24), finish), disc(Lb + 0.002, rb * 0.62, 0.012, 'chrome')];
  const bumperTop = -re - 0.012;
  const bumperLen = Math.min(0.045, Lr * 0.2);
  const upperParts = [paint(bakedTube(Y(-Lr), Y(0), rr, rr, 16), 'chrome'), paint(bakedTube(Y(bumperTop - bumperLen), Y(bumperTop), rr * 1.9, rr * 1.6, 16), 'rubber')];
  if (re > 0) {
    lowerParts.push(paint(bakedTube(Y(0), Y(re * 2.2), re, re * 0.9, 20), finish));
    upperParts.push(paint(bakedTube(Y(-re * 2.2), Y(0), re * 0.9, re, 20), finish));
  }
  if (dims.seats) {
    const { low, high, radius } = dims.seats;
    lowerParts.push(disc(low - 0.0035, radius, 0.007, 'steel'), paint(bakedTube(Y(low - 0.03), Y(low - 0.007), rb * 1.12, rb * 1.12, 24), 'steel'));
    upperParts.push(disc(-high + 0.0035, radius, 0.007, 'steel'));
  }
  const group = new Group();
  const lowerHalf = new Mesh(mergeParts(lowerParts), material);
  const upperHalf = new Mesh(mergeParts(upperParts), material);
  for (const m of [lowerHalf, upperHalf]) {
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  return {
    group,
    update(lower, upper) {
      _dir.subVectors(upper, lower);
      const len = _dir.length();
      if (len < 1e-7) return 0;
      _dir.multiplyScalar(1 / len);
      placeAlong(lowerHalf, lower, _dir);
      placeAlong(upperHalf, upper, _dir);
      return len;
    },
  };
}

/** Disposes the two half geometries (materials belong to the caller). */
export function disposeDamper(d: Damper): void {
  for (const c of d.group.children) (c as Mesh).geometry.dispose();
}
