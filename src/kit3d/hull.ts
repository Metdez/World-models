/**
 * Cast-looking rigid bodies (uprights, knuckles) from hardpoints (research 22 B3): each hardpoint is inflated into
 * a small sphere sample so the convex hull becomes a chunky blended casting instead of a sliver. A "lobed" body is
 * the union of one hull per lobe (core + that lobe's pads), which keeps the concave spider shape of a real
 * knuckle. Normals are creased: soft across shallow edges, crisp on sharp ones. Build time only.
 */
import { Vector3, type BufferGeometry } from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { mergeParts } from './tube';

export interface Pad {
  readonly p: Vector3;
  /** Local thickness (sphere radius), m. */
  readonly r: number;
}

/** n points evenly spread on the unit sphere (Fibonacci lattice). */
export function fibonacciSphere(n: number): Vector3[] {
  const out: Vector3[] = [];
  const g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    out.push(new Vector3(Math.cos(g * i) * r, y, Math.sin(g * i) * r));
  }
  return out;
}

/** Convex hull of inflated pads with creased normals. */
export function padHull(pads: readonly Pad[], samples = 42, creaseDeg = 50): BufferGeometry {
  const s = fibonacciSphere(samples);
  const pts: Vector3[] = [];
  for (const { p, r } of pads) for (const d of s) pts.push(new Vector3().copy(p).addScaledVector(d, r));
  return toCreasedNormals(new ConvexGeometry(pts), (creaseDeg * Math.PI) / 180);
}

/** Union of hulls: `core` pads plus each lobe's pads in turn. */
export function lobedHull(core: readonly Pad[], lobes: readonly (readonly Pad[])[], samples = 42): BufferGeometry {
  return mergeParts(lobes.map((lobe) => padHull([...core, ...lobe], samples)));
}
