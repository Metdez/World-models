/**
 * Rear end of the `moto-planar` visual: twin-sided swingarm with twin shocks, twin-sided arm with a rising-rate
 * linkage (rocker on the frame, dog-bone to the arm, monoshock to the rocker), or a single-sided arm with one shock.
 * Rear disc (spinning) and caliper ride on the arm. Everything is authored at REST in three.js body space; per frame
 * the arm, rocker and dog-bone turn in the body x–y plane to the posed points and the shocks span their mounts.
 */
import { Group, Mesh, Shape, Vector3, type BufferGeometry, type Material, type MeshStandardMaterial } from 'three';
import type { LinkageRear, SwingarmRear } from '../../../contracts/suspension';
import type { MotorcycleDefinition } from '../../../contracts/vehicle';
import { paint, type PartMaterials } from '../../../kit3d/materials';
import { bracketTab, platePolygon } from '../../../kit3d/rigid';
import { bakedDisc, bakedTube, mergeParts } from '../../../kit3d/tube';
import { motoPaint } from '../visual/palette';
import { basis, slab } from '../visual/shapes';
import { caliper, createCoilOver, floatingDisc, planarAngle, toThree, type CoilOver } from './common';

export interface RearRig {
  readonly group: Group;
  readonly chassis: readonly BufferGeometry[];
  readonly meshes: readonly Mesh[];
  readonly springMaterials: readonly MeshStandardMaterial[];
  /** Rest points (body space) by contract name. */
  readonly rest: ReadonlyMap<string, Vector3>;
  /**
   * Pose from body-space points by contract name (pivot, axle, shockLower | swingarmLink, rockerLink, rockerShock)
   * and the wheel spin. No allocation.
   */
  update(p: ReadonlyMap<string, Vector3>, spin: number): void;
  /** Debug/test: link end points at the last update (body space). */
  inspect(): { dogBone: [Vector3, Vector3] | null; shocks: [Vector3, Vector3][] };
  dispose(): void;
}

const Z = new Vector3(0, 0, 1);

export function buildRear(def: SwingarmRear | LinkageRear, vehicle: MotorcycleDefinition, roles: PartMaterials, plain: Material): RearRig {
  const P = toThree(def.pivot);
  const A = toThree(def.axle);
  const tyre = vehicle.rear.tyre;
  const legZ = Math.max(0.112, tyre.width / 2 + 0.035);
  const single = def.kind === 'swingarm' && def.singleSided;
  // Single-sided arm on the side its shock sits (sim -y = right by default, as a shaft Paralever).
  const armSide = single ? (def.shockLower[1] > 0.01 ? -1 : 1) : 0;
  const meshes: Mesh[] = [];
  const geometries: BufferGeometry[] = [];
  const group = new Group();
  group.name = 'rear';
  const add = (parent: Group, parts: BufferGeometry[], m: Material, name: string): Mesh => {
    const g = mergeParts(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
    const o = new Mesh(g, m);
    o.name = name;
    o.castShadow = o.receiveShadow = true;
    parent.add(o);
    meshes.push(o);
    geometries.push(g);
    return o;
  };
  /** A point relative to the arm's pivot (arm-local). */
  const rel = (p: Vector3) => p.clone().sub(P);

  // ---------------------------------------------------------------- swingarm
  const arm = new Group();
  arm.name = 'swingarm';
  arm.position.copy(P);
  group.add(arm);
  const armParts: BufferGeometry[] = [];
  const u = rel(A).normalize();
  const len = rel(A).length();
  // Cross brace: at the link lug for a linkage (clear of the monoshock), else a third of the way back.
  const braceAt = def.kind === 'swingarm-linkage' ? Math.max(0.15, Math.min(0.5, rel(toThree(def.swingarmLink)).dot(u) / len)) : 0.36;
  const leg = (z: number, h0: number, h1: number, w: number) => {
    const shape = new Shape();
    shape.moveTo(-0.025, -h0 * 0.55);
    shape.lineTo(len + 0.035, -h1 * 0.5);
    shape.lineTo(len + 0.035, h1 * 0.5);
    shape.lineTo(len * 0.35, h0 * 0.48);
    shape.lineTo(-0.025, h0 * 0.45);
    shape.closePath();
    const g = slab(shape, w, 0.008, basis(new Vector3(0, 0, z), u, Z), 'black');
    armParts.push(paint(g, 'swingarm'));
  };
  if (!single) {
    for (const s of [-1, 1]) leg(s * legZ, 0.062, 0.042, 0.034);
    const brace = u.clone().multiplyScalar(len * braceAt);
    armParts.push(paint(bakedTube(brace.clone().setZ(-legZ), brace.clone().setZ(legZ), 0.02, 0.02, 16), 'swingarm'));
  } else {
    leg(armSide * (legZ + 0.006), 0.095, 0.07, 0.05);
    const brace = u.clone().multiplyScalar(len * 0.3).setZ(armSide * legZ);
    armParts.push(paint(bakedTube(new Vector3(0, 0, -armSide * 0.1), brace, 0.022, 0.02, 16), 'swingarm'));
    // Hub carrier: eccentric housing around the axle on the arm side.
    const a = rel(A);
    armParts.push(paint(bakedDisc(a.clone().setZ(armSide * (legZ - 0.01)), Z, 0.072, 0.06, 32), 'swingarm'));
    armParts.push(paint(bakedDisc(a.clone().setZ(armSide * (legZ + 0.024)), Z, 0.05, 0.012, 32), 'steel'));
  }
  // Pivot tube with bushings, axle, chain adjusters.
  armParts.push(paint(bakedTube(new Vector3(0, 0, -0.112), new Vector3(0, 0, 0.112), 0.027, 0.027, 20), 'swingarm'));
  for (const s of [-1, 1]) armParts.push(paint(bakedDisc(new Vector3(0, 0, s * 0.118), Z, 0.02, 0.012, 16), 'rubber'));
  const a = rel(A);
  const axleHalf = single ? 0 : legZ + 0.025;
  armParts.push(paint(bakedTube(a.clone().setZ(single ? armSide * 0.03 : -axleHalf), a.clone().setZ(single ? armSide * (legZ + 0.035) : axleHalf), 0.011, 0.011, 12), 'steel'));
  if (!single) {
    for (const s of [-1, 1]) {
      armParts.push(paint(bakedDisc(a.clone().setZ(s * (legZ + 0.02)), Z, 0.016, 0.008, 6), 'chrome'));
      armParts.push(paint(bakedTube(a.clone().addScaledVector(u, 0.03).setZ(s * (legZ + 0.019)), a.clone().addScaledVector(u, -0.04).setZ(s * (legZ + 0.019)), 0.006, 0.006, 8), 'chrome'));
    }
  }
  // Twin-shock / single-shock lower studs; linkage lug under the brace.
  // Three z of a shock: the definition's y (mirrored); a single shock on a single-sided arm drawn at y = 0 would
  // sit inside the tyre, so it goes just outboard of the arm.
  const shockZ = (sim: readonly [number, number, number]) => (Math.abs(sim[1]) > 0.01 ? -sim[1] : single ? armSide * (legZ + 0.05) : 0);
  if (def.kind === 'swingarm') {
    const lo = rel(toThree(def.shockLower));
    const zs = def.shocks === 2 ? [Math.abs(shockZ(def.shockLower)) || 0.145, -(Math.abs(shockZ(def.shockLower)) || 0.145)] : [shockZ(def.shockLower)];
    for (const z of zs) {
      const from = single ? armSide * (legZ + 0.006) : Math.sign(z) * legZ;
      armParts.push(paint(bakedTube(lo.clone().setZ(from), lo.clone().setZ(z + Math.sign(z - from) * 0.012), 0.009, 0.009, 10), 'steel'));
    }
  } else {
    const s = rel(toThree(def.swingarmLink));
    const brace = u.clone().multiplyScalar(len * braceAt);
    for (const z of [-0.028, 0.028]) armParts.push(paint(platePolygon([brace.clone().setZ(z).addScaledVector(u, -0.03), brace.clone().setZ(z).addScaledVector(u, 0.03), s.clone().setZ(z)], Z, 0.008, 0.002), 'swingarm'));
    armParts.push(paint(bakedDisc(s.clone(), Z, 0.014, 0.07, 14), 'steel'));
  }
  add(arm, armParts, roles.roles.swingarm, 'swingarm');

  // Rear disc (spinning) on the right, caliper below the arm with its hanger.
  const discZ = single ? armSide * 0.082 : 0.082;
  const discR = 0.11;
  const discs = new Group();
  discs.name = 'rear-disc';
  discs.position.copy(a);
  arm.add(discs);
  add(discs, [floatingDisc({ radius: discR, band: 0.03, z: discZ })], plain, 'rear-disc');
  const cAng = -Math.PI / 2 - 0.55;
  const cal = caliper(discR, discZ, cAng).translate(a.x, a.y, 0);
  const cc = new Vector3(Math.cos(cAng) * discR, Math.sin(cAng) * discR, discZ).add(a);
  add(arm, [cal, paint(platePolygon([a.clone().setZ(discZ + Math.sign(discZ) * 0.03), cc.clone().setZ(discZ + Math.sign(discZ) * 0.03).addScaledVector(u, 0.01), cc.clone().setZ(discZ + Math.sign(discZ) * 0.03).addScaledVector(u, 0.06)], Z, 0.006, 0.002), 'steel')], plain, 'rear-caliper');

  // ---------------------------------------------------------------- shocks, linkage, chassis brackets
  const chassis: BufferGeometry[] = [];
  for (const s of [-1, 1]) chassis.push(motoPaint(bakedDisc(P.clone().setZ(s * 0.14), Z, 0.017, 0.012, 6), 'polished'));
  const top = toThree(def.shockTop);
  const springMaterials: MeshStandardMaterial[] = [];
  const shocks: { coil: CoilOver; z: number; top: Vector3 }[] = [];
  const addShock = (z: number, length: number, heavy: boolean) => {
    const coil = createCoilOver(roles.roles.damper, roles.roles.spring, length, heavy);
    group.add(coil.group);
    springMaterials.push(coil.springMaterial);
    const t = top.clone().setZ(z);
    shocks.push({ coil, z, top: t });
    chassis.push(motoPaint(bracketTab(t, Z, t.clone().add(new Vector3(0.04, 0.06, 0)), 0.018, 0.05, 0.008).translate(0, 0, Math.sign(z || 1) * 0.016), 'frame'));
    chassis.push(motoPaint(bakedTube(t.clone().setZ(z - 0.022), t.clone().setZ(z + 0.022), 0.008, 0.008, 8), 'steel'));
  };
  let rocker: Group | null = null;
  let dog: Group | null = null;
  const rest = new Map<string, Vector3>([
    ['pivot', P],
    ['axle', A],
    ['shockTop', top],
  ]);
  if (def.kind === 'swingarm') {
    const lower = toThree(def.shockLower);
    rest.set('shockLower', lower);
    const L0 = Math.hypot(top.x - lower.x, top.y - lower.y);
    if (def.shocks === 2) {
      const z = Math.abs(shockZ(def.shockLower)) || 0.145;
      addShock(z, L0, false);
      addShock(-z, L0, false);
    } else addShock(shockZ(def.shockLower), L0, true);
  } else {
    const B = toThree(def.rockerPivot);
    const S = toThree(def.swingarmLink);
    const Q = toThree(def.rockerLink);
    const C = toThree(def.rockerShock);
    for (const [k, v] of [['rockerPivot', B], ['swingarmLink', S], ['rockerLink', Q], ['rockerShock', C]] as const) rest.set(k, v);
    addShock(0, Math.hypot(top.x - C.x, top.y - C.y), true);
    // Rocker: twin triangular plates (pivot, link, shock) with bosses.
    rocker = new Group();
    rocker.name = 'rocker';
    rocker.position.copy(B);
    group.add(rocker);
    const rb = (p: Vector3) => p.clone().sub(B);
    const rp: BufferGeometry[] = [];
    for (const z of [-0.024, 0.024]) rp.push(paint(platePolygon([rb(B).setZ(z), rb(Q).setZ(z), rb(C).setZ(z)], Z, 0.008, 0.002), 'linkage'));
    for (const p of [B, Q, C]) rp.push(paint(bakedDisc(rb(p), Z, 0.017, 0.056, 16), 'linkage'), paint(bakedDisc(rb(p), Z, 0.008, 0.07, 10), 'steel'));
    add(rocker, rp, roles.roles.linkage, 'rocker');
    // Dog-bone: twin bars from the arm lug to the rocker.
    dog = new Group();
    dog.name = 'dog-bone';
    dog.position.copy(S);
    group.add(dog);
    const db: BufferGeometry[] = [];
    const q = Q.clone().sub(S);
    for (const z of [-0.042, 0.042]) {
      db.push(paint(bakedTube(new Vector3(0, 0, z), q.clone().setZ(z), 0.011, 0.011, 12), 'linkage'));
      db.push(paint(bakedDisc(new Vector3(0, 0, z), Z, 0.015, 0.01, 14), 'linkage'), paint(bakedDisc(q.clone().setZ(z), Z, 0.015, 0.01, 14), 'linkage'));
    }
    add(dog, db, roles.roles.linkage, 'dog-bone');
    for (const s of [-1, 1]) chassis.push(motoPaint(bracketTab(B.clone().setZ(s * 0.04), Z, B.clone().add(new Vector3(0.05, 0.05, s * 0.04)), 0.022, 0.06, 0.008), 'frame'));
  }

  const restArm = planarAngle(P, A);
  const restRocker = def.kind === 'swingarm-linkage' ? planarAngle(toThree(def.rockerPivot), toThree(def.rockerLink)) : 0;
  const restDog = def.kind === 'swingarm-linkage' ? planarAngle(toThree(def.swingarmLink), toThree(def.rockerLink)) : 0;
  const _lo = new Vector3();
  const _dogA = new Vector3();
  const _dogB = new Vector3();
  const inspectShocks: [Vector3, Vector3][] = shocks.map(() => [new Vector3(), new Vector3()]);

  return {
    group,
    chassis,
    meshes,
    springMaterials,
    rest,
    update(p, spin) {
      const pivot = p.get('pivot')!;
      const axle = p.get('axle')!;
      arm.position.copy(pivot);
      arm.rotation.z = planarAngle(pivot, axle) - restArm;
      discs.rotation.z = -spin;
      if (def.kind === 'swingarm') {
        const lower = p.get('shockLower')!;
        for (let i = 0; i < shocks.length; i++) {
          const s = shocks[i]!;
          _lo.set(lower.x, lower.y, s.z);
          s.coil.update(_lo, s.top);
          inspectShocks[i]![0].copy(_lo);
          inspectShocks[i]![1].copy(s.top);
        }
      } else {
        const B = rest.get('rockerPivot')!;
        const S = p.get('swingarmLink')!;
        const Q = p.get('rockerLink')!;
        const C = p.get('rockerShock')!;
        rocker!.rotation.z = planarAngle(B, Q) - restRocker;
        dog!.position.set(S.x, S.y, 0);
        dog!.rotation.z = planarAngle(S, Q) - restDog;
        _dogA.set(S.x, S.y, 0);
        _dogB.set(Q.x, Q.y, 0);
        const s = shocks[0]!;
        _lo.set(C.x, C.y, 0);
        s.coil.update(_lo, s.top);
        inspectShocks[0]![0].copy(_lo);
        inspectShocks[0]![1].copy(s.top);
      }
    },
    inspect() {
      return { dogBone: dog ? [_dogA.clone(), _dogB.clone()] : null, shocks: inspectShocks.map(([x, y]) => [x.clone(), y.clone()]) };
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const s of shocks) s.coil.dispose();
    },
  };
}
