/**
 * Compliance (elastokinematics) coefficients of one axle corner, derived once from OUR hardpoints and ONE shared
 * role-based bushing table (ARCHITECTURE-M2 §7.5; research m2/23 §5.2, which supersedes m2/05 on magnitudes). Nothing
 * here knows the suspension type: differences come only from where the links' lines of action run.
 *
 * Method (small-displacement statics of the upright as one rigid body, 6 DOF, about o = the design contact patch):
 * - every `distance` constraint is a two-force link: unit vector u from its chassis point to its upright point,
 *   wrench w = [u; (p - o) x u] at the upright point p, axial stiffness k = bushingRates[role] (the chassis-side bush;
 *   ball joints rigid);
 * - a `strut` constraint keeps the chassis top mount on the upright-fixed strut axis: two wrenches perpendicular to
 *   the axis at the top mount, stiffness bushingRates.strut (top-mount radial rate);
 * - K = sum k w w^T (6x6, rank 5: the links leave the travel DOF free), and the carrier displacement
 *   d = [translation of o; rotation] solves K d = f with the travel LOCKED: the wheel centre's vertical displacement
 *   is held at zero (w_s . d = 0, w_s = [z; (wheelCentre - o) x z], Lagrange multiplier; the K&C-rig convention).
 *   Deviation from §7.5 step 2 (a spring of the corner wheel rate there): the plant's ride model already moves the
 *   wheel along its travel under the tyre forces (jacking, roll) and applies the kinematic camber/toe of that travel;
 *   a wheel-rate spring here would count that kinematic part a second time (it is most of the camber: 2-5x) and break
 *   the exact 1/rate scaling. `wheelRate` is kept for the frozen signature and only checked.
 * Unit loads at the contact patch give the coefficients (left corner, RACE signs: toe + = toe-in, camber + = top
 * outboard; all scale exactly as 1 / rate). Only the chassis-side bushes are compliant: subframe mounts, the outer
 * bush and arm bending are not modelled, so the lateral stiffness comes out stiffer than rig values of whole cars. The right corner is the mirror and uses the same numbers with Fy_in signed
 * toward the car centre.
 * The coefficients are ASSUMED-RATE model values: show them as a band (rates x0.5 .. x2), never as measured data.
 */
import type { AxleLinkage } from '../../contracts/suspension';
import type { CarCompliance } from '../../contracts/vehicle';
import { createCornerSolution, type KinematicsTable } from '../kinematics/table';
import { solveInPlace } from '../math/linsolve';

/** Left wheel, rad per N (toe: + toe-in; camber: + top outboard), RACE signs. */
export interface AxleCompliance {
  /** Toe per N of lateral force at the patch, signed + toward the car centre (Fy_in). */
  readonly fyToe: number;
  /** Camber per N of Fy_in. */
  readonly fyCamber: number;
  /** d(toe)/d(Fx) for a longitudinal force at the patch (braking, Fx < 0): toe-in under braking is NEGATIVE here. */
  readonly fxToeBrake: number;
  /** d(toe)/d(Fx) for a longitudinal force at the wheel centre (drive torque reacted by the shaft). */
  readonly fxToeDrive: number;
  /** Toe per N m of moment about the vertical at the patch (+z on the left wheel, mirrored on the right). Reported
   *  only: the plant has no aligning-moment model. */
  readonly mzToe: number;
  /** N/m: lateral force at the patch per metre of lateral patch translation (calibration check). */
  readonly lateralStiffness: number;
}

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function unit(a: V): V {
  const n = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
  if (!(n > 0)) throw new Error('compliance: degenerate link (zero length)');
  return [a[0] / n, a[1] / n, a[2] / n];
}

/**
 * Coefficients of the corner described by `axle` (its constraints) at the design pose of `table` (travel 0, rack 0).
 * `side` = +1 for the left corner (AXLE frame as stored); -1 when the geometry passed in is already mirrored to the
 * right (tests use it to check the mirror property).
 */
export function deriveCompliance(
  axle: AxleLinkage,
  table: KinematicsTable,
  rates: CarCompliance['bushingRates'],
  wheelRate: number,
  side: 1 | -1 = 1,
): AxleCompliance {
  const pose = table.sample(0, 0, createCornerSolution(table));
  const point = (name: string): V => {
    const i = table.pointOrder.indexOf(name);
    if (i < 0) throw new Error(`compliance: no point '${name}'`);
    return [pose.points[3 * i]!, pose.points[3 * i + 1]!, pose.points[3 * i + 2]!];
  };
  const rate = (role: string): number => {
    const k = (rates as Readonly<Record<string, number | undefined>>)[role];
    if (!(k !== undefined && k > 0)) throw new Error(`compliance: no bushing rate for role '${role}'`);
    return k;
  };
  const o: V = [pose.contactPatch.x, pose.contactPatch.y, pose.contactPatch.z];
  const wc: V = [pose.wheelCentre.x, pose.wheelCentre.y, pose.wheelCentre.z];

  const K = new Float64Array(36);
  const w = new Float64Array(6);
  const add = (u: V, p: V, k: number): void => {
    const m = cross(sub(p, o), u);
    w[0] = u[0];
    w[1] = u[1];
    w[2] = u[2];
    w[3] = m[0];
    w[4] = m[1];
    w[5] = m[2];
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) K[i * 6 + j] = K[i * 6 + j]! + k * w[i]! * w[j]!;
  };
  for (const c of axle.constraints) {
    const chassis = point(c.chassis);
    const upright = point(c.upright);
    if (c.kind === 'distance') add(unit(sub(upright, chassis)), upright, rate(c.role));
    else {
      const a = unit(sub(chassis, upright));
      const e1 = unit(Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]));
      const e2 = cross(a, e1);
      const k = rate('strut');
      add(e1, chassis, k);
      add(e2, chassis, k);
    }
  }
  if (!(wheelRate > 0)) throw new Error('compliance: wheel rate must be > 0');

  // KKT system [K s; s^T 0] [d; lambda] = [f; 0] with s = the travel lock (vertical motion of the wheel centre).
  const lock = cross(sub(wc, o), [0, 0, 1]);
  const s7 = [0, 0, 1, lock[0], lock[1], lock[2]];
  const A = new Float64Array(49);
  const d = new Float64Array(7);
  /** Carrier displacement for a force f at point p plus a moment mz about z. */
  const respond = (f: V, p: V, mz: number): Float64Array => {
    const m = cross(sub(p, o), f);
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) A[i * 7 + j] = K[i * 6 + j]!;
      A[i * 7 + 6] = s7[i]!;
      A[42 + i] = s7[i]!;
    }
    A[48] = 0;
    d[0] = f[0];
    d[1] = f[1];
    d[2] = f[2];
    d[3] = m[0];
    d[4] = m[1];
    d[5] = m[2] + mz;
    d[6] = 0;
    if (!solveInPlace(A, d, 7)) throw new Error('compliance: singular stiffness (links do not hold the upright)');
    return d;
  };
  // left: toe-in = -rotation about z, camber (top outboard) = -rotation about x; mirrored for side -1
  const toe = (r: Float64Array): number => -side * r[5]!;
  const camber = (r: Float64Array): number => -side * r[3]!;

  const lat = respond([0, -side, 0], o, 0); // +1 N toward the car centre
  const fyToe = toe(lat);
  const fyCamber = camber(lat);
  const lateralStiffness = 1 / (-side * lat[1]!);
  const fxToeBrake = -toe(respond([-1, 0, 0], o, 0)); // per N of Fx, the load being Fx = -1 N
  const fxToeDrive = toe(respond([1, 0, 0], wc, 0));
  const mzToe = toe(respond([0, 0, 0], o, side));
  return { fyToe, fyCamber, fxToeBrake, fxToeDrive, mzToe, lateralStiffness };
}
