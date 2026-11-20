import { BufferAttribute, BufferGeometry, Matrix3, Vector3, type Matrix4 } from 'three';

export interface BakePart {
  readonly geometry: BufferGeometry;
  /** Geometry space -> target space. */
  readonly matrix: Matrix4;
}

const v = new Vector3();
const nm = new Matrix3();

/**
 * Merges parts into ONE indexed float geometry (position + normal) in the target space. Reads through
 * getX/getY/getZ, so quantised (KHR_mesh_quantization, normalised int) attributes come out in metres.
 * A mirroring matrix (det < 0) flips the triangle winding so faces keep pointing out.
 */
export function bakeMerge(parts: readonly BakePart[]): BufferGeometry {
  let vertices = 0;
  let indices = 0;
  for (const { geometry: g } of parts) {
    const n = g.getAttribute('position').count;
    vertices += n;
    indices += g.index ? g.index.count : n;
  }
  const pos = new Float32Array(vertices * 3);
  const nor = new Float32Array(vertices * 3);
  const idx = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  let vo = 0;
  let io = 0;
  for (const { geometry: g, matrix } of parts) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    nm.getNormalMatrix(matrix);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      pos[(vo + i) * 3] = v.x;
      pos[(vo + i) * 3 + 1] = v.y;
      pos[(vo + i) * 3 + 2] = v.z;
      if (n) v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      else v.set(0, 1, 0);
      nor[(vo + i) * 3] = v.x;
      nor[(vo + i) * 3 + 1] = v.y;
      nor[(vo + i) * 3 + 2] = v.z;
    }
    const flip = matrix.determinant() < 0;
    const count = g.index ? g.index.count : p.count;
    for (let k = 0; k < count; k += 3) {
      const a = g.index ? g.index.getX(k) : k;
      const b = g.index ? g.index.getX(k + 1) : k + 1;
      const c = g.index ? g.index.getX(k + 2) : k + 2;
      idx[io++] = vo + a;
      idx[io++] = vo + (flip ? c : b);
      idx[io++] = vo + (flip ? b : c);
    }
    vo += p.count;
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(pos, 3));
  out.setAttribute('normal', new BufferAttribute(nor, 3));
  out.setIndex(new BufferAttribute(idx, 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}
