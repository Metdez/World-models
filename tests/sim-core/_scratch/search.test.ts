import { Vector3 } from 'three';
import { it } from 'vitest';
import { RAD_TO_DEG } from '../../../src/contracts/units';
import type { AxleLinkage } from '../../../src/contracts/suspension';
import type { CarSuspensionDefinition } from '../../../src/contracts/suspension';
import { CAR_CORNERS, type AxleId } from '../../../src/contracts/units';
import { createTelemetryFrame, type TelemetryFrame } from '../../../src/contracts/telemetry';
import type { CarDefinition } from '../../../src/contracts/vehicle';
import { GT_GEOMETRY } from '../../../src/sim-core/content/gt-geometry';
import { doubleWishbone } from '../../../src/sim-core/content/susp-double-wishbone';
import { macpherson } from '../../../src/sim-core/content/susp-macpherson';
import { multilink } from '../../../src/sim-core/content/susp-multilink';
import { createCornerSolution, solveAxleKinematics, type CornerSolution, type KinematicsTable } from '../../../src/sim-core/kinematics/table';
import { buildSpatialLinkage } from '../../../src/features/linkage-parts/visual';
import type { Capsule } from '../../../src/features/linkage-parts/corner';
import { gtCoupe } from '../../../src/sim-core/content/gt-coupe';
import { createSimulation } from '../../../src/sim-core/index';
const DEFS = [macpherson, doubleWishbone, multilink] as const;
const MAX_STEER = 0.35;

// Representative GT coupe (ARCHITECTURE §7.5) until 02-04's gt-coupe.ts lands; only geometry fields matter here.
const tyre = { radius: 0.382, width: 0.255, verticalStiffness: 300000, verticalDamping: 500, mu: 1.1, loadSensitivity: -0.00002, nominalLoad: 4000 };
const axleSpec = { track: 1.694, unsprungMass: 45, rideFrequency: 1.5, damping: { bump: 0.3, rebound: 0.45 }, antiRollStiffness: 30000, tyre, steered: true, driven: false, brakeShare: 0.62 };
const VEHICLE: CarDefinition = {
  id: 'test-gt',
  class: 'car',
  name: 'GT coupe',
  subtitle: 'test',
  visualKey: 'db11',
  mass: 1700,
  sprungMass: 1520,
  cgHeight: 0.5,
  inertia: { roll: 500, pitch: 2200, yaw: 2500 },
  wheelbase: GT_GEOMETRY.wheelbase,
  cgToFront: 1.4,
  limits: { lateral: 8.3, accel: 5, brake: 8.5, vMax: 36 },
  dragArea: 0.65,
  suspensions: ['macpherson', 'double-wishbone', 'multilink'],
  defaultSuspension: 'double-wishbone',
  front: axleSpec,
  rear: { ...axleSpec, steered: false, driven: true, brakeShare: 0.38 },
  maxSteer: MAX_STEER,
};

interface Rig {
  readonly def: CarSuspensionDefinition;
  readonly tables: Record<AxleId, KinematicsTable>;
  readonly sol: CornerSolution[];
  readonly frame: TelemetryFrame;
}

const rigs = new Map<string, Rig>();
function rig(def: CarSuspensionDefinition): Rig {
  const cached = rigs.get(def.id);
  if (cached) return cached;
  const tables = {} as Record<AxleId, KinematicsTable>;
  for (const axle of ['front', 'rear'] as const) {
    tables[axle] = solveAxleKinematics(def.axles[axle], {
      tyreRadius: GT_GEOMETRY[axle].tyreRadius,
      axle,
      cgHeight: 0.5,
      wheelbase: GT_GEOMETRY.wheelbase,
      brakeShare: axle === 'front' ? 0.62 : 0.38,
      ...(axle === 'front' ? { maxSteer: MAX_STEER } : {}),
    }).table;
  }
  const frame = createTelemetryFrame(
    'car',
    CAR_CORNERS.map((id) => ({ id, axle: id[0] === 'f' ? ('front' as const) : ('rear' as const), side: id[1] === 'l' ? (1 as const) : (-1 as const) })),
  );
  for (const c of frame.corners) c.pointOrder = tables[c.axle].pointOrder;
  const r: Rig = { def, tables, sol: frame.corners.map((c) => createCornerSolution(tables[c.axle])), frame };
  rigs.set(def.id, r);
  return r;
}

/** Writes a pose (vehicle frame = world: body at rest on the origin). rack > 0 steers left. */
function pose(r: Rig, travel: number, rack: number, spin = 0): TelemetryFrame {
  for (let i = 0; i < r.frame.corners.length; i++) {
    const c = r.frame.corners[i]!;
    const table = r.tables[c.axle];
    const s = table.sample(travel, c.axle === 'front' ? c.side * rack : 0, r.sol[i]!);
    const x0 = c.axle === 'front' ? VEHICLE.cgToFront : -(VEHICLE.wheelbase - VEHICLE.cgToFront);
    for (let k = 0; k < table.pointOrder.length; k++) {
      c.points[3 * k] = s.points[3 * k]! + x0;
      c.points[3 * k + 1] = c.side * s.points[3 * k + 1]!;
      c.points[3 * k + 2] = s.points[3 * k + 2]!;
    }
    c.spin = spin;
    c.springLength = s.springLength;
  }
  return r.frame;
}

const POSES = (r: Rig) => {
  const lock = r.tables.front.rackRange[1];
  return {
    static: [0, 0],
    bump: [r.tables.front.travelRange[1], 0],
    droop: [r.tables.front.travelRange[0], 0],
    'lock-left': [0, lock],
    'lock-right': [0, -lock],
    'bump-lock': [r.tables.front.travelRange[1] * 0.8, lock],
    'droop-lock': [r.tables.front.travelRange[0] * 0.8, -lock],
  } as Record<string, [number, number]>;
};

function segmentDistance(p1: Vector3, q1: Vector3, p2: Vector3, q2: Vector3): number {
  const d1 = new Vector3().subVectors(q1, p1);
  const d2 = new Vector3().subVectors(q2, p2);
  const r = new Vector3().subVectors(p1, p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  let s = 0;
  let t = 0;
  const c = d1.dot(r);
  const b = d1.dot(d2);
  const denom = a * e - b * b;
  s = denom > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
  t = (b * s + f) / e;
  if (t < 0) {
    t = 0;
    s = Math.min(1, Math.max(0, -c / a));
  } else if (t > 1) {
    t = 1;
    s = Math.min(1, Math.max(0, (b - c) / a));
  }
  const c1 = new Vector3().copy(p1).addScaledVector(d1, s);
  const c2 = new Vector3().copy(p2).addScaledVector(d2, t);
  return c1.distanceTo(c2);
}


const ENV = { rb: Number(process.env.RB ?? 0.272), ro: 0.382, hw: 0.145 };
// DB11 wheel cross-section (axial outward +, radial), measured from the GLB vertices (inboard face at -0.145).
const POLY: [number, number][] = [[-0.145, 0.263], [-0.145, 0.342], [-0.125, 0.352], [-0.11, 0.364], [-0.08, 0.372], [-0.03, 0.378], [0, 0.382], [0.03, 0.378], [0.08, 0.372], [0.11, 0.364], [0.125, 0.352], [0.145, 0.342], [0.145, 0.263], [0.08, 0.29], [-0.13, 0.278], [-0.135, 0.263]];
function sdPoly(x: number, y: number): number {
  let d = Infinity; let inside = false;
  for (let i = 0, j = POLY.length - 1; i < POLY.length; j = i++) {
    const [xi, yi] = POLY[i]!; const [xj, yj] = POLY[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    const ex = xj - xi, ey = yj - yi; const t = Math.max(0, Math.min(1, ((x - xi) * ex + (y - yi) * ey) / (ex * ex + ey * ey)));
    d = Math.min(d, Math.hypot(x - xi - t * ex, y - yi - t * ey));
  }
  return inside ? -d : d;
}
function wheelGap(c: Capsule, centre: Vector3, axis: Vector3): number {
  let best = Infinity; const p = new Vector3();
  for (let i = 0; i <= 32; i++) {
    p.lerpVectors(c.a, c.b, i / 32).sub(centre);
    const ax = p.dot(axis); const rad = Math.sqrt(Math.max(0, p.lengthSq() - ax * ax));
    best = Math.min(best, sdPoly(ax, rad) - c.r);
  }
  return best;
}
function partGaps(caps: Capsule[]) { const out: [string, number][] = []; for (let i = 0; i < caps.length; i++) for (let j = i + 1; j < caps.length; j++) { const A = caps[i]!, B = caps[j]!; if (A.joints.some((n) => B.joints.includes(n))) continue; out.push([`${A.name} / ${B.name}`, segmentDistance(A.a, A.b, B.a, B.b) - A.r - B.r]); } return out; }

const rnd = (() => { let s = 12345; return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296); })();
function metricsOf(l: AxleLinkage, axle: 'front' | 'rear') {
  const { table, kinematics } = solveAxleKinematics(l, { tyreRadius: 0.382, axle, cgHeight: 0.5, wheelbase: GT_GEOMETRY.wheelbase, brakeShare: axle === 'front' ? 0.62 : 0.38, ...(axle === 'front' ? { maxSteer: MAX_STEER } : {}) });
  const s = kinematics.summary;
  return { gain: s.camberGain * RAD_TO_DEG * 0.01, rc: s.rollCentreHeight * 1000, kpi: s.kingpinInclination * RAD_TO_DEG, caster: s.caster * RAD_TO_DEG, scrub: s.scrubRadius * 1000, trail: s.trail * 1000, mr: s.motionRatio, rollC: s.rollCamber, anti: s.antiPitch * 100, bs: s.bumpSteer * RAD_TO_DEG * 0.01 };
}
it('search', () => {
  const axle = process.env.AXLE as 'front' | 'rear'; const A = axle === 'front' ? 'F' : 'R';
  const base = DEFS.find((d) => d.id === process.env.TYPE)!;
  const vary = JSON.parse(process.env.VARY!) as Record<string, [number, number, number]>; // point -> per-axis half range
  const target = metricsOf(base.axles[axle], axle);
  const gates = JSON.parse(process.env.GATES ?? '{}') as Record<string, [number, number]>;
  const fix = JSON.parse(process.env.FIX ?? '{}') as Record<string, [number, number, number]>;
  const evalDef = (pts: Record<string, readonly [number, number, number]>) => {
    const def = { ...base, axles: { ...base.axles, [axle]: { ...base.axles[axle], points: { ...base.axles[axle].points, ...fix, ...pts } } } } as typeof base;
    let m; try { m = metricsOf(def.axles[axle], axle); } catch { return null; }
    for (const [k, [lo, hi]] of Object.entries(gates)) { const v = (m as Record<string, number>)[k]!; if (!(v >= lo && v <= hi)) return { m, def, wheel: -1, parts: -1, gateFail: k }; }
    const r = rig(def); rigs.delete(def.id); const v = buildSpatialLinkage(def, VEHICLE);
    let wheel = Infinity, parts = Infinity;
    for (const [, [travel, rack]] of Object.entries(POSES(r))) { v.update(pose(r, travel, rack)); for (const [corner, info] of Object.entries(v.inspect())) { if (corner[0] !== A.toLowerCase() || corner[1] !== 'l') continue; for (const c of info.capsules) wheel = Math.min(wheel, wheelGap(c, info.wheel.centre, info.wheel.axis)); for (const [, g] of partGaps(info.capsules)) parts = Math.min(parts, g); } }
    v.dispose();
    return { m, def, wheel, parts };
  };
  const score = (e: NonNullable<ReturnType<typeof evalDef>>) => { if ('gateFail' in e) return -1e9; let dev = 0; for (const k of ['gain', 'rc', 'kpi', 'scrub', 'caster', 'mr', 'rollC']) { const sc = ({ gain: 0.05, rc: 10, kpi: 1, scrub: 5, caster: 0.5, mr: 0.03, rollC: 0.05 } as Record<string, number>)[k]!; dev += (((e.m as Record<string, number>)[k]! - (target as Record<string, number>)[k]!) / sc) ** 2; } return Math.min(e.wheel, Number(process.env.WCAP ?? 0.004)) * 1000 * 10 + Math.min(e.parts, 0.004) * 1000 * 10 - dev; };
  const cur: Record<string, [number, number, number]> = {};
  for (const k of Object.keys(vary)) cur[k] = [...(fix[k] ?? base.axles[axle].points[k]!)] as [number, number, number];
  let best = evalDef(cur)!; let bestS = score(best);
  console.log('START', JSON.stringify(best.m), best.wheel, best.parts, bestS);
  const N = Number(process.env.N ?? 300);
  for (let it = 0; it < N; it++) {
    const scale = 1 - it / N * 0.8;
    const cand: Record<string, [number, number, number]> = {};
    for (const [k, h] of Object.entries(vary)) cand[k] = cur[k]!.map((v, i) => +(v + (rnd() * 2 - 1) * h[i]! * scale * (rnd() < 0.5 ? 1 : 0.3)).toFixed(4)) as [number, number, number];
    const e = evalDef(cand); if (!e) continue; const s = score(e);
    if (s > bestS) { bestS = s; best = e; Object.assign(cur, cand); }
  }
  console.log('BEST', JSON.stringify(cur), JSON.stringify(best.m), 'wheel', (best.wheel * 1000).toFixed(1), 'parts', (best.parts * 1000).toFixed(1), 'score', bestS.toFixed(2));
  console.log('TARGET', JSON.stringify(target));
}, 600000);
