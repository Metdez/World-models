/**
 * Tubes, rods and merged part geometry (research 22 B1). Variable-length parts share ONE unit cylinder
 * (radius 1, height 1 along +Y) and are placed per frame by transform only; rigid parts bake their tubes into
 * geometry authored in rest coordinates. Placement pattern after KRoshanK/AxleLab `orientY`/`between` (MIT).
 */
import { BufferAttribute, BufferGeometry, CylinderGeometry, LatheGeometry, Quaternion, SphereGeometry, Vector2, Vector3, type Object3D } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const UP = new Vector3(0, 1, 0);
const _d = new Vector3();
const _q = new Quaternion();

/** Radius 1, height 1, along +Y, centred on the origin, with caps. */
export function unitCylinder(radialSegments = 18): BufferGeometry {
  return new CylinderGeometry(1, 1, 1, radialSegments, 1, false);
}

export function unitSphere(widthSegments = 18, heightSegments = 12): BufferGeometry {
  return new SphereGeometry(1, widthSegments, heightSegments);
}

/**
 * Places an object carrying the unit cylinder between `a` and `b` (same parent space) with the given radius.
 * Returns the length. Hides the object for a degenerate segment. No allocation.
 */
export function updateTube(o: Object3D, a: Vector3, b: Vector3, radius: number): number {
  _d.subVectors(b, a);
  const len = _d.length();
  if (len < 1e-7) {
    o.visible = false;
    return 0;
  }
  o.visible = true;
  o.position.addVectors(a, b).multiplyScalar(0.5);
  o.quaternion.setFromUnitVectors(UP, _d.multiplyScalar(1 / len));
  o.scale.set(radius, len, radius);
  return len;
}

/** Puts `o` at `p` with its +Y along the unit vector `dir` (uniform scale untouched). No allocation. */
export function placeAlong(o: Object3D, p: Vector3, dir: Vector3): void {
  o.position.copy(p);
  o.quaternion.setFromUnitVectors(UP, dir);
}

/** Cylinder from `a` (radius ra) to `b` (radius rb), baked in the space of a and b. Build time only. */
export function bakedTube(a: Vector3, b: Vector3, ra: number, rb = ra, radialSegments = 18): BufferGeometry {
  const d = new Vector3().subVectors(b, a);
  const len = d.length();
  const g = new CylinderGeometry(rb, ra, Math.max(len, 1e-6), radialSegments, 1, false);
  _q.setFromUnitVectors(UP, d.normalize());
  g.applyQuaternion(_q);
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

/** Short cylinder centred on `c` with its axis along `axis` (any length). Build time only. */
export function bakedDisc(c: Vector3, axis: Vector3, radius: number, length: number, radialSegments = 22): BufferGeometry {
  const half = new Vector3().copy(axis).normalize().multiplyScalar(length / 2);
  return bakedTube(new Vector3().subVectors(c, half), new Vector3().addVectors(c, half), radius, radius, radialSegments);
}

export function bakedSphere(c: Vector3, radius: number, widthSegments = 16, heightSegments = 12): BufferGeometry {
  return new SphereGeometry(radius, widthSegments, heightSegments).translate(c.x, c.y, c.z);
}

/**
 * Merges part geometries into one (position, normal and uv, non-indexed) so one rigid body is one draw call.
 * Paint (uv) either all inputs or none. Inputs are disposed.
 */
export function mergeParts(parts: readonly BufferGeometry[]): BufferGeometry {
  const prepared = parts.map((g) => {
    const flat = g.index ? g.toNonIndexed() : g;
    const out = new BufferGeometry();
    out.setAttribute('position', flat.getAttribute('position') as BufferAttribute);
    out.setAttribute('normal', flat.getAttribute('normal') as BufferAttribute);
    const uv = flat.getAttribute('uv') as BufferAttribute | undefined;
    if (uv) out.setAttribute('uv', uv);
    if (flat !== g) flat.dispose();
    g.dispose();
    return out;
  });
  const merged = mergeGeometries(prepared, false);
  for (const g of prepared) g.dispose();
  if (!merged) throw new Error('kit3d: mergeParts failed');
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Rubber bellows (rack gaiter, CV/dust boot) of unit height along +Y, centred on the origin, radius r0 at -Y and r1
 * at +Y with `folds` convolutions. Place with `updateTube(o, a, b, 1)`: the length stretches, the radii stay.
 * Profile idea after KRoshanK/AxleLab `bootGeometry` (MIT).
 */
export function bellowsGeometry(r0: number, r1: number, folds: number, depth: number, radialSegments = 20): BufferGeometry {
  const pts: Vector2[] = [];
  const n = folds * 8;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const ripple = depth * 0.5 * (1 - Math.cos(2 * Math.PI * folds * u));
    pts.push(new Vector2(r0 + (r1 - r0) * u + ripple, u - 0.5));
  }
  return new LatheGeometry(pts, radialSegments);
}
