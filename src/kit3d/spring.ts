/**
 * Coil spring with a CONSTANT wire radius at any length (research 22 B4, research 10 §B10): the helix is evaluated
 * in the vertex shader from two attributes (t along the wire, phi around it), so a length change is one uniform.
 * The wire cross-section lies in the plane normal to the exact helix tangent:
 *   C(t)  = (R cos th, h(t), R sin th),  th = 2 pi N t
 *   e_r   = (cos th, 0, sin th)           (exactly perpendicular to the tangent)
 *   b     = (H sin th, R w, -H cos th) / sqrt(H^2 + R^2 w^2),  w = 2 pi N, H = dh/dt
 *   P     = C + r (cos phi e_r + sin phi b), normal = cos phi e_r + sin phi b
 * h(t) is piecewise linear in turns: `dead` closed turns at each end (pitch 2r, touching), active turns share the
 * rest. The length is clamped at coil bind (all turns touching). `springVertex` is the same maths in TS: it fills
 * the bounds-only position attribute and is what the tests check; the GLSL below must stay identical to it.
 */
import { BufferAttribute, BufferGeometry, Float32BufferAttribute, MeshDepthMaterial, RGBADepthPacking, Sphere, Vector3, type MeshStandardMaterial, type Object3D } from 'three';

export interface CoilSpec {
  /** Total turns including the closed end turns. */
  readonly turns: number;
  /** Closed (dead) turns at EACH end. */
  readonly dead: number;
  /** Mean coil radius, m. */
  readonly coilRadius: number;
  /** Wire radius, m. */
  readonly wireRadius: number;
  /** Length used for the bounds; the bounding sphere covers lengths up to `maxLength`. */
  readonly restLength: number;
  readonly maxLength: number;
}

/** Shortest drawable length: every turn touching its neighbour (coil bind / solid height). */
export function solidLength(s: CoilSpec): number {
  return 2 * s.wireRadius * s.turns;
}

/** Clamps a seat-to-seat length to the coil-bind length. */
export function clampSpringLength(s: CoilSpec, length: number): number {
  const solid = solidLength(s);
  return length < solid ? solid : length;
}

/** Height h along the axis and its slope dh/dt at t in [0, 1]. Writes [h, dh/dt] into out. */
function height(t: number, s: CoilSpec, length: number, out: Float64Array): void {
  const n = t * s.turns;
  const closed = 2 * s.wireRadius;
  const active = s.turns - 2 * s.dead;
  const pitch = active > 0 ? (length - 2 * s.dead * closed) / active : 0;
  if (n < s.dead) {
    out[0] = closed * n;
    out[1] = closed * s.turns;
  } else if (n > s.turns - s.dead) {
    out[0] = length - closed * (s.turns - n);
    out[1] = closed * s.turns;
  } else {
    out[0] = closed * s.dead + pitch * (n - s.dead);
    out[1] = pitch * s.turns;
  }
}

const _h = new Float64Array(2);

/** Surface point and normal of the spring at (t, phi) for a seat-to-seat length (already clamped). */
export function springVertex(t: number, phi: number, s: CoilSpec, length: number, pos: Vector3, normal?: Vector3): Vector3 {
  height(t, s, length, _h);
  const w = 2 * Math.PI * s.turns;
  const th = w * t;
  const c = Math.cos(th);
  const sn = Math.sin(th);
  const H = _h[1]!;
  const m = Math.sqrt(H * H + s.coilRadius * s.coilRadius * w * w);
  const bx = (H * sn) / m;
  const by = (s.coilRadius * w) / m;
  const bz = (-H * c) / m;
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  const nx = cp * c + sp * bx;
  const ny = sp * by;
  const nz = cp * sn + sp * bz;
  pos.set(s.coilRadius * c + s.wireRadius * nx, _h[0]! + s.wireRadius * ny, s.coilRadius * sn + s.wireRadius * nz);
  normal?.set(nx, ny, nz);
  return pos;
}

/** Wire-parameter grid (aT, aPhi). Position/normal hold the rest shape (bounds and raycasts only). */
export function springGeometry(s: CoilSpec, segmentsPerTurn = 40, radialSegments = 12): BufferGeometry {
  const nT = Math.ceil(s.turns * segmentsPerTurn);
  const nP = radialSegments;
  const count = (nT + 1) * (nP + 1);
  const aT = new Float32Array(count);
  const aPhi = new Float32Array(count);
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  const idx: number[] = [];
  const p = new Vector3();
  const n = new Vector3();
  for (let i = 0, k = 0; i <= nT; i++) {
    for (let j = 0; j <= nP; j++, k++) {
      aT[k] = i / nT;
      aPhi[k] = (j / nP) * Math.PI * 2;
      springVertex(aT[k]!, aPhi[k]!, s, s.restLength, p, n);
      pos.set([p.x, p.y, p.z], k * 3);
      nrm.set([n.x, n.y, n.z], k * 3);
    }
  }
  for (let i = 0; i < nT; i++) {
    for (let j = 0; j < nP; j++) {
      const a = i * (nP + 1) + j;
      const b = a + nP + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  // Present so three keeps smooth shading (a geometry without normals is forced flat); the shader overrides it.
  g.setAttribute('normal', new BufferAttribute(nrm, 3));
  g.setAttribute('aT', new Float32BufferAttribute(aT, 1));
  g.setAttribute('aPhi', new Float32BufferAttribute(aPhi, 1));
  g.setIndex(idx);
  const r = s.coilRadius + s.wireRadius;
  g.boundingSphere = new Sphere(new Vector3(0, s.maxLength / 2, 0), Math.hypot(s.maxLength / 2, r));
  return g;
}

const GLSL_HELIX = /* glsl */ `
attribute float aT;
attribute float aPhi;
uniform float uLen;
uniform float uTurns;
uniform float uDead;
uniform float uCoilR;
uniform float uWireR;
void springSurface(out vec3 spP, out vec3 spN) {
  float n = aT * uTurns;
  float closed = 2.0 * uWireR;
  float activeTurns = uTurns - 2.0 * uDead;
  float pitch = activeTurns > 0.0 ? (uLen - 2.0 * uDead * closed) / activeTurns : 0.0;
  float h;
  float H;
  if (n < uDead) {
    h = closed * n; H = closed * uTurns;
  } else if (n > uTurns - uDead) {
    h = uLen - closed * (uTurns - n); H = closed * uTurns;
  } else {
    h = closed * uDead + pitch * (n - uDead); H = pitch * uTurns;
  }
  float w = 6.283185307179586 * uTurns;
  float th = w * aT;
  float c = cos(th);
  float s = sin(th);
  float m = sqrt(H * H + uCoilR * uCoilR * w * w);
  vec3 b = vec3(H * s, uCoilR * w, -H * c) / m;
  spN = cos(aPhi) * vec3(c, 0.0, s) + sin(aPhi) * b;
  spP = vec3(uCoilR * c, h, uCoilR * s) + uWireR * spN;
}
`;

export interface SpringUniforms {
  readonly uLen: { value: number };
  readonly uTurns: { value: number };
  readonly uDead: { value: number };
  readonly uCoilR: { value: number };
  readonly uWireR: { value: number };
}

function uniformsFor(s: CoilSpec): SpringUniforms {
  return {
    uLen: { value: s.restLength },
    uTurns: { value: s.turns },
    uDead: { value: s.dead },
    uCoilR: { value: s.coilRadius },
    uWireR: { value: s.wireRadius },
  };
}

/**
 * Turns a (fresh, unshared) MeshStandard/Physical material into a spring material and returns the matching
 * shadow depth material (assign it to `mesh.customDepthMaterial`). Both share one uniform set; programs are shared
 * between springs (same shader text), uniforms are per material.
 */
export function makeSpringMaterial(material: MeshStandardMaterial, s: CoilSpec): { uniforms: SpringUniforms; depth: MeshDepthMaterial } {
  const uniforms = uniformsFor(s);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL_HELIX}`)
      .replace('#include <beginnormal_vertex>', 'vec3 spP; vec3 spN; springSurface(spP, spN);\nvec3 objectNormal = spN;')
      .replace('#include <begin_vertex>', 'vec3 transformed = spP;');
  };
  material.customProgramCacheKey = () => 'kit3d-spring';
  const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  depth.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL_HELIX}`)
      .replace('#include <begin_vertex>', 'vec3 spP; vec3 spN; springSurface(spP, spN);\nvec3 transformed = spP;');
  };
  depth.customProgramCacheKey = () => 'kit3d-spring-depth';
  return { uniforms, depth };
}

const UP = new Vector3(0, 1, 0);
const _d = new Vector3();

/**
 * Places the spring with its first coil on `lowerSeat` and its axis toward `upperSeat`; sets the length uniform
 * (clamped at coil bind). Returns the drawn length. No allocation.
 */
export function updateSpring(o: Object3D, uniforms: SpringUniforms, s: CoilSpec, lowerSeat: Vector3, upperSeat: Vector3): number {
  _d.subVectors(upperSeat, lowerSeat);
  const raw = _d.length();
  const len = clampSpringLength(s, raw);
  o.position.copy(lowerSeat);
  if (raw > 1e-7) o.quaternion.setFromUnitVectors(UP, _d.multiplyScalar(1 / raw));
  uniforms.uLen.value = len;
  return len;
}
