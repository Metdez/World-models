import { Vector3 } from 'three';
import { it } from 'vitest';
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
const empty = { track: () => undefined, vehicle: () => undefined, suspension: () => undefined };
it('clearance', () => {
  const only = process.env.TYPE;
  const ov = process.env.PTS ? JSON.parse(process.env.PTS) : {};
  for (const def0 of DEFS) {
    if (only && def0.id !== only) continue;
    const def = { ...def0, axles: { front: { ...def0.axles.front, points: { ...def0.axles.front.points, ...(ov.front ?? {}) } }, rear: { ...def0.axles.rear, points: { ...def0.axles.rear.points, ...(ov.rear ?? {}) } } } } as typeof def0;
    const r = rig(def); const v = buildSpatialLinkage(def, VEHICLE);
    const wheel = new Map<string, [number, string]>(); const parts = new Map<string, [number, string]>();
    const fmt = (m: Map<string, [number, string]>, lim: number) => [...m].filter(([, [g]]) => g < lim).sort((a, b) => a[1][0] - b[1][0]).map(([k, [g, w]]) => `${k} ${(g * 1000).toFixed(1)}@${w}`).join('; ');
    const note = (m: Map<string, [number, string]>, k: string, g: number, where: string) => { const e = m.get(k); if (!e || g < e[0]) m.set(k, [g, where]); };
    const scan = (where: string) => { for (const [corner, info] of Object.entries(v.inspect())) { const ax = corner[0] === 'f' ? 'F' : 'R'; if (corner[1] === 'r') continue;
      for (const c of info.capsules) { if (c.name.startsWith('upright') && !c.name.includes('Outer') && !c.name.includes('ubj') && !c.name.includes('strut')) {} note(wheel, `${ax} ${c.name}`, wheelGap(c, info.wheel.centre, info.wheel.axis), where); }
      for (const [p, g] of partGaps(info.capsules)) note(parts, `${ax} ${p}`, g, where); } };
    for (const [name, [travel, rack]] of Object.entries(POSES(r))) { v.update(pose(r, travel, rack)); scan(name); if (name === 'static') console.log(`${def.id} STATIC: ${fmt(wheel, 0.005)}`); }
    if (process.env.NOLAP) { console.log(`${def.id} WHEEL(poses, <5mm): ${fmt(wheel, 0.005)}`); console.log(`${def.id} PARTS(<3mm): ${fmt(parts, 0.003)}`); continue; }
    const sim = createSimulation({ catalog: { ...empty, suspension: (id: string) => (id === def.id ? def : undefined) }, trackId: 'proving-loop', vehicleId: gtCoupe.id, suspensionId: def.id });
    const sv = buildSpatialLinkage(def, gtCoupe);
    const lapW = new Map<string, [number, string]>();
    for (let i = 0; i < 48; i++) { sim.seek(i / 48 * sim.lapDuration); sv.update(sim.sample(1, 1)); for (const [corner, info] of Object.entries(sv.inspect())) for (const c of info.capsules) note(lapW, `${corner} ${c.name}`, wheelGap(c, info.wheel.centre, info.wheel.axis), `t${i}`); }
    const fmt2 = (m: Map<string, [number, string]>, lim: number) => [...m].filter(([, [g]]) => g < lim).sort((a, b) => a[1][0] - b[1][0]).map(([k, [g, w]]) => `${k} ${(g * 1000).toFixed(1)}@${w}`).join('; ');
    console.log(`${def.id} WHEEL(poses, <5mm): ${fmt(wheel, 0.005)}`);
    console.log(`${def.id} WHEEL(lap, <5mm): ${fmt(lapW, 0.005)}`);
    console.log(`${def.id} PARTS(<3mm): ${fmt(parts, 0.003)}`);
  }
}, 120000);
