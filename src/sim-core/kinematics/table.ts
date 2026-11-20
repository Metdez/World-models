/**
 * Precomputed travel x rack lookup of one axle corner (ARCHITECTURE §7.2.2). Built once per (vehicle,
 * suspension) by continuation from the design pose; `sample()` is bilinear and allocation-free.
 * Everything is for the LEFT corner in the AXLE frame. The right corner at (travel, rack) is the mirror
 * (y -> -y) of `sample(travel, -rack)`.
 */
import type { AxleId, XYZ, XYZW } from '../../contracts/units';
import type { AxleKinematics, AxleKinematicsSummary, AxleLinkage, KinematicsCurves } from '../../contracts/suspension';
import * as m3 from '../math/mat';
import type { Quat } from '../math/quat';
import { interp1 } from '../math/interp';
import type { V3 } from '../math/vec3';
import { createLmSolver } from './lm';
import {
  createTangentTools,
  createTwist,
  createWheelState,
  instantCentre,
  pointVelocity,
  steerAxisMetrics,
  wheelState,
  type TangentParam,
} from './metrics';
import { compileLinkage, type Spatial } from './spatial';

export interface CornerSolution {
  travel: number;
  rack: number;
  camber: number;
  toe: number; // body-relative, sign conventions §4
  readonly wheelCentre: XYZ;
  readonly contactPatch: XYZ;
  readonly instantCentre: XYZ; // AXLE frame, left side
  readonly rotation: XYZW; // upright rotation from design pose (about the design wheel centre)
  springLength: number;
  motionRatio: number;
  readonly points: Float64Array; // AXLE frame, table.pointOrder
}

export interface KinematicsTable {
  /** All AxleLinkage.points keys + 'springLower'. */
  readonly pointOrder: readonly string[];
  readonly travelRange: readonly [number, number];
  readonly rackRange: readonly [number, number];
  sample(travel: number, rack: number, out: CornerSolution): CornerSolution;
  /** Rack for a mean road-wheel angle (rad, + left) at design travel; clamped to the rack range. */
  rackForSteer(steer: number): number;
  /** Kinematic roll-centre height above ground for left/right wheel travel (rack 0), m. */
  rollCentreHeight(travelLeft: number, travelRight: number): number;
  readonly antiPitch: number;
}

export interface SolveOptions {
  readonly tyreRadius: number;
  /** Required for a steered axle: the rack range covers this mean road-wheel angle (plus a margin). */
  readonly maxSteer?: number;
  readonly axle: AxleId;
  readonly cgHeight: number;
  readonly wheelbase: number;
  /** Front: fraction of braking on this axle (anti-dive, outboard brakes). Rear: anti-squat assumes all drive here. */
  readonly brakeShare: number;
}

export const TRAVEL_STEP = 0.0025;
export const RACK_STEP = 0.002;
/** The grid extends this far beyond the bump and droop travel. */
export const TRAVEL_MARGIN = 0.02;
/** The rack range covers maxSteer times this. */
export const STEER_MARGIN = 1.15;
/** Every grid pose closes its constraints to this residual. */
export const RESIDUAL_TOL = 1e-12;

// Node record layout.
const CAMBER = 0;
const TOE = 1;
const WC = 2;
const CP = 5;
const IC = 8;
const QUAT = 11;
const SPRING = 15;
const MR = 16;
const POINTS = 17;

export function createCornerSolution(table: KinematicsTable): CornerSolution {
  return {
    travel: 0,
    rack: 0,
    camber: 0,
    toe: 0,
    wheelCentre: { x: 0, y: 0, z: 0 },
    contactPatch: { x: 0, y: 0, z: 0 },
    instantCentre: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    springLength: 0,
    motionRatio: 0,
    points: new Float64Array(table.pointOrder.length * 3),
  };
}

/** Continuation solver over (travel, rack) with recursive step halving. Build-time only. */
function createPoseSolver(sp: Spatial) {
  const lm = createLmSolver(6, 6);
  const save = new Float64Array(6);
  const step = (x: Float64Array, t0: number, r0: number, t1: number, r1: number, depth: number): void => {
    sp.travel = t1;
    sp.rack = r1;
    save.set(x);
    if (lm.solve(sp.residuals, x, RESIDUAL_TOL) >= 0) return;
    if (depth > 10) throw new Error(`kinematics: no pose at travel ${t1} m, rack ${r1} m (residual ${lm.residualMax})`);
    x.set(save);
    const tm = (t0 + t1) / 2;
    const rm = (r0 + r1) / 2;
    step(x, t0, r0, tm, rm, depth + 1);
    step(x, tm, rm, t1, r1, depth + 1);
  };
  return {
    lm,
    /** x holds the pose at (t0, r0); on return the pose at (t1, r1). */
    move(x: Float64Array, t0: number, r0: number, t1: number, r1: number): void {
      step(x, t0, r0, t1, r1, 0);
    },
  };
}

export function solveAxleKinematics(axle: AxleLinkage, opts: SolveOptions): { table: KinematicsTable; kinematics: AxleKinematics } {
  const sp = compileLinkage(axle, opts.tyreRadius);
  const solver = createPoseSolver(sp);
  const tools = createTangentTools(sp, solver.lm);
  const ws = createWheelState();
  const tw = createTwist();
  const dx = new Float64Array(6);
  const v: V3 = [0, 0, 0];
  const np = sp.names.length;
  const stride = POINTS + np * 3;

  // ---- Grid axes.
  const iZero = Math.ceil((axle.travel.droop + TRAVEL_MARGIN) / TRAVEL_STEP - 1e-9);
  const nt = iZero + Math.ceil((axle.travel.bump + TRAVEL_MARGIN) / TRAVEL_STEP - 1e-9) + 1;
  const t0 = -iZero * TRAVEL_STEP;
  const travelAt = (i: number): number => t0 + i * TRAVEL_STEP;

  const steered = sp.steerIdx >= 0;
  let nHalf = 0;
  if (steered) {
    if (opts.maxSteer === undefined || !(opts.maxSteer > 0)) throw new Error('kinematics: maxSteer is required for a steered axle');
    // March the rack outward at design travel until the mean road-wheel angle covers maxSteer.
    const xl = new Float64Array(6);
    const xr = new Float64Array(6);
    const target = opts.maxSteer * STEER_MARGIN;
    for (;;) {
      if (nHalf * RACK_STEP > 0.25) throw new Error('kinematics: rack travel cannot reach maxSteer');
      const r = nHalf * RACK_STEP;
      solver.move(xl, 0, r, 0, r + RACK_STEP);
      solver.move(xr, 0, -r, 0, -r - RACK_STEP);
      nHalf++;
      const mean = (-wheelState(sp, xl, ws).toe + wheelState(sp, xr, ws).toe) / 2;
      if (Math.abs(mean) >= target) break;
    }
  }
  const nr = 2 * nHalf + 1;
  const rackAt = (j: number): number => (j - nHalf) * RACK_STEP;

  // ---- Solve every node by continuation: rack-0 column outward in travel, then each row outward in rack.
  const xs = new Float64Array(nt * nr * 6);
  const x = new Float64Array(6);
  const node = (i: number, j: number): number => (i * nr + j) * 6;
  for (const dir of [1, -1]) {
    x.fill(0);
    for (let i = iZero + dir; i >= 0 && i < nt; i += dir) {
      solver.move(x, travelAt(i - dir), 0, travelAt(i), 0);
      xs.set(x, node(i, nHalf));
    }
  }
  for (let i = 0; i < nt; i++) {
    for (const dir of [1, -1]) {
      x.set(xs.subarray(node(i, nHalf), node(i, nHalf) + 6));
      for (let j = nHalf + dir; j >= 0 && j < nr; j += dir) {
        solver.move(x, travelAt(i), rackAt(j - dir), travelAt(i), rackAt(j));
        xs.set(x, node(i, j));
      }
    }
  }

  // ---- Node records.
  const rec = new Float64Array(nt * nr * stride);
  const pts = new Float64Array(np * 3);
  const ptsP = new Float64Array(np * 3);
  const xp = new Float64Array(6);
  const R = m3.create();
  const q: Quat = [0, 0, 0, 1];
  const icv: V3 = [0, 0, 0];
  const dir2: V3 = [0, 0, 0];
  const rcCpY = new Float64Array(nt);
  const rcCpZ = new Float64Array(nt);
  const rcDy = new Float64Array(nt);
  const rcDz = new Float64Array(nt);
  const su = sp.springUpperIdx * 3;
  const sl = sp.springLowerIdx * 3;
  const springLen = (p: Float64Array): number => Math.hypot(p[su]! - p[sl]!, p[su + 1]! - p[sl + 1]!, p[su + 2]! - p[sl + 2]!);
  const tangent = (xi: Float64Array, param: TangentParam): void => {
    if (!tools.tangent(xi, param, dx)) throw new Error(`kinematics: singular linkage at travel ${sp.travel} m, rack ${sp.rack} m`);
  };
  for (let i = 0; i < nt; i++) {
    for (let j = 0; j < nr; j++) {
      const xi = xs.subarray(node(i, j), node(i, j) + 6);
      sp.travel = travelAt(i);
      sp.rack = rackAt(j);
      const o = (i * nr + j) * stride;
      wheelState(sp, xi, ws);
      sp.pointsAt(xi, pts);
      tangent(xi, 'travel');
      tools.twist(xi, dx, tw);
      pointVelocity(tw, ws.wc, ws.cp, v);
      instantCentre(v, tw.w[0], ws.cp, icv, dir2);
      // Motion ratio: spring shortening per unit bump along the solution tangent.
      const e = 1e-6;
      for (let k = 0; k < 6; k++) xp[k] = xi[k]! + e * dx[k]!;
      const lp = springLen(sp.pointsAt(xp, ptsP));
      for (let k = 0; k < 6; k++) xp[k] = xi[k]! - e * dx[k]!;
      const lm = springLen(sp.pointsAt(xp, ptsP));
      m3.toQuat(q, ws.R);
      const qs = q[3] < 0 ? -1 : 1;
      rec[o + CAMBER] = ws.camber;
      rec[o + TOE] = ws.toe;
      rec.set(ws.wc, o + WC);
      rec.set(ws.cp, o + CP);
      rec.set(icv, o + IC);
      for (let k = 0; k < 4; k++) rec[o + QUAT + k] = q[k]! * qs;
      rec[o + SPRING] = springLen(pts);
      rec[o + MR] = -(lp - lm) / (2 * e);
      rec.set(pts, o + POINTS);
      if (j === nHalf) {
        rcCpY[i] = ws.cp[1];
        rcCpZ[i] = ws.cp[2];
        rcDy[i] = dir2[0];
        rcDz[i] = dir2[1];
      }
    }
  }
  sp.travel = 0;
  sp.rack = 0;

  const travels = Float64Array.from({ length: nt }, (_, i) => travelAt(i));
  const tMin = travels[0]!;
  const tMax = travels[nt - 1]!;
  const rMax = nHalf * RACK_STEP;
  const groundZ = sp.groundZ;

  // ---- Roll centre from the two contact-patch IC lines (right side mirrored), rack 0.
  const rc = new Float64Array(2); // [y, height above ground]
  const lineAt = (t: number, out: Float64Array, o: number): void => {
    const u = Math.min(Math.max((t - tMin) / TRAVEL_STEP, 0), nt - 1);
    const i = Math.min(Math.floor(u), nt - 2);
    const f = u - i;
    out[o] = rcCpY[i]! + (rcCpY[i + 1]! - rcCpY[i]!) * f;
    out[o + 1] = rcCpZ[i]! + (rcCpZ[i + 1]! - rcCpZ[i]!) * f;
    out[o + 2] = rcDy[i]! + (rcDy[i + 1]! - rcDy[i]!) * f;
    out[o + 3] = rcDz[i]! + (rcDz[i + 1]! - rcDz[i]!) * f;
  };
  const lines = new Float64Array(8);
  const rollCentre = (tl: number, tr: number): Float64Array => {
    lineAt(tl, lines, 0);
    lineAt(tr, lines, 4);
    const pLy = lines[0]!;
    const pLz = lines[1]!;
    const dLy = lines[2]!;
    const dLz = lines[3]!;
    const pRy = -lines[4]!;
    const pRz = lines[5]!;
    const dRy = -lines[6]!;
    const dRz = lines[7]!;
    // pL + a dL = pR + b dR
    const det = -dLy * dRz + dRy * dLz;
    if (Math.abs(det) < 1e-12) {
      rc[0] = 0;
      rc[1] = (pLz + pRz) / 2 - groundZ;
      return rc;
    }
    const a = ((pRy - pLy) * -dRz + dRy * (pRz - pLz)) / det;
    rc[0] = pLy + a * dLy;
    rc[1] = pLz + a * dLz - groundZ;
    return rc;
  };

  // ---- Rack for steer: mean road-wheel angle at design travel. Left steer = -toe(r); right = toe(-r) (mirror).
  const steerTab = new Float64Array(nr);
  const rackTab = new Float64Array(nr);
  {
    const rows = Array.from({ length: nr }, (_, j) => (-rec[(iZero * nr + j) * stride + TOE]! + rec[(iZero * nr + (nr - 1 - j)) * stride + TOE]!) / 2);
    const asc = nr < 2 || rows[nr - 1]! > rows[0]!;
    for (let j = 0; j < nr; j++) {
      const jj = asc ? j : nr - 1 - j;
      steerTab[j] = rows[jj]!;
      rackTab[j] = rackAt(jj);
    }
    for (let j = 1; j < nr; j++) if (!(steerTab[j]! > steerTab[j - 1]!)) throw new Error('kinematics: steer is not monotonic in rack');
  }

  // ---- Sampling: blend the four cell records into one scratch record in a single loop. (No helper call
  // returning a double: a non-inlined call boxes its result.)
  const tmp = new Float64Array(stride);
  const table: KinematicsTable = {
    pointOrder: sp.names,
    travelRange: [tMin, tMax],
    rackRange: [-rMax, rMax],
    antiPitch: 0,
    sample(travel, rack, out) {
      const t = travel < tMin ? tMin : travel > tMax ? tMax : travel;
      const r = rack < -rMax ? -rMax : rack > rMax ? rMax : rack;
      const u = (t - tMin) / TRAVEL_STEP;
      const i = u >= nt - 1 ? nt - 2 : Math.floor(u);
      const fi = u - i;
      let j = 0;
      let j1 = 0;
      let fj = 0;
      if (nr > 1) {
        const w = (r + rMax) / RACK_STEP;
        j = w >= nr - 1 ? nr - 2 : Math.floor(w);
        j1 = j + 1;
        fj = w - j;
      }
      const w00 = (1 - fi) * (1 - fj);
      const w01 = (1 - fi) * fj;
      const w10 = fi * (1 - fj);
      const w11 = fi * fj;
      const c00 = (i * nr + j) * stride;
      const c01 = (i * nr + j1) * stride;
      const c10 = ((i + 1) * nr + j) * stride;
      const c11 = ((i + 1) * nr + j1) * stride;
      for (let k = 0; k < stride; k++) tmp[k] = rec[c00 + k]! * w00 + rec[c01 + k]! * w01 + rec[c10 + k]! * w10 + rec[c11 + k]! * w11;
      out.travel = t;
      out.rack = r;
      out.camber = tmp[CAMBER]!;
      out.toe = tmp[TOE]!;
      out.wheelCentre.x = tmp[WC]!;
      out.wheelCentre.y = tmp[WC + 1]!;
      out.wheelCentre.z = tmp[WC + 2]!;
      out.contactPatch.x = tmp[CP]!;
      out.contactPatch.y = tmp[CP + 1]!;
      out.contactPatch.z = tmp[CP + 2]!;
      out.instantCentre.x = tmp[IC]!;
      out.instantCentre.y = tmp[IC + 1]!;
      out.instantCentre.z = tmp[IC + 2]!;
      const qx = tmp[QUAT]!;
      const qy = tmp[QUAT + 1]!;
      const qz = tmp[QUAT + 2]!;
      const qw = tmp[QUAT + 3]!;
      const ql = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
      out.rotation.x = qx / ql;
      out.rotation.y = qy / ql;
      out.rotation.z = qz / ql;
      out.rotation.w = qw / ql;
      out.springLength = tmp[SPRING]!;
      out.motionRatio = tmp[MR]!;
      const p = out.points;
      for (let k = 0; k < np * 3; k++) p[k] = tmp[POINTS + k]!;
      return out;
    },
    rackForSteer(steer) {
      return nr > 1 ? interp1(steerTab, rackTab, steer) : 0;
    },
    rollCentreHeight(travelLeft, travelRight) {
      return rollCentre(travelLeft, travelRight)[1]!;
    },
  };

  // ---- Curves (rack 0).
  const col = (k: number): Float64Array => Float64Array.from({ length: nt }, (_, i) => rec[(i * nr + nHalf) * stride + k]!);
  const d0 = (iZero * nr + nHalf) * stride;
  const curves: KinematicsCurves = {
    travel: travels,
    camber: col(CAMBER),
    toe: col(TOE),
    rollCentreHeight: Float64Array.from(travels, (t) => rollCentre(t, t)[1]!),
    motionRatio: col(MR),
    lateral: col(CP + 1).map((y) => y - rec[d0 + CP + 1]!),
    longitudinal: col(WC).map((xw) => xw - rec[d0 + WC]!),
  };

  // ---- Design summary.
  const xd = new Float64Array(6);
  const design = (param: TangentParam) => {
    sp.travel = 0;
    sp.rack = 0;
    wheelState(sp, xd, ws);
    tangent(xd, param);
    return tools.twist(xd, dx, tw);
  };
  // Camber/toe rates along the bump tangent.
  design('travel');
  const along = (e: number) => {
    for (let k = 0; k < 6; k++) xp[k] = xd[k]! + e * dx[k]!;
    return wheelState(sp, xp, createWheelState());
  };
  const h = 1e-5;
  const sPlus = along(h);
  const sMinus = along(-h);
  const camberGain = (sPlus.camber - sMinus.camber) / (2 * h);
  const bumpSteer = (sPlus.toe - sMinus.toe) / (2 * h);
  wheelState(sp, xd, ws);
  const vcp = pointVelocity(tw, ws.wc, ws.cp, [0, 0, 0]);
  const wheelbaseFactor = opts.wheelbase / opts.cgHeight;
  // Front: braking reacts in the upright (outboard brakes) -> contact-patch path. Rear: driven independent
  // axle, drive torque reacts in the body -> wheel-centre path.
  const antiPitch = opts.axle === 'front' ? (vcp[0] / vcp[2]) * wheelbaseFactor * opts.brakeShare : (-tw.v[0] / tw.v[2]) * wheelbaseFactor;
  const halfTrack = ws.cp[1];
  // Outer wheel of a body rolled by phi goes into bump by halfTrack*tan(phi); roll tilts it outward by phi.
  const phi1 = Math.PI / 180;
  const xr = new Float64Array(6);
  const bump1 = halfTrack * Math.tan(phi1);
  solver.move(xr, 0, 0, bump1, 0);
  const rollCamber = (wheelState(sp, xr, createWheelState()).camber - ws.camber + phi1) / phi1;
  const phi2 = 2 * phi1;
  const migration = Math.abs(rollCentre(-halfTrack * Math.tan(phi2), halfTrack * Math.tan(phi2))[0]!);
  const axis = steerAxisMetrics(design(steered ? 'rack' : 'toe'), wheelState(sp, xd, createWheelState()), groundZ);
  sp.travel = 0;
  sp.rack = 0;
  const summary: AxleKinematicsSummary = {
    camberGain,
    rollCamber,
    bumpSteer,
    rollCentreHeight: rollCentre(0, 0)[1]!,
    rollCentreMigration: migration,
    kingpinInclination: axis.kpi,
    caster: axis.caster,
    scrubRadius: axis.scrub,
    trail: axis.trail,
    antiPitch,
    motionRatio: rec[d0 + MR]!,
  };
  (table as { antiPitch: number }).antiPitch = antiPitch;
  return { table, kinematics: { axle: opts.axle, curves, summary } };
}
