/**
 * Front end of the `moto-planar` visual: steering assembly (yokes, clip-ons, bar-end mirrors, clocks, headlight),
 * telescopic fork (RSU with gaiters, or USD with gold stanchions) or Telelever (tubes + lower bridge + A-arm +
 * coil-over), front fender, twin floating discs and calipers.
 *
 * Space: everything is authored at REST in three.js body space. Per frame the steering group turns about the
 * steering axis by the front corner's `steer`; inside it the unsprung group follows the posed axle (Telelever: also
 * turns with the lower fork), the discs spin, and the gaiters stretch. The A-arm and its shock stay in the body.
 */
import { Group, Matrix4, Mesh, MeshPhysicalMaterial, Quaternion, Vector3, type BufferGeometry, type Material, type MeshStandardMaterial } from 'three';
import type { TeleleverFront, TelescopicFront } from '../../../contracts/suspension';
import type { MotorcycleDefinition } from '../../../contracts/vehicle';
import { paint, type PartMaterials } from '../../../kit3d/materials';
import { aArmGeometry, bracketTab } from '../../../kit3d/rigid';
import { bakedDisc, bakedSphere, bakedTube, bellowsGeometry, mergeParts, updateTube } from '../../../kit3d/tube';
import { motoPaint, type MotoFinish } from '../visual/palette';
import { basis, bentTube, lathe, roundedRect, slab, yToZ } from '../visual/shapes';
import { caliper, createCoilOver, floatingDisc, planarAngle, rotateZAbout, toThree, type CoilOver } from './common';

export interface FrontRig {
  /** Body-space parts (A-arm, Telelever shock); added to the body group. */
  readonly bodyParts: Group;
  /** Steering assembly; added to the body group. */
  readonly steering: Group;
  /** Chassis-fixed geometry (head tube, brackets), merged by the caller into the chassis mesh. */
  readonly chassis: readonly BufferGeometry[];
  /** Rest-pose points the frame drives (body space). */
  readonly rest: { readonly axle: Vector3; readonly joint: Vector3 | null; readonly shockArm: Vector3 | null };
  /**
   * Pose from body-space points: `axle` (posed wheel centre), `joint` (Telelever arm joint), the steer angle and the
   * wheel spin. No allocation.
   */
  update(axle: Vector3, joint: Vector3 | null, steer: number, spin: number): void;
  readonly meshes: readonly Mesh[];
  /** Spring materials (highlight with the 'spring' role). */
  readonly springMaterials: readonly MeshStandardMaterial[];
  /** Debug/test: current A-arm and shock mount positions in body space. */
  inspect(): { armJoint: Vector3 | null; shockArm: Vector3 | null; slider: Vector3 };
  dispose(): void;
}

const Z = new Vector3(0, 0, 1);
const _q = new Quaternion();
const _qi = new Quaternion();
const _v = new Vector3();
const _w = new Vector3();
const _a = new Vector3();
const _b = new Vector3();

/**
 * Front axle at static ride height for a fork on the steering axis (offset ahead of it), wheel centre at the
 * tyre radius: the same rest pose the definition describes.
 */
export function restFrontAxle(head: Vector3, rake: number, offset: number, axleHeight: number): Vector3 {
  const s = (head.y + offset * Math.sin(rake) - axleHeight) / Math.cos(rake);
  return new Vector3(head.x + offset * Math.cos(rake) + s * Math.sin(rake), axleHeight, 0);
}

export function buildFront(def: TelescopicFront | TeleleverFront, vehicle: MotorcycleDefinition, roles: PartMaterials, plain: Material, lens: MeshPhysicalMaterial): FrontRig {
  const tele = def.kind === 'telelever';
  const usd = def.kind === 'telescopic' && def.inverted;
  const rake = def.rake;
  const head = toThree(def.steeringHead);
  const up = new Vector3(-Math.sin(rake), Math.cos(rake), 0);
  const dn = up.clone().negate();
  const fwd = new Vector3(Math.cos(rake), Math.sin(rake), 0);
  const tyre = vehicle.front.tyre;
  const axle = restFrontAxle(head, rake, def.offset, tyre.radius);
  const fh = Math.max(0.1, tyre.width / 2 + 0.045);
  /** Point on the steering axis `d` below the head top; on a fork leg (side +1 right / -1 left). */
  const S = (d: number) => head.clone().addScaledVector(dn, d);
  const L = (d: number, side: number) => S(d).addScaledVector(fwd, def.offset).addScaledVector(Z, side * fh);
  const dAxle = _v.copy(axle).sub(head).addScaledVector(fwd, -def.offset).dot(dn);
  const travel = def.travel / Math.cos(rake);

  const meshes: Mesh[] = [];
  const geometries: BufferGeometry[] = [];
  const mesh = (parent: Group, parts: BufferGeometry[], m: Material, name: string): Mesh => {
    const g = mergeParts(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
    const o = new Mesh(g, m);
    o.name = name;
    o.castShadow = true;
    o.receiveShadow = true;
    parent.add(o);
    meshes.push(o);
    geometries.push(g);
    return o;
  };
  const cos = (g: BufferGeometry, f: MotoFinish) => motoPaint(g.index ? g.toNonIndexed() : g, f);

  // ---------------------------------------------------------------- chassis: head tube
  const chassis: BufferGeometry[] = [
    motoPaint(bakedTube(S(-0.012), S(0.172), 0.031, 0.031, 24), 'frame'),
    motoPaint(bakedTube(S(-0.02), S(-0.008), 0.034, 0.034, 24), 'steel'),
    motoPaint(bakedTube(S(0.17), S(0.182), 0.034, 0.034, 24), 'steel'),
  ];

  // ---------------------------------------------------------------- steering assembly (sprung, steered)
  const steering = new Group();
  steering.name = 'steering';
  const steer: BufferGeometry[] = [];
  const yoke = (d: number, thick: number, finish: MotoFinish) => {
    const depth = def.offset + 0.075;
    const shape = roundedRect(depth, 2 * fh + 0.085, 0.04);
    const m = basis(S(d).addScaledVector(fwd, def.offset / 2), fwd, up);
    steer.push(slab(shape, thick, 0.006, m, finish, finish === 'frame' ? 'polished' : finish, 10));
  };
  yoke(-0.032, 0.024, 'alloy');
  if (!tele) yoke(0.205, 0.032, 'frame');
  // Stem nut and bolt heads.
  steer.push(cos(bakedTube(S(-0.045), S(-0.06), 0.02, 0.02, 6), 'polished'));
  // Clip-ons below the top yoke, bars swept back and down, grips, levers, bar-end mirrors.
  for (const side of [-1, 1]) {
    const clampTop = L(-0.0, side);
    steer.push(cos(bakedTube(L(0.005, side), L(0.055, side), 0.034, 0.034, 20), 'black'));
    const root = L(0.03, side).addScaledVector(Z, side * 0.03);
    const end = root.clone().add(new Vector3(-0.13, -0.035, side * 0.22));
    steer.push(cos(bakedTube(root, end, 0.0112, 0.0112, 14), 'frame'));
    const dir = end.clone().sub(root).normalize();
    const g0 = end.clone().addScaledVector(dir, -0.125);
    steer.push(cos(bakedTube(g0, end, 0.0165, 0.0165, 16), 'grip'));
    for (let k = 1; k < 6; k++) steer.push(cos(bakedTube(g0.clone().addScaledVector(dir, k * 0.021 - 0.002), g0.clone().addScaledVector(dir, k * 0.021 + 0.002), 0.0175, 0.0175, 16), 'grip'));
    // Lever: pivot ahead of the grip, blade along it.
    const piv = g0.clone().addScaledVector(dir, -0.012).add(new Vector3(0.045, 0.01, 0));
    steer.push(cos(bakedTube(g0.clone().addScaledVector(dir, -0.02), piv, 0.009, 0.009, 10), 'black'));
    steer.push(cos(bentTube([piv, piv.clone().addScaledVector(dir, 0.06).add(new Vector3(0.012, 0, 0)), piv.clone().addScaledVector(dir, 0.15).add(new Vector3(-0.005, -0.004, 0))], 0.0052, 16, 8), 'alloy'));
    if (side > 0) {
      // Front brake master cylinder and reservoir.
      steer.push(cos(bakedTube(g0.clone().addScaledVector(dir, -0.065), g0.clone().addScaledVector(dir, -0.02), 0.016, 0.016, 14), 'black'));
      const res = g0.clone().addScaledVector(dir, -0.04).add(new Vector3(0.0, 0.05, 0));
      steer.push(cos(bakedTube(res, res.clone().add(new Vector3(0, 0.045, 0)), 0.021, 0.021, 16), 'black'));
      steer.push(cos(bakedTube(res.clone().add(new Vector3(0, 0.045, 0)), res.clone().add(new Vector3(0, 0.052, 0)), 0.023, 0.023, 16), 'polished'));
    }
    // Bar-end mirror: round head facing the rider on a short stalk.
    const stalk = end.clone().addScaledVector(dir, 0.012);
    const mc = stalk.clone().add(new Vector3(-0.02, 0.0, side * 0.055));
    steer.push(cos(bakedTube(end, stalk, 0.014, 0.014, 12), 'polished'), cos(bakedTube(stalk, mc, 0.007, 0.007, 10), 'chrome'));
    const mx = new Vector3(-1, 0, side * 0.25).normalize();
    steer.push(cos(lathe([[0, -0.016], [0.03, -0.016], [0.042, -0.006], [0.044, 0.004], [0.042, 0.008], [0, 0.008]], 32).applyMatrix4(basis(mc, Z.clone().multiplyScalar(side), mx).multiply(new Matrix4().makeRotationX(Math.PI / 2))), 'chrome'));
    steer.push(cos(bakedDisc(mc.clone().addScaledVector(mx, 0.0085), mx, 0.039, 0.002, 32), 'reflector'));
    void clampTop;
  }
  // Twin clocks on the top yoke, faces toward the rider.
  const clockFace = up.clone().multiplyScalar(0.62).add(new Vector3(-0.78, 0, 0)).normalize();
  for (const side of [-1, 1]) {
    const c = S(-0.085).addScaledVector(fwd, 0.035).addScaledVector(Z, side * 0.058);
    steer.push(cos(bakedTube(S(-0.04).addScaledVector(Z, side * 0.04), c, 0.007, 0.007, 8), 'black'));
    const back = c.clone().addScaledVector(clockFace, -0.045);
    steer.push(cos(bakedTube(back, c, 0.044, 0.046, 28), 'black'));
    steer.push(cos(bakedTube(c, c.clone().addScaledVector(clockFace, 0.01), 0.05, 0.048, 32), 'chrome'));
    steer.push(cos(bakedDisc(c.clone().addScaledVector(clockFace, 0.004), clockFace, 0.043, 0.004, 32), 'dial'));
    const needleDir = new Vector3().crossVectors(clockFace, Z).normalize().applyAxisAngle(clockFace, side * 0.8);
    const nc = c.clone().addScaledVector(clockFace, 0.0075);
    steer.push(cos(bakedTube(nc, nc.clone().addScaledVector(needleDir, 0.034), 0.0018, 0.0012, 5), 'needle'));
  }
  // Headlight: chrome bucket on black ears from the fork legs, lens + reflector + lamp.
  const hlR = 0.088;
  const hlC = S(0.12).addScaledVector(fwd, def.offset + 0.11);
  hlC.y = Math.max(hlC.y, axle.y + 0.5);
  const hl = new Matrix4().makeRotationZ(-Math.PI / 2).setPosition(hlC);
  steer.push(cos(lathe([[0.02, -0.11], [0.05, -0.1], [hlR * 0.92, -0.06], [hlR, -0.012], [hlR + 0.004, 0], [hlR + 0.004, 0.008], [hlR - 0.003, 0.01]], 48, 0.35).applyMatrix4(hl), 'chrome'));
  steer.push(cos(lathe([[0.0, -0.075], [0.03, -0.07], [hlR * 0.85, -0.03], [hlR - 0.006, 0.0]], 40, 0).applyMatrix4(hl), 'reflector'));
  steer.push(cos(bakedSphere(hlC.clone().add(new Vector3(-0.04, 0, 0)), 0.014, 12, 8), 'lamp'));
  for (const side of [-1, 1]) {
    const ear = hlC.clone().add(new Vector3(-0.05, 0, side * (hlR + 0.005)));
    steer.push(cos(bakedTube(L(0.12, side), ear.clone().add(new Vector3(-0.02, 0.0, side * 0.02)), 0.012, 0.012, 10), 'frame'));
    steer.push(cos(bakedDisc(ear.clone().add(new Vector3(0, 0, side * 0.006)), Z, 0.013, 0.012, 14), 'polished'));
  }
  const lensGeo = lathe([[0, 0.032], [hlR * 0.5, 0.026], [hlR * 0.85, 0.014], [hlR - 0.003, 0.006]], 48, 0).applyMatrix4(hl);
  const lensMesh = new Mesh(lensGeo, lens);
  lensMesh.name = 'headlight-lens';
  steering.add(lensMesh);
  geometries.push(lensGeo);
  mesh(steering, steer, plain, 'steering');

  // ---------------------------------------------------------------- fork: sprung tubes
  const fork: BufferGeometry[] = [];
  const unsprung = new Group();
  unsprung.name = 'front-unsprung';
  steering.add(unsprung);
  const lower: BufferGeometry[] = [];
  const lowerPlain: BufferGeometry[] = [];
  const gaiterAnchors: { top: Vector3; bottom: Vector3 }[] = [];
  const stanchionR = def.kind === 'telescopic' ? def.stanchionDiameter / 2 : 0.0205;
  for (const side of [-1, 1]) {
    if (usd) {
      fork.push(paint(bakedTube(L(-0.06, side), L(0.43, side), 0.0315, 0.031, 24), 'swingarm'));
      fork.push(paint(bakedTube(L(-0.068, side), L(-0.058, side), 0.026, 0.026, 6), 'fork'));
      fork.push(paint(bakedTube(L(0.425, side), L(0.437, side), 0.034, 0.034, 24), 'fork'));
      fork.push(paint(bakedTube(L(0.165, side), L(0.235, side), 0.035, 0.035, 24), 'swingarm'));
      // Gold stanchion (unsprung) and the black axle foot with radial caliper lugs.
      lower.push(paint(bakedTube(L(dAxle - 0.035, side), L(dAxle - 0.42, side), stanchionR, stanchionR, 24), 'fork'));
      lower.push(paint(bakedTube(L(dAxle + 0.04, side), L(dAxle - 0.06, side), 0.03, 0.026, 20), 'swingarm'));
    } else {
      fork.push(paint(bakedTube(L(-0.055, side), L(dAxle - 0.33, side), stanchionR, stanchionR, 24), 'chrome'));
      fork.push(paint(bakedTube(L(-0.062, side), L(-0.05, side), stanchionR + 0.004, stanchionR + 0.004, 6), 'steel'));
      lower.push(paint(bakedTube(L(dAxle + 0.045, side), L(dAxle - 0.3, side), 0.032, 0.029, 24), 'steel'));
      lower.push(paint(bakedTube(L(dAxle - 0.3, side), L(dAxle - 0.31, side), 0.026, 0.026, 24), 'rubber'));
      if (!tele) gaiterAnchors.push({ top: L(0.232, side), bottom: L(dAxle - 0.305, side) });
    }
    // Axle clamp boss.
    lower.push(paint(bakedDisc(L(dAxle, side).addScaledVector(Z, side * 0.01), Z, 0.026, 0.03, 18), usd ? 'swingarm' : 'steel'));
  }
  lower.push(paint(bakedTube(axle.clone().addScaledVector(Z, -fh - 0.03), axle.clone().addScaledVector(Z, fh + 0.03), 0.01, 0.01, 12), 'steel'));
  mesh(steering, fork, roles.roles.fork, 'fork-upper');

  // Telelever lower bridge with the ball-joint boss.
  let jointRest: Vector3 | null = null;
  let shockArmRest: Vector3 | null = null;
  const bodyParts = new Group();
  bodyParts.name = 'front-body';
  let arm: Group | null = null;
  let armPivot: Vector3 | null = null;
  let shockTop: Vector3 | null = null;
  let coil: CoilOver | null = null;
  if (def.kind === 'telelever') {
    jointRest = toThree(def.armJoint);
    shockArmRest = toThree(def.shockArm);
    armPivot = toThree(def.armPivot);
    shockTop = toThree(def.shockTop);
    const dj = _v.copy(jointRest).sub(head).addScaledVector(fwd, -def.offset).dot(dn);
    lower.push(paint(bakedTube(L(dj, -1), L(dj, 1), 0.024, 0.024, 18), 'fork'));
    lower.push(paint(bakedTube(L(dj - 0.02, -1), L(dj - 0.02, 1), 0.016, 0.016, 14), 'fork'));
    lower.push(paint(bakedSphere(jointRest, 0.028), 'fork'));
    // A-arm: two bushed chassis pivots across the frame, ball joint on the bridge, boss for the shock.
    arm = new Group();
    arm.name = 'telelever-arm';
    arm.position.copy(armPivot);
    const local = (p: Vector3) => p.clone().sub(armPivot!);
    const g = aArmGeometry(
      local(jointRest),
      local(armPivot.clone().addScaledVector(Z, -0.105)),
      local(armPivot.clone().addScaledVector(Z, 0.105)),
      local(jointRest.clone().addScaledVector(up, 0.1)),
      [local(shockArmRest)],
      { legRadius: [0.017, 0.014], bushing: { radius: 0.024, length: 0.04 }, jointRadius: 0.026, gusset: 0.35 },
      'linkage',
    );
    const am = new Mesh(g, roles.roles.linkage);
    am.name = 'telelever-arm';
    am.castShadow = am.receiveShadow = true;
    arm.add(am);
    meshes.push(am);
    geometries.push(g);
    bodyParts.add(arm);
    for (const side of [-1, 1]) chassis.push(motoPaint(bracketTab(armPivot.clone().addScaledVector(Z, side * 0.135), Z, armPivot.clone().add(new Vector3(-0.05, 0.05, side * 0.135)), 0.026, 0.07, 0.008), 'frame'));
    chassis.push(motoPaint(bracketTab(shockTop, Z, shockTop.clone().add(new Vector3(0.05, 0.06, 0)), 0.02, 0.06, 0.03), 'frame'));
    coil = createCoilOver(roles.roles.damper, roles.roles.spring, shockTop.distanceTo(shockArmRest), true);
    bodyParts.add(coil.group);
  }
  mesh(unsprung, lower, roles.roles.fork, 'fork-lower');

  // ---------------------------------------------------------------- unsprung cosmetics: fender, calipers; discs
  const fenderR = tyre.radius + 0.028;
  const fenderW = tyre.width / 2 + 0.018;
  const fprof: [number, number][] = [];
  for (let i = 0; i <= 10; i++) {
    const h = -fenderW + (2 * fenderW * i) / 10;
    fprof.push([fenderR + 0.012 * (1 - (h / fenderW) ** 2), h]);
  }
  for (let i = 10; i >= 0; i--) {
    const h = -fenderW + (2 * fenderW * i) / 10;
    fprof.push([fenderR + 0.012 * (1 - (h / fenderW) ** 2) - 0.003, h * 0.985]);
  }
  fprof.push(fprof[0]!);
  // Arc from just ahead of the top to behind the fork: lathe angle phi maps to (phi - pi/2) about +Z after yToZ.
  const a0 = Math.PI * 0.27;
  const a1 = Math.PI * 0.86;
  const fender = yToZ(lathe(fprof, 40, 0.5, a0 + Math.PI / 2, a1 - a0));
  const fenderParts: BufferGeometry[] = [cos(fender.translate(axle.x, axle.y, 0), 'polished')];
  for (const side of [-1, 1]) {
    const s0 = axle.clone().add(new Vector3(0.0, 0.0, side * (fh - 0.02)));
    fenderParts.push(cos(bentTube([L(dAxle - 0.14, side).addScaledVector(Z, -side * 0.02), s0.clone().add(new Vector3(0.12, fenderR - 0.06, -side * 0.01)), s0.clone().add(new Vector3(0.2, fenderR * 0.72, -side * 0.035))], 0.006, 20, 8), 'polished'));
  }
  mesh(unsprung, fenderParts, plain, 'fender');
  const discR = 0.155;
  const discZ = fh - 0.034;
  const calipers: BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    // Caliper trailing the fork leg, bolted to the slider (radial on USD, axial lugs otherwise).
    const ang = Math.PI - 0.32 + (usd ? 0.05 : 0);
    const c = caliper(discR, side * discZ, ang).translate(axle.x, axle.y, 0);
    calipers.push(c);
    const cc = new Vector3(Math.cos(ang) * discR, Math.sin(ang) * discR, side * discZ).add(axle);
    calipers.push(paint(bakedTube(cc.clone().add(new Vector3(0.0, 0.0, side * 0.018)), L(dAxle - 0.03, side), 0.01, 0.012, 10), 'steel'));
  }
  mesh(unsprung, calipers, roles.plain, 'front-calipers');
  const discs = new Group();
  discs.name = 'front-discs';
  discs.position.copy(axle);
  unsprung.add(discs);
  mesh(discs, [floatingDisc({ radius: discR, band: 0.034, z: discZ }), floatingDisc({ radius: discR, band: 0.034, z: -discZ })], roles.plain, 'front-discs');

  // ---------------------------------------------------------------- gaiters (RSU only): stretch per frame
  const gaiterGeo = paint(bellowsGeometry(0.034, 0.03, 9, 0.006, 20), 'rubber');
  const gaiters = gaiterAnchors.map((a, i) => {
    const o = new Mesh(gaiterGeo, roles.roles.fork);
    o.name = `gaiter-${i}`;
    o.castShadow = o.receiveShadow = true;
    steering.add(o);
    meshes.push(o);
    return { o, ...a };
  });
  if (gaiters.length) geometries.push(gaiterGeo);
  else gaiterGeo.dispose();

  const axisUp = up.clone();
  const sliderTop = L(dAxle - 0.3, 1);
  const _slider = new Vector3();
  const _joint = new Vector3();
  const _shock = new Vector3();
  const springMaterials = coil ? [coil.springMaterial] : [];
  const lowerRestAngle = jointRest ? planarAngle(axle, jointRest) : 0;
  const armRestAngle = jointRest && armPivot ? planarAngle(armPivot, jointRest) : 0;
  let armAngle = 0;

  return {
    bodyParts,
    steering,
    chassis,
    rest: { axle, joint: jointRest, shockArm: shockArmRest },
    meshes,
    springMaterials,
    update(posedAxle, posedJoint, steerAngle, spin) {
      // Steering: rotation about the steering axis through the head.
      _q.setFromAxisAngle(axisUp, steerAngle);
      steering.quaternion.copy(_q);
      steering.position.copy(head).applyQuaternion(_q).negate().add(head);
      // Un-steer the posed axle (and joint) into the steering group's rest frame.
      _qi.copy(_q).invert();
      _a.copy(posedAxle).sub(head).applyQuaternion(_qi).add(head);
      if (jointRest && posedJoint && armPivot) {
        // Telelever: the lower fork turns so it points from the axle to the arm joint.
        _b.copy(posedJoint).sub(head).applyQuaternion(_qi).add(head);
        const phi = planarAngle(_a, _b) - lowerRestAngle;
        unsprung.rotation.z = phi;
        _w.copy(axle);
        rotateZAbout(_w, _v.set(0, 0, 0), phi);
        unsprung.position.subVectors(_a, _w);
        // The A-arm (body space) turns about its chassis pivot to the posed joint.
        armAngle = planarAngle(armPivot, posedJoint) - armRestAngle;
        arm!.rotation.z = armAngle;
        _shock.copy(shockArmRest!);
        rotateZAbout(_shock, armPivot, armAngle);
        coil!.update(_shock, shockTop!);
        _joint.copy(posedJoint);
      } else {
        unsprung.position.subVectors(_a, axle);
      }
      discs.rotation.z = -spin;
      for (let i = 0; i < gaiters.length; i++) {
        const g = gaiters[i]!;
        _w.copy(g.bottom);
        if (unsprung.rotation.z !== 0) rotateZAbout(_w, _v.set(0, 0, 0), unsprung.rotation.z);
        _w.add(unsprung.position);
        updateTube(g.o, _w, g.top, 1);
      }
      _slider.copy(sliderTop).add(unsprung.position);
    },
    inspect() {
      return { armJoint: jointRest ? _joint.clone() : null, shockArm: shockArmRest ? _shock.clone() : null, slider: _slider.clone() };
    },
    dispose() {
      for (const g of geometries) g.dispose();
      coil?.dispose();
    },
  };
}
