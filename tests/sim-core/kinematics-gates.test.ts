/**
 * KIN-03/KIN-04: the shipped car suspensions, solved for the GT coupe, against the tuning gates and orderings of
 * ARCHITECTURE §7.4. Prints the full kinematics report (copied into the 02-02 SUMMARY). Every number here is an
 * output of the solver from the hardpoints; nothing is typed in.
 */
import { describe, expect, it } from 'vitest';
import type { AxleId } from '../../src/contracts/units';
import { RAD_TO_DEG } from '../../src/contracts/units';
import type { CarSuspensionDefinition } from '../../src/contracts/suspension';
import { GT_CORNER, GT_GEOMETRY } from '../../src/sim-core/content/gt-geometry';
import { doubleWishbone } from '../../src/sim-core/content/susp-double-wishbone';
import { macpherson } from '../../src/sim-core/content/susp-macpherson';
import { multilink } from '../../src/sim-core/content/susp-multilink';
import { createCornerSolution, solveAxleKinematics } from '../../src/sim-core/kinematics/table';

const DEFS = [macpherson, doubleWishbone, multilink] as const;
// GT coupe values from ARCHITECTURE §7.5 (02-04 owns the vehicle definition).
const CG_HEIGHT = 0.5;
const BRAKE_SHARE = { front: 0.62, rear: 0.38 } as const;
const MAX_STEER = 0.35;

function metrics(def: CarSuspensionDefinition, axle: AxleId) {
  const { table, kinematics } = solveAxleKinematics(def.axles[axle], {
    tyreRadius: GT_GEOMETRY[axle].tyreRadius,
    axle,
    cgHeight: CG_HEIGHT,
    wheelbase: GT_GEOMETRY.wheelbase,
    brakeShare: BRAKE_SHARE[axle],
    ...(axle === 'front' ? { maxSteer: MAX_STEER } : {}),
  });
  const s = createCornerSolution(table);
  const at = (travel: number) => {
    table.sample(travel, 0, s);
    return { camber: s.camber, toe: s.toe, cpY: s.contactPatch.y };
  };
  const d0 = at(0);
  const sum = kinematics.summary;
  return {
    camberGain10: sum.camberGain * RAD_TO_DEG * 0.01, // deg per 10 mm bump (design-point slope)
    camber25: (at(0.025).camber - d0.camber) * RAD_TO_DEG, // deg change at +25 mm
    rollCamber: sum.rollCamber, // deg of camber to road lost per deg of body roll (outer wheel)
    rc: sum.rollCentreHeight * 1000,
    rcBump30: table.rollCentreHeight(0.03, 0.03) * 1000,
    rcDroop30: table.rollCentreHeight(-0.03, -0.03) * 1000,
    rcMigration: sum.rollCentreMigration * 1000,
    bumpSteer10: sum.bumpSteer * RAD_TO_DEG * 0.01,
    toeBump70: (at(0.07).toe - d0.toe) * RAD_TO_DEG,
    toeDroop70: (at(-0.07).toe - d0.toe) * RAD_TO_DEG,
    kpi: sum.kingpinInclination * RAD_TO_DEG,
    caster: sum.caster * RAD_TO_DEG,
    scrub: sum.scrubRadius * 1000,
    trail: sum.trail * 1000,
    motionRatio: sum.motionRatio,
    trackBump30: (at(0.03).cpY - d0.cpY) * 1000,
    trackDroop30: (at(-0.03).cpY - d0.cpY) * 1000,
    antiPitch: sum.antiPitch * 100,
    rackRange: table.rackRange[1] * 1000,
  };
}

type Row = ReturnType<typeof metrics>;
const rows = new Map<string, Row>();
for (const def of DEFS) for (const axle of ['front', 'rear'] as const) rows.set(`${def.id}/${axle}`, metrics(def, axle));
const row = (id: string, axle: AxleId) => rows.get(`${id}/${axle}`)!;

const COLUMNS: [keyof Row, string, number][] = [
  ['camberGain10', 'camber gain deg/10mm', 3],
  ['camber25', 'camber @+25mm deg', 2],
  ['rollCamber', 'roll camber deg/deg', 2],
  ['rc', 'RC mm', 1],
  ['rcBump30', 'RC @+30 mm', 1],
  ['rcDroop30', 'RC @-30 mm', 1],
  ['rcMigration', 'RC lateral @2deg roll mm', 0],
  ['bumpSteer10', 'bump steer deg/10mm', 3],
  ['toeBump70', 'toe @+70mm deg', 3],
  ['toeDroop70', 'toe @-70mm deg', 3],
  ['kpi', 'KPI deg', 2],
  ['caster', 'caster deg', 2],
  ['scrub', 'scrub mm', 1],
  ['trail', 'trail mm', 1],
  ['motionRatio', 'motion ratio', 3],
  ['trackBump30', 'track chg @+30 mm', 1],
  ['trackDroop30', 'track chg @-30 mm', 1],
  ['antiPitch', 'anti-dive/squat %', 1],
  ['rackRange', 'rack range +- mm', 0],
];

describe('kinematics report', () => {
  it('prints the metric table for the six axles', () => {
    const ids = [...rows.keys()];
    const lines = [
      `| metric | ${ids.join(' | ')} |`,
      `|---|${ids.map(() => '---:').join('|')}|`,
      ...COLUMNS.map(([k, label, d]) => `| ${label} | ${ids.map((id) => rows.get(id)![k].toFixed(d)).join(' | ')} |`),
    ];
    console.info(`\n${lines.join('\n')}\n`);
    for (const r of rows.values()) for (const v of Object.values(r)) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('front axle gates (ARCHITECTURE §7.4)', () => {
  const GATES: Record<string, { rc: [number, number]; gain: [number, number]; bumpSteer: number; scrub: [number, number]; kpi: [number, number]; caster: [number, number] }> = {
    macpherson: { rc: [90, 130], gain: [-0.25, -0.1], bumpSteer: 0.08, scrub: [0, 30], kpi: [8, 14], caster: [3, 8] },
    'double-wishbone': { rc: [50, 100], gain: [-0.6, -0.3], bumpSteer: 0.05, scrub: [0, 30], kpi: [4, 10], caster: [3, 8] },
    multilink: { rc: [30, 75], gain: [-0.45, -0.2], bumpSteer: 0.05, scrub: [0, 30], kpi: [4, 12], caster: [3, 8] },
  };
  const within = (v: number, [lo, hi]: [number, number], what: string) => expect(v >= lo && v <= hi, `${what} ${v.toFixed(3)} not in [${lo}, ${hi}]`).toBe(true);
  it.each(DEFS.map((d) => d.id))('%s', (id) => {
    const r = row(id, 'front');
    const g = GATES[id]!;
    within(r.rc, g.rc, 'roll-centre height mm');
    within(r.camberGain10, g.gain, 'camber gain deg/10mm');
    expect(Math.abs(r.bumpSteer10)).toBeLessThanOrEqual(g.bumpSteer);
    within(r.scrub, g.scrub, 'scrub mm');
    within(r.kpi, g.kpi, 'KPI deg');
    within(r.caster, g.caster, 'caster deg');
  });
  it('shows the honest signature: RC MP > DW > ML, |camber gain| DW > ML > MP, roll camber MP > ML > DW', () => {
    const [mp, dw, ml] = [row('macpherson', 'front'), row('double-wishbone', 'front'), row('multilink', 'front')];
    expect(mp.rc).toBeGreaterThan(dw.rc);
    expect(dw.rc).toBeGreaterThan(ml.rc);
    expect(Math.abs(dw.camberGain10)).toBeGreaterThan(Math.abs(ml.camberGain10));
    expect(Math.abs(ml.camberGain10)).toBeGreaterThan(Math.abs(mp.camberGain10));
    expect(mp.rollCamber).toBeGreaterThan(ml.rollCamber);
    expect(ml.rollCamber).toBeGreaterThan(dw.rollCamber);
  });
});

describe('rear axle gates', () => {
  it.each(DEFS.map((d) => d.id))('%s: |bump steer| <= 0.05 deg/10mm, RC 30-130 mm', (id) => {
    const r = row(id, 'rear');
    expect(Math.abs(r.bumpSteer10)).toBeLessThanOrEqual(0.05);
    expect(r.rc).toBeGreaterThanOrEqual(30);
    expect(r.rc).toBeLessThanOrEqual(130);
  });
});

describe('definitions (KIN-04, honesty)', () => {
  it('share wheel centre, alignment and travel; only linkage and declared extras differ', () => {
    for (const def of DEFS) {
      for (const axle of ['front', 'rear'] as const) {
        const l = def.axles[axle];
        expect(l.points.wheelCentre).toEqual(GT_CORNER[axle].wheelCentre);
        expect(l.alignment).toEqual(GT_CORNER[axle].alignment);
        expect(l.travel).toEqual(GT_CORNER.travel);
      }
      expect(def.vehicleClass).toBe('car');
      expect(def.visualKey).toBe('spatial-linkage');
    }
    expect(DEFS.map((d) => [d.id, d.extras.damperFriction, d.extras.unsprungMassDelta])).toEqual([
      ['macpherson', 60, -2],
      ['double-wishbone', 15, 0],
      ['multilink', 20, 0],
    ]);
  });
  it('copy contains no digits and the descriptor fits one line', () => {
    for (const def of DEFS) {
      const { label, short, descriptor, strengths, costs } = def.copy;
      for (const text of [label, short, descriptor, ...strengths, ...costs]) expect(text, text).not.toMatch(/\d/);
      expect(descriptor.length).toBeLessThanOrEqual(60);
    }
  });
});
