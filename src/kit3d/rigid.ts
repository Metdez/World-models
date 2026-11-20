/**
 * Rigid bodies driven by hardpoints (research 22 B0/B2). Geometry is authored ONCE in rest coordinates; per frame
 * only the object's matrix is set: M = F(now) * F(rest)^-1 from three non-collinear hardpoints, or a swing
 * rotation for a single rod. Objects driven here must have `matrixAutoUpdate = false`.
 */
import { ExtrudeGeometry, Matrix4, Quaternion, Shape, Vector2, Vector3, type BufferGeometry, type Object3D } from 'three';
import { bakedDisc, bakedSphere, bakedTube, mergeParts } from './tube';

const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();
const _q = new Quaternion();
const _v = new Vector3();

/** Orthonormal right-handed frame with origin p0, x toward p1, z normal to the (p0, p1, p2) plane. */
export function frameFrom3(p0: Vector3, p1: Vector3, p2: Vector3, out: Matrix4): Matrix4 {
  _x.subVectors(p1, p0).normalize();
  _z.crossVectors(_x, _y.subVectors(p2, p0)).normalize();
  _y.crossVectors(_z, _x);
  return out.makeBasis(_x, _y, _z).setPosition(p0);
}

/** Inverse rest frame for `setRigid` (build time). */
export function restInverse(p0: Vector3, p1: Vector3, p2: Vector3): Matrix4 {
  return frameFrom3(p0, p1, p2, new Matrix4()).invert();
}

/** o.matrix = F(now) * restInv. No allocation. */
export function setRigid(o: Object3D, restInv: Matrix4, p0: Vector3, p1: Vector3, p2: Vector3): void {
  frameFrom3(p0, p1, p2, o.matrix).multiply(restInv);
  o.matrixWorldNeedsUpdate = true;
}

/**
 * Single rod rigid body: the minimal (swing) rotation taking the rest direction to a->b, anchored at a.
 * `restA` and the unit `restDir` are the rest end point and direction. No allocation.
 */
export function setSwing(o: Object3D, restA: Vector3, restDir: Vector3, a: Vector3, b: Vector3): void {
  _v.subVectors(b, a).normalize();
  _q.setFromUnitVectors(restDir, _v);
  o.matrix.makeRotationFromQuaternion(_q);
  _v.copy(restA).applyQuaternion(_q);
  o.matrix.setPosition(a.x - _v.x, a.y - _v.y, a.z - _v.z);
  o.matrixWorldNeedsUpdate = true;
}

/** Hull-free plate of a polygon (in-plane points) extruded along the plate normal. Build time only. */
export function platePolygon(points: readonly Vector3[], normal: Vector3, thickness: number, bevel = 0.002): BufferGeometry {
  const p0 = points[0]!;
  const u = new Vector3().subVectors(points[1]!, p0).normalize();
  const n = normal.clone().normalize();
  const v = new Vector3().crossVectors(n, u);
  const shape = new Shape(points.map((p) => new Vector2(_v.subVectors(p, p0).dot(u), _v.dot(v))));
  const depth = Math.max(thickness - 2 * bevel, 1e-4);
  const g = new ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  g.applyMatrix4(new Matrix4().makeBasis(u, v, n).setPosition(p0));
  return g;
}

export interface BushingSpec {
  /** Arm eye outer radius. */
  readonly radius: number;
  /** Length along the pivot axis. */
  readonly length: number;
}

/** Geometry of a bushed eye split by material: arm-coloured eye, rubber ring ends, steel inner sleeve. */
export function bushingParts(c: Vector3, axis: Vector3, b: BushingSpec): { eye: BufferGeometry; rubber: BufferGeometry; sleeve: BufferGeometry } {
  return {
    eye: bakedDisc(c, axis, b.radius, b.length),
    rubber: bakedDisc(c, axis, b.radius * 0.78, b.length + 0.008),
    sleeve: bakedDisc(c, axis, b.radius * 0.36, b.length + 0.026, 12),
  };
}

export interface AArmSpec {
  /** Leg radius at the bushings and at the ball joint. */
  readonly legRadius: readonly [inner: number, outer: number];
  readonly bushing: BushingSpec;
  /** Ball-joint housing radius (axis along the arm-plane normal). */
  readonly jointRadius: number;
  /** Fraction of each leg covered by the gusset plate from the ball joint. */
  readonly gusset: number;
}

/**
 * Tubular A-arm (wishbone) in rest coordinates: two legs from the chassis bushings (front, rear) to the ball
 * joint, a gusset web near the joint, bushed eyes along the pivot axis, a ball-joint housing whose stud and boot
 * point toward `toward` (the upright), and a boss with braces to each leg for every extra pickup (spring seat,
 * anti-roll-bar link). Returns geometry per material.
 */
export function aArmGeometry(
  bj: Vector3,
  front: Vector3,
  rear: Vector3,
  toward: Vector3,
  extras: readonly Vector3[],
  spec: AArmSpec,
): { body: BufferGeometry; rubber: BufferGeometry; steel: BufferGeometry } {
  const axis = new Vector3().subVectors(rear, front).normalize();
  const normal = new Vector3().crossVectors(axis, new Vector3().subVectors(bj, front)).normalize();
  const stud = normal.clone().multiplyScalar(Math.sign(normal.dot(new Vector3().subVectors(toward, bj))) || 1);
  const [ri, ro] = spec.legRadius;
  const b = spec.bushing;
  const body: BufferGeometry[] = [];
  const rubber: BufferGeometry[] = [];
  const steel: BufferGeometry[] = [];
  for (const c of [front, rear]) {
    const parts = bushingParts(c, axis, b);
    body.push(parts.eye, bakedTube(c, bj, ri, ro));
    rubber.push(parts.rubber);
    steel.push(parts.sleeve);
  }
  const gf = new Vector3().lerpVectors(bj, front, spec.gusset);
  const gr = new Vector3().lerpVectors(bj, rear, spec.gusset);
  body.push(platePolygon([bj, gf, gr], normal, ri * 1.5));
  // Ball joint: housing in the arm, ball, stud and rubber boot toward the upright.
  const h = spec.jointRadius;
  body.push(bakedDisc(bj, normal, h, h * 1.3));
  const ball = new Vector3().copy(bj).addScaledVector(stud, h * 0.55);
  steel.push(bakedSphere(ball, h * 0.62), bakedTube(ball, new Vector3().copy(bj).addScaledVector(stud, h * 2.2), h * 0.36, h * 0.3, 12));
  rubber.push(bakedTube(new Vector3().copy(bj).addScaledVector(stud, h * 0.6), new Vector3().copy(bj).addScaledVector(stud, h * 1.5), h * 0.95, h * 0.45));
  for (const p of extras) {
    body.push(bakedDisc(p, axis, ri * 1.9, ri * 3.2));
    for (const leg of [front, rear]) body.push(bakedTube(p, closestOnSegment(p, leg, bj), ri * 0.8));
  }
  return { body: mergeParts(body), rubber: mergeParts(rubber), steel: mergeParts(steel) };
}

/** Closest point to p on segment a-b (new vector; build time). */
export function closestOnSegment(p: Vector3, a: Vector3, b: Vector3): Vector3 {
  const ab = new Vector3().subVectors(b, a);
  const t = Math.min(1, Math.max(0, new Vector3().subVectors(p, a).dot(ab) / ab.lengthSq()));
  return new Vector3().copy(a).addScaledVector(ab, t);
}

/**
 * Chassis bracket cheek: a plate normal to the pivot `axis` at `c`, rounded around the pivot and running `reach`
 * toward `toward` (e.g. the centreline). Build time only.
 */
export function bracketTab(c: Vector3, axis: Vector3, toward: Vector3, radius: number, reach: number, thickness: number): BufferGeometry {
  const n = axis.clone().normalize();
  const u = new Vector3().subVectors(toward, c);
  u.addScaledVector(n, -u.dot(n)).normalize();
  const v = new Vector3().crossVectors(n, u);
  const pts: Vector3[] = [];
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI / 2 + (i / 10) * Math.PI;
    pts.push(c.clone().addScaledVector(u, radius * Math.cos(a)).addScaledVector(v, radius * Math.sin(a)));
  }
  pts.push(c.clone().addScaledVector(u, reach).addScaledVector(v, -radius), c.clone().addScaledVector(u, reach).addScaledVector(v, radius));
  return platePolygon(pts, n, thickness);
}
