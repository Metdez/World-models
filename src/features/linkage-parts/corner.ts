/**
 * One car corner of the `spatial-linkage` visual. Every part is built ONCE from the corner's rest (design)
 * points in three.js vehicle coordinates; per frame `update` only sets transforms from the current hardpoints:
 * rigid 3-point frames (upright, A-arms, chassis), swing rotations (single rods, drop link), the two damper
 * halves along the mount axis, the spring's length uniform, the anti-roll-bar arm angle and the gaiter stretch.
 * Each rigid body is ONE painted mesh (palette materials, §18 draw-call budget). No allocation in `update`.
 */
import { Group, Matrix4, Mesh, Object3D, Quaternion, Vector3, type BufferGeometry, type Material } from 'three';
import type { ComponentRole, PointName } from '../../contracts/suspension';
import { brakeDiscGeometry, caliperGeometry, hubGeometry } from '../../kit3d/brake';
import { createDamper, type Damper, type DamperDims } from '../../kit3d/damper';
import { lobedHull, type Pad } from '../../kit3d/hull';
import { paint, type PartMaterials } from '../../kit3d/materials';
import { aArmGeometry, bracketTab, bushingParts, frameFrom3, restInverse, setRigid, setSwing } from '../../kit3d/rigid';
import { makeSpringMaterial, springGeometry, updateSpring, type CoilSpec } from '../../kit3d/spring';
import { bakedDisc, bakedSphere, bakedTube, mergeParts, updateTube } from '../../kit3d/tube';
import { SPRING_LOWER, WHEEL_CENTRE, type CornerLayout } from './layout';

/** Maximum spring-length change from design over the kinematic table's travel range (|motion ratio| <= 1). */
export const SPRING_TRAVEL = 0.095;
/** Anti-roll-bar sizes; the drop-link lean and arm direction are chosen per corner by clearance (see below). */
export const ARB = { arm: 0.2, drop: 0.14, radius: 0.0115, link: 0.0055 } as const;
const RIM_CLEAR = { ring: 0.01, hatDepth: 0.04 } as const;

export interface SharedGeometry {
  /** Painted unit-height rack gaiter (bellows), stretched per frame. */
  readonly gaiter: BufferGeometry;
}

export interface Capsule {
  readonly name: string;
  readonly a: Vector3;
  readonly b: Vector3;
  readonly r: number;
  readonly joints: readonly PointName[];
}

export interface CornerVisual {
  readonly group: Group;
  /** Chassis-fixed parts (painted, rest coordinates): the visual merges all corners' into one mesh. */
  readonly chassisParts: readonly BufferGeometry[];
  /** Current chassis transform (rest -> world), updated by `update`. */
  readonly chassis: Matrix4;
  readonly materials: PartMaterials;
  /** Rest-pose rack housing end (steered corners) and anti-roll-bar torso point, for the axle statics. */
  readonly rackEnd?: Vector3;
  readonly arbTorso?: Vector3;
  /** Current points in three.js world coordinates, ordered as `layout.names`. */
  update(points: readonly Vector3[], spin: number): void;
  /** Debug/test: capsules of the parts at the last update, world coordinates. */
  capsules(): Capsule[];
  /** Debug/test: wheel centre and outward axle at the last update. */
  wheel(): { centre: Vector3; axis: Vector3 };
  dispose(): void;
}

export interface CornerOptions {
  readonly layout: CornerLayout;
  readonly rest: ReadonlyMap<PointName, Vector3>;
  /** +1 left, -1 right. */
  readonly side: 1 | -1;
  /** Static camber and toe (rad) for the hub axis at rest. */
  readonly camber: number;
  readonly toe: number;
  readonly materials: PartMaterials;
  readonly shared: SharedGeometry;
}

const UP = new Vector3(0, 1, 0);
const FWD = new Vector3(1, 0, 0);

// Per-frame scratch (shared by all corners; update is synchronous).
const _m = new Matrix4();
const _q = new Quaternion();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _d = new Vector3();
const _k = new Vector3();
const _n = new Vector3();

function mesh(g: BufferGeometry, m: Material, parent: Object3D): Mesh {
  const o = new Mesh(g, m);
  o.castShadow = true;
  o.receiveShadow = true;
  parent.add(o);
  return o;
}

function rigidGroup(parent: Object3D): Group {
  const g = new Group();
  g.matrixAutoUpdate = false;
  parent.add(g);
  return g;
}

export function buildCorner(o: CornerOptions): CornerVisual {
  const { layout, rest, side, materials: mats, shared } = o;
  const R = (n: PointName) => {
    const p = rest.get(n);
    if (!p) throw new Error(`linkage-parts: no rest point "${n}"`);
    return p;
  };
  const index = new Map(layout.names.map((n, i) => [n, i]));
  const at = (n: PointName) => index.get(n)!;
  const roles = mats.roles;
  const owned: BufferGeometry[] = [];
  const own = (g: BufferGeometry) => {
    owned.push(g);
    return g;
  };
  const group = new Group();
  group.name = 'corner';

  // ---------------------------------------------------------------- hub axis and upright
  const W = R(WHEEL_CENTRE);
  // Outward axle in sim terms, as sim-core's spatial.ts axle0 (negative camber tilts the top inboard):
  // (sin toe cos camber, side cos toe cos camber, -sin camber) -> three (x, z, -y).
  const simAxle = [Math.sin(o.toe) * Math.cos(o.camber), side * Math.cos(o.toe) * Math.cos(o.camber), -Math.sin(o.camber)] as const;
  const axle = new Vector3(simAxle[0], simAxle[2], -simAxle[1]).normalize();
  const ringCentre = W.clone().addScaledVector(axle, RIM_CLEAR.ring);
  const discSpec = { outerRadius: 0.17, innerRadius: 0.1, thickness: 0.028, hatDepth: RIM_CLEAR.hatDepth, holes: 18, holeRadius: 0.0042 };
  const caliperSpec = { innerRadius: 0.122, outerRadius: 0.196, halfSpan: 0.42, width: 0.074, discThickness: discSpec.thickness, discRadius: discSpec.outerRadius };
  // Caliper ahead of the axle, slightly raised, in the wheel plane.
  const calDir = FWD.clone().multiplyScalar(Math.cos(0.25)).addScaledVector(UP, Math.sin(0.25));
  calDir.addScaledVector(axle, -calDir.dot(axle)).normalize();
  const calSide = new Vector3().crossVectors(calDir, axle);
  const calBasis = new Matrix4().makeBasis(calDir, axle, calSide).setPosition(ringCentre);

  const strutPoint = layout.damper.strut ? R(SPRING_LOWER) : undefined;
  const restDamperDir = new Vector3().subVectors(R(layout.damper.upper), R(SPRING_LOWER)).normalize();
  const padRadius = new Map<PointName, number>();
  for (const a of layout.arms) padRadius.set(a.joint, 0.03);
  for (const r of layout.rods) if (!padRadius.has(r.outer)) padRadius.set(r.outer, 0.023);
  const core: Pad[] = [
    { p: W.clone().addScaledVector(axle, -0.06), r: 0.052 },
    { p: W.clone().addScaledVector(axle, -0.1), r: 0.046 },
  ];
  const lobes: Pad[][] = [];
  for (const n of layout.uprightPoints) {
    if (n === WHEEL_CENTRE) continue;
    const p = R(n);
    if (strutPoint && p.distanceTo(strutPoint) < 1e-9) {
      // Strut clamp: a collar around the bottom of the strut body.
      lobes.push([
        { p, r: 0.036 },
        { p: p.clone().addScaledVector(restDamperDir, -0.065), r: 0.036 },
      ]);
    } else {
      // A bone, not a spike: a mid pad keeps the section thick toward the joint.
      lobes.push([
        { p, r: padRadius.get(n) ?? 0.02 },
        { p: new Vector3().lerpVectors(core[0]!.p, p, 0.55), r: 0.034 },
      ]);
    }
  }
  // Caliper mounting ear: both lugs in one lobe, inboard of the caliper.
  lobes.push(
    [-1, 1].map((sgn) => {
      const ang = sgn * caliperSpec.halfSpan * 0.75;
      const radial = calDir.clone().multiplyScalar(Math.cos(ang)).addScaledVector(calSide, Math.sin(ang)).multiplyScalar(0.14);
      return { p: ringCentre.clone().add(radial).addScaledVector(axle, -0.042), r: 0.013 };
    }),
  );
  const upright = rigidGroup(group);
  upright.name = 'upright';
  mesh(own(mergeParts([paint(lobedHull(core, lobes), 'upright'), paint(caliperGeometry(caliperSpec).applyMatrix4(calBasis), 'caliper')])), roles.upright, upright);
  const spinPivot = new Object3D();
  spinPivot.position.copy(ringCentre);
  const qAlign = new Quaternion().setFromUnitVectors(UP, axle);
  spinPivot.quaternion.copy(qAlign);
  upright.add(spinPivot);
  mesh(own(mergeParts([paint(brakeDiscGeometry(discSpec), 'disc'), paint(hubGeometry(discSpec.hatDepth, 0.074, 0.057), 'steel')])), mats.plain, spinPivot);
  // Rolling forward is a rotation about the vehicle's LEFT axis on both sides.
  const spinAxis = axle.clone().multiplyScalar(side);
  const [u0, u1, u2] = layout.uprightFrame.map(R) as [Vector3, Vector3, Vector3];
  const uprightInv = restInverse(u0, u1, u2);
  const uIdx = layout.uprightFrame.map(at) as [number, number, number];

  // ---------------------------------------------------------------- chassis brackets and top mount
  // Chassis-fixed parts are returned as geometry: the visual merges every corner's into ONE body mesh.
  const chassis = new Matrix4();
  const chassisParts: BufferGeometry[] = [];
  const [c0, c1, c2] = layout.chassisFrame.map(R) as [Vector3, Vector3, Vector3];
  const chassisInv = restInverse(c0, c1, c2);
  const cIdx = layout.chassisFrame.map(at) as [number, number, number];
  const brackets: BufferGeometry[] = [];
  for (const a of layout.arms) {
    const axis = new Vector3().subVectors(R(a.rear), R(a.front)).normalize();
    const len = a.role === 'upper-arm' ? 0.04 : 0.05;
    for (const p of [R(a.front), R(a.rear)])
      for (const s of [-1, 1]) brackets.push(bracketTab(p.clone().addScaledVector(axis, s * (len / 2 + 0.007)), axis, new Vector3(p.x, p.y, 0), 0.028, 0.07, 0.006));
  }
  const mountR = layout.damper.strut ? 0.075 : 0.034;
  brackets.push(bakedDisc(R(layout.damper.upper).clone().addScaledVector(restDamperDir, 0.012), restDamperDir, mountR, 0.008));
  for (const g of brackets) chassisParts.push(paint(g, 'steel'));
  chassisParts.push(paint(bakedDisc(R(layout.damper.upper).clone().addScaledVector(restDamperDir, -0.004), restDamperDir, mountR * 0.62, 0.026), 'rubber'));

  // ---------------------------------------------------------------- A-arms
  const arms = layout.arms.map((a) => {
    const upper = a.role === 'upper-arm';
    const g = aArmGeometry(
      R(a.joint),
      R(a.front),
      R(a.rear),
      W,
      a.extras.map(R),
      upper
        ? { legRadius: [0.011, 0.014], bushing: { radius: 0.022, length: 0.04 }, jointRadius: 0.021, gusset: 0.3 }
        : { legRadius: [0.013, 0.017], bushing: { radius: 0.026, length: 0.05 }, jointRadius: 0.025, gusset: 0.32 },
      a.role,
    );
    const obj = mesh(own(g), roles[a.role], group);
    obj.matrixAutoUpdate = false;
    obj.name = a.member;
    return { obj, inv: restInverse(R(a.joint), R(a.front), R(a.rear)), idx: [at(a.joint), at(a.front), at(a.rear)] as const, layout: a, legR: upper ? 0.014 : 0.017 };
  });

  // ---------------------------------------------------------------- single rods (links, tie rod / toe link)
  const rods = layout.rods.map((r) => {
    const inner = R(r.inner);
    const outer = R(r.outer);
    const dir = new Vector3().subVectors(outer, inner).normalize();
    const tie = r.role === 'tie-rod';
    const radius = tie ? 0.0095 : 0.0115;
    const body: BufferGeometry[] = [];
    const rubber: BufferGeometry[] = [];
    const steel: BufferGeometry[] = [];
    let start = inner;
    if (r.steered) {
      // Inner ball joint on the rack end (under the gaiter).
      steel.push(bakedSphere(inner, 0.015));
      start = inner.clone().addScaledVector(dir, 0.012);
    } else {
      const eyeAxis = new Vector3().crossVectors(dir, UP);
      if (eyeAxis.lengthSq() < 1e-6) eyeAxis.set(1, 0, 0);
      eyeAxis.normalize();
      const b = bushingParts(inner, eyeAxis, { radius: 0.021, length: 0.036 });
      body.push(b.eye);
      rubber.push(b.rubber);
      steel.push(b.sleeve);
      start = inner.clone().addScaledVector(dir, 0.016);
      // Chassis bracket cheeks either side of the eye.
      for (const s of [-1, 1]) chassisParts.push(paint(bracketTab(inner.clone().addScaledVector(eyeAxis, s * 0.025), eyeAxis, new Vector3(inner.x, inner.y, 0), 0.024, 0.06, 0.006), 'steel'));
    }
    const collarStart = outer.clone().addScaledVector(dir, -0.045);
    body.push(bakedTube(start, collarStart, radius));
    body.push(bakedTube(collarStart, outer.clone().addScaledVector(dir, -0.012), radius * 1.75, radius * 1.9));
    steel.push(bakedSphere(outer, 0.013));
    rubber.push(bakedTube(outer.clone().addScaledVector(dir, -0.016), outer.clone().addScaledVector(dir, 0.004), radius * 1.9, 0.012));
    if (tie) {
      // Length adjuster sleeve and lock nut.
      const s0 = new Vector3().lerpVectors(inner, outer, 0.58);
      const s1 = new Vector3().lerpVectors(inner, outer, 0.76);
      body.push(bakedTube(s0, s1, radius * 1.45, radius * 1.45, 6));
      steel.push(bakedTube(s1, s1.clone().addScaledVector(dir, 0.012), radius * 1.6, radius * 1.6, 6));
    }
    for (const n of r.extras) {
      const p = R(n);
      if (n === SPRING_LOWER) {
        // Clevis for the damper eye.
        const across = new Vector3().crossVectors(dir, restDamperDir).normalize();
        body.push(bakedDisc(p, across, 0.022, 0.05), bakedTube(p, p.clone().addScaledVector(restDamperDir, -0.02), 0.02));
      } else {
        body.push(bakedSphere(p, radius * 1.7));
      }
    }
    const obj = mesh(own(mergeParts([...body.map((g) => paint(g, r.role)), ...rubber.map((g) => paint(g, 'rubber')), ...steel.map((g) => paint(g, 'steel'))])), roles[r.role], group);
    obj.matrixAutoUpdate = false;
    obj.name = r.member;
    return { obj, inner: inner.clone(), dir, idx: [at(r.inner), at(r.outer)] as const, layout: r, radius };
  });

  // ---------------------------------------------------------------- damper / strut + coil spring
  const top = R(layout.damper.upper);
  const low = R(SPRING_LOWER);
  const L0 = top.distanceTo(low);
  const strut = layout.damper.strut;
  // Spring-length change bound: travel range x lever ratio of the lower mount (an upper bound of the motion ratio).
  const travel = SPRING_TRAVEL * Math.min(1, leverRatio(layout, R) * 1.1) + 0.005;
  const coilR = strut ? 0.058 : 0.04;
  const wireR = strut ? 0.0072 : 0.0064;
  const seatLow = strut ? 0.1 : 0.06;
  const seatRadius = coilR + wireR + 0.0035;
  // Upper seat on the rod, below every arm, link or upright neck that passes the coil near the top (rest pose,
  // 50 mm margin for their motion): the rod then runs bare through the arm, as on a real coil-over.
  const obstacles: { a: Vector3; b: Vector3; r: number }[] = [];
  for (const a of layout.arms) if (!a.extras.includes(SPRING_LOWER)) for (const c of [a.front, a.rear]) obstacles.push({ a: R(a.joint), b: R(c), r: 0.017 });
  for (const r of layout.rods) if (!r.extras.includes(SPRING_LOWER)) obstacles.push({ a: R(r.inner), b: R(r.outer), r: 0.02 });
  if (!strut) for (const n of layout.uprightPoints) if (n !== WHEEL_CENTRE) obstacles.push({ a: core[0]!.p, b: R(n), r: padRadius.get(n) ?? 0.02 });
  const seatHigh = upperSeatOffset(top, low, L0 - seatLow - 0.12, obstacles, coilR + wireR + 0.05);
  if (strut) for (const n of layout.uprightPoints) if (n !== WHEEL_CENTRE) obstacles.push({ a: core[0]!.p, b: R(n), r: padRadius.get(n) ?? 0.02 });
  const bodyBelow = strut ? 0.065 : 0;
  // Body top stays under the upper seat at full bump; the rod stays inside the body at full droop.
  const bodyLength = Math.max(L0 - travel - seatHigh - 0.02, 2 * travel + 0.03 - bodyBelow);
  const dims: DamperDims = {
    bodyLength,
    bodyBelow,
    bodyRadius: strut ? 0.029 : 0.024,
    rodLength: L0 + travel + 0.03 - bodyLength,
    rodRadius: strut ? 0.011 : 0.0085,
    eyeRadius: strut ? 0 : 0.017,
    seats: { low: seatLow, high: seatHigh, radius: seatRadius },
  };
  const damperRole: ComponentRole = strut ? 'strut' : 'damper';
  const damper: Damper = createDamper(roles[damperRole], damperRole, dims);
  for (const c of damper.group.children) owned.push((c as Mesh).geometry);
  group.add(damper.group);
  const S0 = L0 - seatLow - seatHigh;
  const coil: CoilSpec = {
    turns: Math.max(4.5, Math.round((S0 / 0.045) * 2) / 2 + 1.5),
    dead: 0.85,
    coilRadius: coilR,
    wireRadius: wireR,
    restLength: S0,
    maxLength: S0 + travel,
  };
  const springMat = roles.spring;
  const { uniforms, depth } = makeSpringMaterial(springMat, coil);
  const spring = new Mesh(own(springGeometry(coil)), springMat);
  spring.customDepthMaterial = depth;
  spring.castShadow = true;
  group.add(spring);
  const iLow = at(SPRING_LOWER);
  const iTop = at(layout.damper.upper);

  // ---------------------------------------------------------------- steering rack gaiter
  let rack: { gaiter: Mesh; H: Vector3; idx: number } | undefined;
  let rackEnd: Vector3 | undefined;
  const steered = layout.rods.find((r) => r.steered);
  if (steered) {
    const inner = R(steered.inner);
    rackEnd = new Vector3(inner.x, inner.y, inner.z - Math.sign(inner.z) * 0.1);
    const gaiter = new Mesh(shared.gaiter, mats.plain);
    gaiter.castShadow = true;
    group.add(gaiter);
    rack = { gaiter, H: rackEnd.clone(), idx: at(steered.inner) };
    obstacles.push({ a: rackEnd, b: inner, r: 0.025 });
  }

  // ---------------------------------------------------------------- anti-roll bar arm + drop link
  let arb:
    | { obj: Mesh; link: Mesh; C: Vector3; K: Vector3; a0: Vector3; armLen: number; drop: number; P0: Vector3; linkDir: Vector3; idx: number; end: Vector3 }
    | undefined;
  let arbTorso: Vector3 | undefined;
  if (layout.antiRollBar) {
    const P = R(layout.antiRollBar.pickup);
    // Placement rule: drop link up (or leaning fore/aft), arm fore or aft, whichever clears the other parts
    // (incl. the spring, the upright and a tyre envelope) best at rest. Symmetric data -> symmetric choice.
    const carrier = [...layout.arms, ...layout.rods].find((m) => m.extras.includes(layout.antiRollBar!.pickup));
    const avoid: { a: Vector3; b: Vector3; r: number; moves: boolean }[] = obstacles
      .filter((ob) => !carrier || (ob.a.distanceTo(P) > 1e-9 && ob.b.distanceTo(P) > 1e-9 && pointSegment(P, ob.a, ob.b) > 1e-6))
      .map((ob) => ({ ...ob, moves: true }));
    // The coil-over's lower end rides on the same member as the pickup when that member carries the spring.
    const springMoves = !carrier?.extras.includes(SPRING_LOWER);
    const lowerSeatRest = low.clone().addScaledVector(restDamperDir, seatLow);
    const upperSeatRest = top.clone().addScaledVector(restDamperDir, -seatHigh);
    avoid.push({ a: low.clone().addScaledVector(restDamperDir, -bodyBelow), b: low.clone().addScaledVector(restDamperDir, bodyLength), r: dims.bodyRadius, moves: springMoves });
    avoid.push({ a: lowerSeatRest, b: upperSeatRest, r: coilR + wireR, moves: springMoves });
    avoid.push({ a: lowerSeatRest.clone().addScaledVector(restDamperDir, -0.03), b: lowerSeatRest.clone().addScaledVector(restDamperDir, 0.004), r: seatRadius, moves: springMoves });
    let best = { score: -Infinity, E0: P, C: P };
    const inboard = -Math.sign(P.z);
    // Tyre envelope at rest and, on a steered axle, near full lock both ways.
    const tyreAxes = layout.steer ? [-0.4, 0, 0.4].map((a) => axle.clone().applyAxisAngle(UP, a)) : [axle];
    const shift = [new Vector3(0, -0.05, 0), new Vector3(), new Vector3(0, 0.05, 0)];
    const sa = new Vector3();
    const sb = new Vector3();
    for (const lean of [
      [0, 0],
      [0.5, 0],
      [-0.5, 0],
      [0, 0.6],
      [0.4, 0.5],
      [-0.4, 0.5],
      [0, 1],
      [0.5, 1],
      [-0.5, 1],
      [0, 1.6],
    ] as const)
      for (const armSign of [1, -1]) {
        const E0 = P.clone().addScaledVector(new Vector3(lean[0], 1, inboard * lean[1]).normalize(), ARB.drop);
        const C = E0.clone().addScaledVector(FWD, armSign * ARB.arm);
        const segs = [
          { a: P, b: E0, r: 0.0105 },
          { a: E0, b: C, r: ARB.radius },
          { a: C, b: new Vector3(C.x, C.y, 0), r: ARB.radius },
        ];
        let score = Infinity;
        for (const sg of segs) {
          // Moving parts are also checked +-50 mm vertically (bump/droop envelope).
          for (const ob of avoid)
            for (const d of ob.moves ? shift : shift.slice(1, 2)) score = Math.min(score, segmentGap(sg.a, sg.b, sa.addVectors(ob.a, d), sb.addVectors(ob.b, d)) - sg.r - ob.r);
          for (const ax of tyreAxes) score = Math.min(score, tyreGap(sg.a, sg.b, W, ax) - sg.r - 0.02);
        }
        score = Math.round(score * 1e4) / 1e4;
        if (score > best.score) best = { score, E0, C };
      }
    const { E0, C } = best;
    arbTorso = C.clone();
    const K = new Vector3(0, 0, 1);
    const obj = mesh(own(mergeParts([bakedTube(C, E0, ARB.radius), bakedSphere(C, ARB.radius), bakedDisc(E0, K, ARB.radius * 1.5, 0.02)].map((g) => paint(g, 'anti-roll-bar')))), roles['anti-roll-bar'], group);
    obj.matrixAutoUpdate = false;
    obj.name = 'anti-roll-bar-arm';
    // Drop link: a rigid rod (its length never changes) with ball joints, swung about the pickup.
    const linkDir = new Vector3().subVectors(E0, P).normalize();
    const link = mesh(
      own(mergeParts([paint(bakedTube(P, E0, ARB.link), 'anti-roll-bar'), paint(bakedSphere(P, 0.0105), 'steel'), paint(bakedSphere(E0, 0.0105), 'steel')])),
      roles['anti-roll-bar'],
      group,
    );
    link.matrixAutoUpdate = false;
    link.name = 'anti-roll-bar-link';
    const a0 = new Vector3().subVectors(E0, C);
    arb = { obj, link, C, K, a0, armLen: a0.length(), drop: E0.distanceTo(P), P0: P.clone(), linkDir, idx: at(layout.antiRollBar.pickup), end: new Vector3() };
  }

  // ---------------------------------------------------------------- per-frame state (for update and debug)
  let P: readonly Vector3[] = [];
  const lowerSeat = new Vector3();
  const upperSeat = new Vector3();
  const damperDir = new Vector3();

  return {
    group,
    chassisParts,
    chassis,
    materials: mats,
    ...(rackEnd ? { rackEnd } : {}),
    ...(arbTorso ? { arbTorso } : {}),
    update(points, spin) {
      P = points;
      setRigid(upright, uprightInv, points[uIdx[0]]!, points[uIdx[1]]!, points[uIdx[2]]!);
      _q.setFromAxisAngle(spinAxis, spin);
      spinPivot.quaternion.multiplyQuaternions(_q, qAlign);
      frameFrom3(points[cIdx[0]]!, points[cIdx[1]]!, points[cIdx[2]]!, chassis).multiply(chassisInv);
      for (const a of arms) setRigid(a.obj, a.inv, points[a.idx[0]]!, points[a.idx[1]]!, points[a.idx[2]]!);
      for (const r of rods) setSwing(r.obj, r.inner, r.dir, points[r.idx[0]]!, points[r.idx[1]]!);

      const lo = points[iLow]!;
      const high = points[iTop]!;
      damper.update(lo, high);
      damperDir.subVectors(high, lo).normalize();
      lowerSeat.copy(lo).addScaledVector(damperDir, seatLow);
      upperSeat.copy(high).addScaledVector(damperDir, -seatHigh);
      updateSpring(spring, uniforms, coil, lowerSeat, upperSeat);

      if (arb) {
        // Arm angle about the torso axis that keeps the drop link at its length (circle-sphere intersection).
        const M = chassis;
        _c.copy(arb.C).applyMatrix4(M);
        _k.copy(arb.K).transformDirection(M);
        _a.copy(arb.a0).transformDirection(M).multiplyScalar(arb.armLen);
        _b.crossVectors(_k, _a);
        const pick = points[arb.idx]!;
        _d.subVectors(_c, pick);
        const A = _d.dot(_a);
        const B = _d.dot(_b);
        const rho = Math.hypot(A, B);
        const cosArg = rho > 1e-9 ? (arb.drop * arb.drop - _d.lengthSq() - arb.armLen * arb.armLen) / (2 * rho) : 1;
        const phi = Math.atan2(B, A);
        const delta = Math.acos(cosArg > 1 ? 1 : cosArg < -1 ? -1 : cosArg);
        const t1 = Math.atan2(Math.sin(phi + delta), Math.cos(phi + delta));
        const t2 = Math.atan2(Math.sin(phi - delta), Math.cos(phi - delta));
        const theta = Math.abs(t1) < Math.abs(t2) ? t1 : t2;
        _m.makeRotationAxis(arb.K, theta);
        _n.copy(arb.C).applyMatrix4(_m);
        _m.setPosition(arb.C.x - _n.x, arb.C.y - _n.y, arb.C.z - _n.z);
        arb.obj.matrix.multiplyMatrices(M, _m);
        arb.obj.matrixWorldNeedsUpdate = true;
        arb.end.copy(_c).addScaledVector(_a, Math.cos(theta)).addScaledVector(_b, Math.sin(theta));
        setSwing(arb.link, arb.P0, arb.linkDir, pick, arb.end);
      }
      if (rack) {
        _a.copy(rack.H).applyMatrix4(chassis);
        updateTube(rack.gaiter, _a, points[rack.idx]!, 1);
      }
    },
    capsules() {
      const out: Capsule[] = [];
      if (P.length === 0) return out;
      const v = (i: number) => P[i]!.clone();
      for (const a of arms) {
        const j = [a.layout.joint, a.layout.front, a.layout.rear, ...a.layout.extras];
        out.push({ name: `${a.layout.member}.front`, a: v(a.idx[0]), b: v(a.idx[1]), r: a.legR, joints: j });
        out.push({ name: `${a.layout.member}.rear`, a: v(a.idx[0]), b: v(a.idx[2]), r: a.legR, joints: j });
      }
      for (const r of rods) out.push({ name: r.layout.member, a: v(r.idx[0]), b: v(r.idx[1]), r: r.radius, joints: [r.layout.inner, r.layout.outer, ...r.layout.extras] });
      const dj = [SPRING_LOWER, layout.damper.upper, ...(strut ? layout.uprightPoints : [])];
      const lo = P[iLow]!;
      out.push({ name: 'damper', a: lo.clone().addScaledVector(damperDir, -dims.bodyBelow), b: lo.clone().addScaledVector(damperDir, dims.bodyLength), r: dims.bodyRadius, joints: dj });
      out.push({ name: 'spring', a: lowerSeat.clone(), b: upperSeat.clone(), r: coilR + wireR, joints: dj });
      const hi = P[iTop]!;
      out.push({ name: 'rod', a: hi.clone().addScaledVector(damperDir, -dims.rodLength), b: hi.clone(), r: dims.rodRadius, joints: dj });
      const seatR = dims.seats!.radius;
      for (const [name, c] of [['seat.low', lowerSeat], ['seat.high', upperSeat]] as const)
        out.push({ name, a: c.clone().addScaledVector(damperDir, -0.004), b: c.clone().addScaledVector(damperDir, 0.004), r: seatR, joints: dj });
      const hub = core[0]!.p.clone().applyMatrix4(upright.matrix);
      for (const n of layout.uprightPoints) {
        if (n === WHEEL_CENTRE) continue;
        out.push({ name: `upright.${n}`, a: hub.clone(), b: v(at(n)), r: padRadius.get(n) ?? 0.02, joints: layout.uprightPoints });
      }
      if (arb) {
        const pick = layout.antiRollBar!.pickup;
        const c = arb.C.clone().applyMatrix4(chassis);
        out.push({ name: 'arb.arm', a: c, b: arb.end.clone(), r: ARB.radius, joints: ['arb'] });
        out.push({ name: 'arb.link', a: arb.end.clone(), b: v(arb.idx), r: 0.0105, joints: ['arb', pick] });
      }
      if (rack) {
        // Tapered bellows: housing half and joint half.
        const h = rack.H.clone().applyMatrix4(chassis);
        const mid = h.clone().lerp(v(rack.idx), 0.5);
        out.push({ name: 'gaiter', a: h, b: mid, r: 0.025, joints: [layout.steer ?? ''] });
        out.push({ name: 'gaiter', a: mid.clone(), b: v(rack.idx), r: 0.019, joints: [layout.steer ?? ''] });
      }
      return out;
    },
    wheel() {
      return { centre: W.clone().applyMatrix4(upright.matrix), axis: axle.clone().transformDirection(upright.matrix) };
    },
    dispose() {
      for (const g of owned) g.dispose();
      depth.dispose();
    },
  };
}

/** Lever ratio of the spring's lower mount: 1 on the upright, distance ratio to the pivot axis on an arm or rod. */
function leverRatio(layout: CornerLayout, R: (n: PointName) => Vector3): number {
  const p = R(SPRING_LOWER);
  const arm = layout.arms.find((a) => a.extras.includes(SPRING_LOWER));
  if (arm) {
    const f = R(arm.front);
    const axis = new Vector3().subVectors(R(arm.rear), f).normalize();
    const dist = (q: Vector3) => {
      const d = new Vector3().subVectors(q, f);
      return d.addScaledVector(axis, -d.dot(axis)).length();
    };
    return dist(p) / dist(R(arm.joint));
  }
  const rod = layout.rods.find((r) => r.extras.includes(SPRING_LOWER));
  if (rod) return R(rod.inner).distanceTo(p) / R(rod.inner).distanceTo(R(rod.outer));
  return 1;
}

function pointSegment(q: Vector3, a: Vector3, b: Vector3): number {
  const ab = new Vector3().subVectors(b, a);
  const t = Math.min(1, Math.max(0, new Vector3().subVectors(q, a).dot(ab) / ab.lengthSq()));
  return new Vector3().copy(a).addScaledVector(ab, t).distanceTo(q);
}

/** Distance from the top mount to the first axis station (searching down to `limit`) clear of every obstacle. */
function upperSeatOffset(top: Vector3, low: Vector3, limit: number, obstacles: readonly { a: Vector3; b: Vector3; r: number }[], clear: number): number {
  const dir = new Vector3().subVectors(low, top).normalize();
  const q = new Vector3();
  let lowest = 0;
  for (let s = 0; s <= limit; s += 0.005) {
    q.copy(top).addScaledVector(dir, s);
    if (obstacles.some((o) => pointSegment(q, o.a, o.b) < clear + o.r)) lowest = s;
  }
  return Math.max(0.035, lowest + 0.015);
}

/** Smallest distance between segments p1-q1 and p2-q2 (sampled; build time and tests only). */
function segmentGap(p1: Vector3, q1: Vector3, p2: Vector3, q2: Vector3): number {
  let best = Infinity;
  const q = new Vector3();
  for (let i = 0; i <= 24; i++) best = Math.min(best, pointSegment(q.lerpVectors(p1, q1, i / 24), p2, q2));
  return best;
}

/** Tyre + rim barrel envelope: solid annulus (radial 0.245..0.382 m, axial +-0.125 m) around the wheel centre. */
export const TYRE_ENVELOPE = { rimInner: 0.245, radius: 0.382, halfWidth: 0.125 } as const;

/** Signed clearance of segment a-b (zero radius) to the tyre envelope of a wheel (centre, unit axle). */
export function tyreGap(a: Vector3, b: Vector3, centre: Vector3, axis: Vector3): number {
  let best = Infinity;
  const p = new Vector3();
  for (let i = 0; i <= 16; i++) {
    p.lerpVectors(a, b, i / 16).sub(centre);
    const ax = p.dot(axis);
    const rad = Math.sqrt(Math.max(0, p.lengthSq() - ax * ax));
    const dx = Math.abs(ax) - TYRE_ENVELOPE.halfWidth;
    const dy = Math.max(TYRE_ENVELOPE.rimInner - rad, rad - TYRE_ENVELOPE.radius);
    best = Math.min(best, Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0));
  }
  return best;
}
