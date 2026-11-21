/**
 * C1 (ARCHITECTURE-M2 §7.5, §11): compliance derived from our hardpoints with ONE shared role-based bushing table.
 * Properties (1/rate scaling, rigid limit, left/right mirror), gates, and the printed compliance report with the
 * +-2x bushing band (every role's rate independently x0.5 / x1 / x2).
 */
import { describe, expect, it } from 'vitest';
import type { AxleLinkage, CarSuspensionDefinition } from '../../src/contracts/suspension';
import { RAD_TO_DEG } from '../../src/contracts/units';
import type { CarCompliance } from '../../src/contracts/vehicle';
import { prepareCarSuspension } from '../../src/sim-core/car/car-model';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { gtCoupeCompliance, gtCoupeTyres } from '../../src/sim-core/content/gt-coupe-tyres';
import { doubleWishbone } from '../../src/sim-core/content/susp-double-wishbone';
import { macpherson } from '../../src/sim-core/content/susp-macpherson';
import { multilink } from '../../src/sim-core/content/susp-multilink';
import { deriveCompliance, type AxleCompliance } from '../../src/sim-core/drive/compliance';
import type { KinematicsTable } from '../../src/sim-core/kinematics/table';
import { wheelRateForRideFrequency } from '../../src/sim-core/ride/ride7dof';

const TYPES: readonly CarSuspensionDefinition[] = [macpherson, doubleWishbone, multilink];
const AXLES = ['front', 'rear'] as const;
type Axle = (typeof AXLES)[number];
const RATES = gtCoupeCompliance.bushingRates;

/** Corner wheel rate exactly as the car model's ride params (lever-rule sprung corner mass). */
function wheelRate(axle: Axle): number {
  const L = gtCoupe.wheelbase;
  const a = gtCoupe.cgToFront;
  const m = (gtCoupe.sprungMass * (axle === 'front' ? L - a : a)) / L / 2;
  const s = gtCoupe[axle];
  return wheelRateForRideFrequency(s.rideFrequency, m, s.tyre.verticalStiffness);
}
const table = (s: CarSuspensionDefinition, axle: Axle): KinematicsTable => prepareCarSuspension(gtCoupe, s)[axle].table;
const derive = (s: CarSuspensionDefinition, axle: Axle, rates: CarCompliance['bushingRates'] = RATES): AxleCompliance =>
  deriveCompliance(s.axles[axle], table(s, axle), rates, wheelRate(axle));
const scaled = (f: number): CarCompliance['bushingRates'] => Object.fromEntries(Object.entries(RATES).map(([k, v]) => [k, v! * f]));
/** Gates the shared table leaves open (§7.5: reported, never tuned per type). See the 09-01 SUMMARY. */
const REPORTED: string[] = [
  // whole-axle lateral compliance 0.06-0.28 mm/kN: only chassis-side bushes are compliant (no subframe mounts, outer
  // bushes or arm bending), so every type is stiffer than whole-car rig values; softening the shared table to reach
  // 0.6 mm/kN would push every toe coefficient 3-10x past its sourced range, so the table is NOT recalibrated to it
  'macpherson front lateral',
  'macpherson rear lateral',
  'double-wishbone front lateral',
  'double-wishbone rear lateral',
  'multilink front lateral',
  'multilink rear lateral',
  // toe 0.052-0.053 deg/kN: on the gate
  'macpherson rear fyToe',
  'double-wishbone front fyToe',
  'double-wishbone rear fyToe',
  // toe 0.147 deg/kN (toe-in, understeer) and loop gain 0.32: this geometry's toe link vs the lateral links
  'multilink rear fyToe',
  'multilink rear loop gain',
];
const KEYS = ['fyToe', 'fyCamber', 'fxToeBrake', 'fxToeDrive', 'mzToe'] as const;

/** deg per kN */
const dpk = (radPerN: number): number => radPerN * RAD_TO_DEG * 1000;
/** Per-axle lateral compliance, mm/kN (two corners in parallel). */
const axleMmPerKn = (c: AxleCompliance): number => (1e6 / c.lateralStiffness) / 2;
/** Largest cornering stiffness of the axle's tyre over load, N/rad (g-shape peak). */
function maxCAlpha(axle: Axle): number {
  const h = gtCoupeTyres[axle];
  const k = h.stiffnessLoadShape;
  return (h.corneringStiffness * gtCoupe[axle].tyre.nominalLoad) / ((2 * (1 / k)) / (1 + 1 / (k * k)));
}

function roles(l: AxleLinkage): string[] {
  return [...new Set(l.constraints.map((c) => (c.kind === 'distance' ? c.role : 'strut')))].sort();
}

describe('compliance derivation (C1)', () => {
  it('halving every rate doubles every coefficient; rates x1000 -> ~0', () => {
    for (const s of TYPES)
      for (const axle of AXLES) {
        const base = derive(s, axle);
        const half = derive(s, axle, scaled(0.5));
        const rigid = derive(s, axle, scaled(1000));
        for (const k of KEYS) {
          expect(half[k]).toBeCloseTo(2 * base[k], 15);
          expect(Math.abs(rigid[k])).toBeLessThan(Math.abs(base[k]) / 500 + 1e-15);
        }
        expect(half.lateralStiffness / base.lateralStiffness).toBeCloseTo(0.5, 9);
        // travel is locked in the derivation: the wheel rate (kept in the signature) does not enter the coefficients
        const soft = deriveCompliance(s.axles[axle], table(s, axle), RATES, wheelRate(axle) / 10);
        for (const k of KEYS) expect(soft[k]).toBe(base[k]);
      }
  });

  it('left/right mirror: the mirrored geometry with Fy toward the centre gives the same coefficients', () => {
    for (const s of TYPES)
      for (const axle of AXLES) {
        const t = table(s, axle);
        const mirrored: KinematicsTable = {
          ...t,
          sample(travel, rack, out) {
            t.sample(travel, rack, out);
            for (let i = 1; i < out.points.length; i += 3) out.points[i] = -out.points[i]!;
            (out.contactPatch as { y: number }).y = -out.contactPatch.y;
            (out.wheelCentre as { y: number }).y = -out.wheelCentre.y;
            return out;
          },
        };
        const left = derive(s, axle);
        const right = deriveCompliance(s.axles[axle], mirrored, RATES, wheelRate(axle), -1);
        for (const k of [...KEYS, 'lateralStiffness'] as const) expect(right[k]).toBeCloseTo(left[k], 12);
      }
  });

  it('one shared table: every role used by a type has a rate; a missing role is an error, not a default', () => {
    for (const s of TYPES) for (const axle of AXLES) for (const r of roles(s.axles[axle])) expect(RATES[r as keyof typeof RATES]).toBeGreaterThan(0);
    expect(() => derive(macpherson, 'front', { ...RATES, strut: undefined })).toThrow(/strut/);
  });

  it('gates and the compliance report (+-2x bushing band)', () => {
    const lines: string[] = [
      'type / axle        | fyToe deg/kN          | fyCamber deg/kN       | brake toe-in deg/kN   | fxToeDrive deg/kN     | mzToe deg/kNm | axle lat mm/kN       | loop gain',
    ];
    const violations: string[] = [];
    for (const s of TYPES)
      for (const axle of AXLES) {
        const base = derive(s, axle);
        // band: each role used by this corner independently x0.5 / x1 / x2
        const used = roles(s.axles[axle]);
        const lo: Record<string, number> = {};
        const hi: Record<string, number> = {};
        const n = 3 ** used.length;
        for (let combo = 0; combo < n; combo++) {
          const r: Record<string, number> = { ...(RATES as Record<string, number>) };
          let c = combo;
          for (const role of used) {
            r[role] = r[role]! * [0.5, 1, 2][c % 3]!;
            c = Math.floor(c / 3);
          }
          const d = derive(s, axle, r);
          const vals: Record<string, number> = { ...d, brake: -d.fxToeBrake, lat: axleMmPerKn(d) };
          for (const [k, v] of Object.entries(vals)) {
            lo[k] = Math.min(lo[k] ?? Infinity, v);
            hi[k] = Math.max(hi[k] ?? -Infinity, v);
          }
        }
        const band = (k: string, v: number, f: (x: number) => number = dpk): string =>
          `${f(v).toFixed(4)} [${f(lo[k]!).toFixed(4)}, ${f(hi[k]!).toFixed(4)}]`.padEnd(21);
        const gain = Math.abs(base.fyToe) * maxCAlpha(axle);
        const lat = axleMmPerKn(base);
        lines.push(
          `${`${s.id} ${axle}`.padEnd(18)} | ${band('fyToe', base.fyToe)} | ${band('fyCamber', base.fyCamber)} | ${band('brake', -base.fxToeBrake)} | ${band('fxToeDrive', base.fxToeDrive)} | ${dpk(base.mzToe).toFixed(4).padEnd(13)} | ${band('lat', lat, (x) => x)} | ${gain.toFixed(4)}`,
        );
        if (Math.abs(dpk(base.fyToe)) > 0.05) violations.push(`${s.id} ${axle} fyToe`);
        if (Math.abs(dpk(base.fyCamber)) > 0.4) violations.push(`${s.id} ${axle} fyCamber`);
        if (lat < 0.6 || lat > 2.6) violations.push(`${s.id} ${axle} lateral`);
        if (!(gain < 0.2)) violations.push(`${s.id} ${axle} loop gain`);
        // hard: camber gate everywhere; the toe -> slip -> Fy -> toe loop stays well below 1 over the whole band
        expect(Math.abs(dpk(hi.fyCamber!))).toBeLessThan(0.4);
        expect(Math.abs(dpk(lo.fyCamber!))).toBeLessThan(0.4);
        expect(Math.max(Math.abs(lo.fyToe!), Math.abs(hi.fyToe!)) * maxCAlpha(axle)).toBeLessThan(1);
      }
    lines.push(`wheel rates: front ${(wheelRate('front') / 1000).toFixed(2)} kN/m, rear ${(wheelRate('rear') / 1000).toFixed(2)} kN/m (travel locked in the derivation); rates ${JSON.stringify(RATES)} N/m`);
    lines.push(`gates outside (reported, never tuned per type): ${violations.length ? violations.join('; ') : 'none'}`);
    console.log(`[C1] ${lines.join('\n[C1] ')}`);
    // The shared table leaves these outside their gates (09-01 SUMMARY "compliance report"). The list is pinned so a
    // geometry or rate change that moves a type across a gate is noticed and re-reported, not silently absorbed.
    expect([...violations].sort()).toEqual([...REPORTED].sort());
  });
});
