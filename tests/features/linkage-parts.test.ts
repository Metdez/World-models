/**
 * `spatial-linkage` visual against the real kinematics: frames are filled from the 02-02 lookup tables (left corner
 * = sample(travel, rack), right = mirror of sample(travel, -rack)) exactly as the CornerFrame contract lays them out.
 * Checks: builds for every shipped car suspension, no NaN, rigid links keep their length, the spring keeps a
 * constant wire radius, update allocates nothing, and parts do not interpenetrate (each other or a tyre/rim proxy)
 * at static, full bump, full droop and full lock.
 */
import { Matrix4, Mesh, Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { CarSuspensionDefinition, ComponentRole } from '../../src/contracts/suspension';
import { CAR_CORNERS, type AxleId } from '../../src/contracts/units';
import { createTelemetryFrame, type TelemetryFrame } from '../../src/contracts/telemetry';
import type { CarDefinition } from '../../src/contracts/vehicle';
import { GT_GEOMETRY } from '../../src/sim-core/content/gt-geometry';
import { doubleWishbone } from '../../src/sim-core/content/susp-double-wishbone';
import { macpherson } from '../../src/sim-core/content/susp-macpherson';
import { multilink } from '../../src/sim-core/content/susp-multilink';
import { createCornerSolution, solveAxleKinematics, type CornerSolution, type KinematicsTable } from '../../src/sim-core/kinematics/table';
import linkageParts from '../../src/features/linkage-parts/index';
import { buildSpatialLinkage, VISUAL_ID, type SpatialLinkageVisual } from '../../src/features/linkage-parts/visual';
import type { Capsule } from '../../src/features/linkage-parts/corner';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { createSimulation } from '../../src/sim-core/index';
import type { SimCatalog } from '../../src/contracts/sim';

const DEFS = [macpherson, doubleWishbone, multilink] as const;
const MAX_STEER = 0.35;

// Representative GT coupe (ARCHITECTURE §7.5) until 02-04's gt-coupe.ts lands; only geometry fields matter here.
const tyre = { radius: 0.382, width: 0.255, verticalStiffness: 300000, verticalDamping: 500, mu: 1.1, loadSensitivity: -0.00002, nominalLoad: 4000 };
const axleSpec = { track: 1.694, unsprungMass: 45, rideFrequency: 1.5, damping: { bump: 0.3, rebound: 0.45 }, antiRollStiffness: 30000, tyre, steered: true, driven: false, brakeShare: 0.62 };
export const VEHICLE: CarDefinition = {
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

/** Smallest clearance between capsules that share no joint (negative = interpenetration). */
function clearances(caps: Capsule[]): { pair: string; gap: number }[] {
  const out: { pair: string; gap: number }[] = [];
  for (let i = 0; i < caps.length; i++)
    for (let j = i + 1; j < caps.length; j++) {
      const A = caps[i]!;
      const B = caps[j]!;
      if (A.joints.some((n) => B.joints.includes(n))) continue;
      out.push({ pair: `${A.name} / ${B.name}`, gap: segmentDistance(A.a, A.b, B.a, B.b) - A.r - B.r });
    }
  return out;
}

/** Tyre + rim barrel proxy: solid annulus radial [rimInner, tyre], axial +-halfWidth around the wheel centre. */
const TYRE = { rimInner: 0.245, radius: 0.382, halfWidth: 0.125 };
function tyreClearance(c: Capsule, centre: Vector3, axis: Vector3): number {
  let best = Infinity;
  const p = new Vector3();
  for (let i = 0; i <= 16; i++) {
    p.lerpVectors(c.a, c.b, i / 16).sub(centre);
    const ax = p.dot(axis);
    const rad = Math.sqrt(Math.max(0, p.lengthSq() - ax * ax));
    // Signed distance to the box |ax| <= hw, rimInner <= rad <= radius in the (axial, radial) plane.
    const dx = Math.abs(ax) - TYRE.halfWidth;
    const dy = Math.max(TYRE.rimInner - rad, rad - TYRE.radius);
    const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
    const inside = Math.min(Math.max(dx, dy), 0);
    best = Math.min(best, outside + inside - c.r);
  }
  return best;
}

const build = (def: CarSuspensionDefinition) => buildSpatialLinkage(def, VEHICLE);

describe('linkage-parts feature', () => {
  it('contributes the spatial-linkage suspension visual', () => {
    const registered: string[] = [];
    linkageParts.contribute?.({ suspensionVisuals: { register: (d: { id: string }) => (registered.push(d.id), () => {}) } } as never);
    expect(registered).toEqual([VISUAL_ID]);
    for (const def of DEFS) expect(def.visualKey).toBe(VISUAL_ID);
  });

  it('rejects motorcycle definitions', () => {
    expect(() => buildSpatialLinkage({ ...macpherson, vehicleClass: 'motorcycle' } as never, VEHICLE)).toThrow(/car suspensions only/);
  });
});

describe.each(DEFS.map((d) => [d.id, d] as const))('spatial-linkage: %s', (_id, def) => {
  const r = rig(def);
  const v: SpatialLinkageVisual = build(def);

  it('stays hidden until the frame carries its points, then shows all four corners', () => {
    const fresh = build(def);
    const empty = createTelemetryFrame('car', r.frame.corners);
    fresh.update(empty);
    expect(Object.values(fresh.inspect()).map((c) => c.visible)).toEqual([false, false, false, false]);
    fresh.update(pose(r, 0, 0));
    expect(Object.values(fresh.inspect()).map((c) => c.visible)).toEqual([true, true, true, true]);
    fresh.dispose();
  });

  it('has the expected part count per type (5 rods for the multi-link, 2 A-arms for the wishbone, strut for MacPherson)', () => {
    v.update(pose(r, 0, 0));
    const names = v.inspect().fl!.capsules.map((c) => c.name);
    const arms = names.filter((n) => n.endsWith('.front')).length;
    const rods = names.filter((n) => !n.includes('.') && !['damper', 'spring', 'rod', 'gaiter'].includes(n));
    if (def.id === 'macpherson') expect([arms, rods.length]).toEqual([1, 1]);
    if (def.id === 'double-wishbone') expect([arms, rods.length]).toEqual([2, 1]);
    if (def.id === 'multilink') expect([arms, rods.length]).toEqual([0, 5]);
    expect(names).toContain('spring');
    expect(names).toContain('arb.link');
    expect(names.includes('gaiter')).toBe(true);
  });

  it('poses every corner without NaN and keeps rigid links at their length', () => {
    const lengths = new Map<string, number>();
    for (const [name, [travel, rack]] of Object.entries(POSES(r))) {
      v.update(pose(r, travel, rack, 1.3));
      v.root.updateMatrixWorld(true);
      v.root.traverse((o: Object3D) => {
        for (const e of o.matrixWorld.elements) expect(Number.isFinite(e), `${name} ${o.name}`).toBe(true);
      });
      for (const [corner, info] of Object.entries(v.inspect())) {
        for (const c of info.capsules) {
          if (c.name.startsWith('upright') || c.name.startsWith('seat') || ['damper', 'spring', 'rod', 'gaiter'].includes(c.name)) continue;
          const key = `${corner}:${c.name}`;
          const len = c.a.distanceTo(c.b);
          if (!lengths.has(key)) lengths.set(key, len);
          expect(len, `${key} at ${name}`).toBeCloseTo(lengths.get(key)!, 3);
        }
      }
    }
  });

  it('mirrors the right side and steers both front wheels the same way', () => {
    v.update(pose(r, 0.03, 0));
    const w = v.inspect();
    expect(w.fr!.wheel.centre.z).toBeCloseTo(-w.fl!.wheel.centre.z, 6);
    expect(w.fr!.wheel.axis.z).toBeCloseTo(-w.fl!.wheel.axis.z, 6);
    v.update(pose(r, 0, r.tables.front.rackRange[1]));
    const s = v.inspect();
    // Steering left: both wheels' forward direction (axle x up) turns toward +sim y = -three z.
    const heading = (axis: Vector3, side: number) => new Vector3().crossVectors(new Vector3(0, 1, 0), axis.clone().multiplyScalar(side));
    expect(heading(s.fl!.wheel.axis, 1).z).toBeLessThan(-0.2);
    expect(heading(s.fr!.wheel.axis, -1).z).toBeLessThan(-0.2);
  });

  it('parts do not interpenetrate each other at static, bump, droop and lock (tyre/rim proxy reported)', () => {
    const report: string[] = [];
    const tyreReport: string[] = [];
    let worst = Infinity;
    let worstTyre = Infinity;
    for (const [name, [travel, rack]] of Object.entries(POSES(r))) {
      v.update(pose(r, travel, rack));
      for (const [corner, info] of Object.entries(v.inspect())) {
        for (const { pair, gap } of clearances(info.capsules)) {
          worst = Math.min(worst, gap);
          if (gap < 0) report.push(`${name} ${corner} ${pair} ${(gap * 1000).toFixed(1)} mm`);
        }
        for (const c of info.capsules) {
          if (c.name.startsWith('upright')) continue;
          const gap = tyreClearance(c, info.wheel.centre, info.wheel.axis);
          worstTyre = Math.min(worstTyre, gap);
          if (gap < 0) tyreReport.push(`${name} ${corner} ${c.name} ${(gap * 1000).toFixed(0)}`);
        }
      }
    }
    console.log(`${def.id}: min part clearance ${(worst * 1000).toFixed(1)} mm, min tyre/rim-proxy clearance ${(worstTyre * 1000).toFixed(1)} mm`);
    if (tyreReport.length) console.log(`${def.id} tyre/rim proxy overlaps (mm): ${tyreReport.join('; ')}`);
    expect(report).toEqual([]);
  });

  it('update allocates nothing', () => {
    const gc = (globalThis as { gc?: () => void }).gc;
    if (!gc) return;
    const frames = [pose(r, 0.05, 0.01)];
    for (let i = 0; i < 2000; i++) v.update(frames[0]!);
    gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 20000; i++) v.update(frames[0]!);
    gc();
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(64 * 1024);
  });

  it('highlights a role on one corner or all corners via emissive only', () => {
    const fl = v.root.getObjectByName('fl')!;
    const fr = v.root.getObjectByName('fr')!;
    const emissive = (g: Object3D, role: ComponentRole) => {
      let found = -1;
      g.traverse((o) => {
        const m = (o as Mesh).material as { name?: string; emissiveIntensity?: number } | undefined;
        if (m && m.name === `part:${role}`) found = Math.max(found, m.emissiveIntensity ?? 0);
      });
      return found;
    };
    const role: ComponentRole = def.id === 'macpherson' ? 'damper' : 'upper-arm';
    const shown: ComponentRole = def.id === 'macpherson' ? 'strut' : 'upper-arm';
    v.setHighlight(role, 'fl', true);
    expect(emissive(fl, shown)).toBeGreaterThan(0);
    expect(emissive(fr, shown)).toBe(0);
    v.setHighlight(role, 'all', false);
    expect(emissive(fl, shown)).toBe(0);
  });

  it('stays inside the draw-call budget (ARCHITECTURE §18: car + suspension <= 90)', () => {
    v.update(pose(r, 0, 0));
    let draws = 0;
    v.root.traverseVisible((o) => {
      if ((o as Mesh).isMesh) draws++;
    });
    console.log(`${def.id}: ${draws} draw calls`);
    expect(draws).toBeLessThanOrEqual(60);
  });

  it('upright follows the 3-point frame exactly', () => {
    v.update(pose(r, 0.04, 0.02));
    const up = v.root.getObjectByName('fl')!.getObjectByName('upright')!;
    const m = new Matrix4().copy(up.matrix);
    // A rigid transform: orthonormal rotation part.
    const e = m.elements;
    const cols = [0, 4, 8].map((o) => new Vector3(e[o], e[o + 1], e[o + 2]));
    for (const c of cols) expect(c.length()).toBeCloseTo(1, 9);
    expect(cols[0]!.dot(cols[1]!)).toBeCloseTo(0, 9);
    expect(m.determinant()).toBeCloseTo(1, 9);
  });
});

describe('spatial-linkage on the live simulation (02-04 CornerFrame points, amplified x3)', () => {
  const catalog: SimCatalog = { track: () => undefined, vehicle: () => undefined, suspension: () => undefined };
  it.each(DEFS.map((d) => [d.id, d] as const))('%s: follows a whole lap without NaN, stretched links or new clearance problems', (_id, def) => {
    const sim = createSimulation({ catalog, trackId: 'proving-loop', vehicleId: gtCoupe.id, suspensionId: def.id });
    const v = buildSpatialLinkage(def, gtCoupe);
    const lengths = new Map<string, number>();
    const problems: string[] = [];
    let worst = 0;
    for (let i = 0; i < 24; i++) {
      sim.seek((i / 24) * sim.lapDuration);
      v.update(sim.sample(1, 3));
      for (const [corner, info] of Object.entries(v.inspect())) {
        expect(info.visible, corner).toBe(true);
        for (const c of info.capsules) {
          expect(Number.isFinite(c.a.x + c.a.y + c.a.z + c.b.x + c.b.y + c.b.z), c.name).toBe(true);
          if (c.name.startsWith('upright') || c.name.startsWith('seat') || ['damper', 'spring', 'rod', 'gaiter'].includes(c.name)) continue;
          const key = `${corner}:${c.name}`;
          const len = c.a.distanceTo(c.b);
          if (!lengths.has(key)) lengths.set(key, len);
          expect(Math.abs(len - lengths.get(key)!), key).toBeLessThan(1e-4);
        }
        for (const { pair, gap } of clearances(info.capsules)) {
          if (gap < 0) problems.push(`t${i} ${corner} ${pair} ${(gap * 1000).toFixed(1)} mm`);
          worst = Math.min(worst, gap);
        }
      }
    }
    expect(problems).toEqual([]);
    v.dispose();
  });

  it.each(DEFS.map((d) => [d.id, d] as const))('%s: the hub axle (disc, caliper, inspect axis) matches the sim wheel axis', (_id, def) => {
    const sim = createSimulation({ catalog, trackId: 'proving-loop', vehicleId: gtCoupe.id, suspensionId: def.id });
    const v = buildSpatialLinkage(def, gtCoupe);
    const expected = new Vector3();
    let worst = 0;
    for (const at of [0, 0.25, 0.5, 0.75]) {
      sim.seek(at * sim.lapDuration);
      const f = sim.sample(1);
      v.update(f);
      const info = v.inspect();
      for (const c of f.corners) {
        // Outward spin axis in the sim frame = side * q (0, 1, 0); sim (x, y, z) -> three (x, z, -y).
        const q = c.wheelRotation;
        const ax = 2 * (q.x * q.y - q.w * q.z);
        const ay = 1 - 2 * (q.x * q.x + q.z * q.z);
        const az = 2 * (q.y * q.z + q.w * q.x);
        expected.set(ax, az, -ay).multiplyScalar(c.side);
        worst = Math.max(worst, info[c.id]!.wheel.axis.angleTo(expected));
      }
    }
    // Static camber is 1.5 deg front / 1.2 deg rear: the old sign error showed as 2 x camber (>= 2.4 deg).
    expect(worst * (180 / Math.PI)).toBeLessThan(0.1);
    v.dispose();
  });
});
