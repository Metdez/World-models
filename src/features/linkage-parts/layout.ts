/**
 * Which parts a car corner has, derived ONLY from the AxleLinkage data (constraints, members, roles, upright
 * points, spring and anti-roll-bar mounts): a suspension type is data, never a branch on its id.
 * - two `distance` constraints sharing a member and an upright point = A-arm (wishbone);
 * - any other `distance` constraint = single rod (link, tie rod / toe link); the steer point marks the tie rod;
 * - a `strut` constraint = MacPherson strut (damper body clamped to the upright), else a coil-over;
 * - extra pickups (spring seat, anti-roll-bar drop link) belong to the member that carries them.
 */
import { Vector3 } from 'three';
import type { AxleLinkage, ComponentRole, PointName } from '../../contracts/suspension';
import { simToThree } from '../../contracts/units';

/** Derived point appended by the kinematics (CornerFrame.pointOrder = points keys + this). */
export const SPRING_LOWER = 'springLower';
export const WHEEL_CENTRE = 'wheelCentre';

export interface ArmLayout {
  readonly member: string;
  readonly role: ComponentRole;
  readonly joint: PointName;
  /** Chassis pivots, front (larger x) first. */
  readonly front: PointName;
  readonly rear: PointName;
  readonly extras: readonly PointName[];
}

export interface RodLayout {
  readonly member: string;
  readonly role: ComponentRole;
  readonly inner: PointName;
  readonly outer: PointName;
  readonly extras: readonly PointName[];
  /** Inner end moves with the steering rack. */
  readonly steered: boolean;
}

export interface CornerLayout {
  /** Expected CornerFrame.pointOrder (the visual still resolves names at runtime). */
  readonly names: readonly PointName[];
  readonly uprightPoints: readonly PointName[];
  /** Best-conditioned triples for the rigid frames. */
  readonly uprightFrame: readonly [PointName, PointName, PointName];
  readonly chassisFrame: readonly [PointName, PointName, PointName];
  readonly arms: readonly ArmLayout[];
  readonly rods: readonly RodLayout[];
  /** Damper / spring axis: lower = SPRING_LOWER, upper = the spring's chassis mount. */
  readonly damper: { readonly upper: PointName; readonly strut: boolean };
  readonly antiRollBar?: { readonly pickup: PointName };
  readonly steer?: PointName;
}

function triangleArea(a: readonly number[], b: readonly number[], c: readonly number[]): number {
  const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
  const v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
  return Math.hypot(u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!) / 2;
}

function bestTriple(axle: AxleLinkage, names: readonly PointName[]): [PointName, PointName, PointName] {
  let best: [PointName, PointName, PointName] | undefined;
  let area = 0;
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++)
      for (let k = j + 1; k < names.length; k++) {
        const a = triangleArea(axle.points[names[i]!]!, axle.points[names[j]!]!, axle.points[names[k]!]!);
        if (a > area) {
          area = a;
          best = [names[i]!, names[j]!, names[k]!];
        }
      }
  if (!best || area < 1e-4) throw new Error(`linkage-parts: no well-conditioned frame among ${names.join(', ')}`);
  return best;
}

export function cornerLayout(axle: AxleLinkage): CornerLayout {
  const names = [...Object.keys(axle.points), SPRING_LOWER];
  const extras = new Map<string, PointName[]>();
  const addExtra = (member: string, p: PointName) => extras.set(member, [...(extras.get(member) ?? []), p]);
  const lower = axle.spring.lower;
  if (lower.on !== 'upright') addExtra(lower.member, SPRING_LOWER);
  if (axle.antiRollBarMount) addExtra(axle.antiRollBarMount.member, axle.antiRollBarMount.point);

  const byMember = new Map<string, Extract<AxleLinkage['constraints'][number], { kind: 'distance' }>[]>();
  let strut = false;
  for (const c of axle.constraints) {
    if (c.kind === 'strut') {
      strut = true;
      continue;
    }
    byMember.set(c.member, [...(byMember.get(c.member) ?? []), c]);
  }
  const arms: ArmLayout[] = [];
  const rods: RodLayout[] = [];
  for (const [member, cs] of byMember) {
    const [c0, c1] = cs;
    if (cs.length === 2 && c0 && c1 && c0.upright === c1.upright) {
      const [front, rear] = axle.points[c0.chassis]![0] >= axle.points[c1.chassis]![0] ? [c0.chassis, c1.chassis] : [c1.chassis, c0.chassis];
      arms.push({ member, role: c0.role, joint: c0.upright, front, rear, extras: extras.get(member) ?? [] });
    } else {
      for (const c of cs) rods.push({ member, role: c.role, inner: c.chassis, outer: c.upright, extras: extras.get(member) ?? [], steered: c.chassis === axle.steer });
    }
  }
  const chassis = new Set<PointName>([axle.spring.upper]);
  for (const c of axle.constraints) if (c.chassis !== axle.steer) chassis.add(c.chassis);
  return {
    names,
    uprightPoints: axle.uprightPoints,
    uprightFrame: bestTriple(axle, axle.uprightPoints),
    chassisFrame: bestTriple(axle, [...chassis]),
    arms,
    rods,
    damper: { upper: axle.spring.upper, strut },
    ...(axle.antiRollBarMount ? { antiRollBar: { pickup: axle.antiRollBarMount.point } } : {}),
    ...(axle.steer ? { steer: axle.steer } : {}),
  };
}

/**
 * Design (rest) positions of every name in `layout.names`, in three.js coordinates of the VEHICLE frame:
 * AXLE-frame point + (axleX, 0, 0), right side mirrored (sim y -> -y). SPRING_LOWER per the spring mount kind.
 */
export function restPoints(axle: AxleLinkage, layout: CornerLayout, axleX: number, side: 1 | -1): Map<PointName, Vector3> {
  const sim = (p: readonly number[]) => [p[0]! + axleX, side * p[1]!, p[2]!] as const;
  const out = new Map<PointName, Vector3>();
  for (const [name, p] of Object.entries(axle.points)) {
    const [x, y, z] = sim(p);
    const v = new Vector3();
    simToThree(x, y, z, v);
    out.set(name, v);
  }
  const lower = axle.spring.lower;
  let springLower: Vector3;
  if (lower.on === 'link') {
    const c = axle.constraints.find((k) => k.kind === 'distance' && k.member === lower.member);
    if (!c) throw new Error(`linkage-parts: spring link member "${lower.member}" not found`);
    springLower = new Vector3().lerpVectors(out.get(c.chassis)!, out.get(c.upright)!, lower.fraction);
  } else {
    springLower = out.get(lower.point)!.clone();
  }
  out.set(SPRING_LOWER, springLower);
  for (const n of layout.names) if (!out.has(n)) throw new Error(`linkage-parts: missing point "${n}"`);
  return out;
}
