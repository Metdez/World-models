/**
 * Shared pieces of the `moto-planar` suspension visual: frame conversion, planar rotation helpers, the coil-over
 * (kit3d damper + shader spring) sized from its mount distance, and the floating brake disc + caliper.
 */
import { Group, Mesh, Vector3, type BufferGeometry, type Material, type MeshStandardMaterial } from 'three';
import type { Vec3 } from '../../../contracts/units';
import { brakeDiscGeometry, caliperGeometry } from '../../../kit3d/brake';
import { createDamper, disposeDamper, type Damper } from '../../../kit3d/damper';
import { paint, type Finish } from '../../../kit3d/materials';
import { makeSpringMaterial, springGeometry, updateSpring, type CoilSpec, type SpringUniforms } from '../../../kit3d/spring';
import { bakedDisc, bakedTube, mergeParts } from '../../../kit3d/tube';

/** Sim vehicle-frame point -> three.js vehicle space (x fwd, y up, z right). */
export const toThree = (p: Vec3): Vector3 => new Vector3(p[0], p[2], -p[1]);

/** Angle of (b - a) in the body x–y plane (three), rad. */
export function planarAngle(a: Vector3, b: Vector3): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** Rotates p about the three Z axis through c by angle a, in place (planar part motion). */
export function rotateZAbout(p: Vector3, c: Vector3, a: number): Vector3 {
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  p.x = c.x + dx * ca - dy * sa;
  p.y = c.y + dx * sa + dy * ca;
  return p;
}

export interface CoilOver {
  readonly group: Group;
  readonly spring: Mesh;
  readonly springMaterial: MeshStandardMaterial;
  /** Mount points in the group's parent space. */
  update(lower: Vector3, upper: Vector3): void;
  dispose(): void;
}

const _dir = new Vector3();
const _lo = new Vector3();
const _hi = new Vector3();

/**
 * Coil-over shock sized from its static eye-to-eye length: body on the lower eye, chrome rod from the upper eye,
 * spring between the seats (shader coil: constant wire, binds at the solid length). `damperMaterial` is the corner's
 * damper role material; the spring gets its OWN material cloned from `springBase` (one length uniform per spring).
 */
export function createCoilOver(damperMaterial: Material, springBase: MeshStandardMaterial, length: number, heavy: boolean): CoilOver {
  const bodyRadius = heavy ? 0.024 : 0.02;
  const low = length * 0.16;
  const high = length * 0.07;
  const seatRadius = heavy ? 0.042 : 0.036;
  const damper: Damper = createDamper(damperMaterial, 'damper', {
    bodyLength: length * 0.52,
    bodyBelow: 0,
    bodyRadius,
    rodLength: length * 0.62,
    rodRadius: heavy ? 0.009 : 0.0075,
    eyeRadius: 0.012,
    seats: { low, high, radius: seatRadius },
  });
  const restLength = length - low - high;
  const coil: CoilSpec = {
    turns: Math.max(6, Math.round(restLength / (heavy ? 0.024 : 0.021))),
    dead: 1,
    coilRadius: seatRadius * 0.82,
    wireRadius: heavy ? 0.0062 : 0.0052,
    restLength,
    maxLength: restLength + 0.06,
  };
  const springMaterial = springBase.clone();
  const { uniforms, depth } = makeSpringMaterial(springMaterial, coil);
  const geometry = springGeometry(coil, 30, 10);
  const spring = new Mesh(geometry, springMaterial);
  spring.customDepthMaterial = depth;
  spring.castShadow = true;
  spring.receiveShadow = true;
  spring.frustumCulled = false;
  damper.group.add(spring);
  const u: SpringUniforms = uniforms;
  return {
    group: damper.group,
    spring,
    springMaterial,
    update(lower, upper) {
      damper.update(lower, upper);
      _dir.subVectors(upper, lower);
      const len = _dir.length();
      if (len < 1e-6) return;
      _dir.multiplyScalar(1 / len);
      _lo.copy(lower).addScaledVector(_dir, low);
      _hi.copy(upper).addScaledVector(_dir, -high);
      updateSpring(spring, u, coil, _lo, _hi);
    },
    dispose() {
      disposeDamper(damper);
      geometry.dispose();
      springMaterial.dispose();
      depth.dispose();
    },
  };
}

export interface DiscSpec {
  readonly radius: number;
  readonly band: number;
  /** Axial position (three z) of the friction ring. */
  readonly z: number;
}

/**
 * Floating disc around the three Z axis at the origin: drilled friction ring (kit3d), a six-arm carrier and bobbins.
 * Built with +Y outboard then turned so outboard points away from the wheel centre (sign of z).
 */
export function floatingDisc(d: DiscSpec): BufferGeometry {
  const ring = paint(
    brakeDiscGeometry({ outerRadius: d.radius, innerRadius: d.radius - d.band, thickness: 0.005, hatDepth: 0.003, holes: 14, holeRadius: 0.0032 }),
    'disc',
  );
  const parts: BufferGeometry[] = [ring];
  const inner = d.radius - d.band;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    parts.push(paint(bakedTube(new Vector3(c * 0.045, 0, s * 0.045), new Vector3(c * (inner + 0.004), 0, s * (inner + 0.004)), 0.007, 0.006, 8), 'steel'));
    const b = (i / 6 + 1 / 12) * Math.PI * 2;
    parts.push(paint(bakedDisc(new Vector3(Math.cos(b) * (inner + 0.002), 0, Math.sin(b) * (inner + 0.002)), new Vector3(0, 1, 0), 0.0055, 0.01, 10), 'chrome'));
  }
  parts.push(paint(bakedDisc(new Vector3(0, 0, 0), new Vector3(0, 1, 0), 0.05, 0.008, 24), 'steel'));
  const g = mergeParts(parts);
  // +Y -> +Z (outboard right) or -Z (outboard left).
  g.rotateX(d.z >= 0 ? Math.PI / 2 : -Math.PI / 2);
  return g.translate(0, 0, d.z);
}

/** Fixed caliper straddling a disc at (three) angle `angle` around the Z axis, at axial z. */
export function caliper(discRadius: number, z: number, angle: number, finish: Finish = 'caliper'): BufferGeometry {
  const g = paint(
    caliperGeometry({ innerRadius: discRadius - 0.03, outerRadius: discRadius + 0.012, halfSpan: 0.34, width: 0.05, discThickness: 0.005, discRadius }),
    finish,
  );
  g.rotateX(Math.PI / 2);
  g.rotateZ(angle);
  return g.translate(0, 0, z);
}

export function disposeAll(list: readonly { geometry: BufferGeometry }[]): void {
  for (const m of list) m.geometry.dispose();
}
