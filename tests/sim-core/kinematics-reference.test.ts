/** KIN-01: the generic solver reproduces the Chrono-derived reference values (ARCHITECTURE §7.3). */
import { describe, expect, it } from 'vitest';
import { RAD_TO_DEG } from '../../src/contracts/units';
import { createCornerSolution, solveAxleKinematics, type SolveOptions } from '../../src/sim-core/kinematics/table';
import {
  CHRONO_GENERIC_MACPHERSON,
  CHRONO_SEDAN_DOUBLE_WISHBONE,
  CHRONO_SEDAN_MULTILINK,
  OPENSUS_DOUBLE_WISHBONE,
  type ReferenceSet,
} from '../fixtures/02-02-chrono-sets';

const ANGLE = 0.03; // deg
const LENGTH = 1; // mm
const RC = 2; // mm
// Scrub/trail note: research 03's prototype found the steer-axis point with an ill-conditioned least-squares
// solve (its point landed ~1e12 m away), so its scrub/trail digits are noise. The expected values below are an
// independent recomputation (same travel-locked axis, rank-aware least squares; DW +5.26/+10.93 mm, MP
// +103.0/+41.9 mm). Cross-check: the DW ball-joint line meets the ground at +5.6 mm scrub / +11.9 mm trail.

function solve(set: ReferenceSet, steered = true) {
  const opts: SolveOptions = { tyreRadius: set.tyreRadius, axle: 'front', cgHeight: 0.5, wheelbase: 2.776, brakeShare: 0.6, ...(steered ? { maxSteer: 0.3 } : {}) };
  const { table, kinematics } = solveAxleKinematics(set.linkage, opts);
  const s = createCornerSolution(table);
  const at = (travelMm: number) => {
    table.sample(travelMm / 1000, 0, s);
    return { camber: s.camber * RAD_TO_DEG, toe: s.toe * RAD_TO_DEG, cpY: s.contactPatch.y * 1000, wcY: s.wheelCentre.y * 1000 };
  };
  const sum = kinematics.summary;
  return {
    table,
    at,
    deg: (rad: number) => rad * RAD_TO_DEG,
    sum,
    per10mm: (radPerM: number) => radPerM * RAD_TO_DEG * 0.01,
    mm: (m: number) => m * 1000,
  };
}

const near = (actual: number, expected: number, tol: number) => expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(tol);

describe('Chrono Sedan double wishbone (R 0.3266)', () => {
  const k = solve(CHRONO_SEDAN_DOUBLE_WISHBONE);
  it('camber, toe and track over travel', () => {
    const cases: [number, number, number, number, number][] = [
      // travel mm, camber deg, toe deg, wheel-centre y mm, contact-patch y mm
      [-50, 0.8, 2.279, 788.6, 784.1],
      [-25, 0.442, 1.013, 794.4, 791.9],
      [25, -0.522, -0.791, 799.1, 802.1],
      [50, -1.129, -1.374, 798.1, 804.5],
    ];
    for (const [t, camber, toe, wcY, cpY] of cases) {
      const s = k.at(t);
      near(s.camber, camber, ANGLE);
      near(s.toe, toe, ANGLE);
      near(s.wcY, wcY, LENGTH);
      near(s.cpY, cpY, LENGTH);
    }
  });
  it('roll centre, kingpin, caster, scrub, trail', () => {
    near(k.mm(k.sum.rollCentreHeight), 161.6, RC);
    near(k.deg(k.sum.kingpinInclination), 10.01, ANGLE);
    near(k.deg(k.sum.caster), 5.32, ANGLE);
    near(k.mm(k.sum.scrubRadius), 5.26, LENGTH);
    near(k.mm(k.sum.trail), 10.93, LENGTH);
    near(k.per10mm(k.sum.camberGain), -0.193, 0.01);
    near(k.per10mm(k.sum.bumpSteer), -0.36, 0.01);
  });
});

describe('Chrono generic MacPherson (R 0.40)', () => {
  const k = solve(CHRONO_GENERIC_MACPHERSON);
  it('camber and toe over travel', () => {
    near(k.at(50).camber, -0.545, ANGLE);
    near(k.at(-50).camber, 0.889, ANGLE);
    near(k.at(50).toe, -1.782, ANGLE);
    near(k.at(-50).toe, 1.537, ANGLE);
    near(k.at(50).cpY, 1101.9, LENGTH);
    near(k.at(-50).cpY, 1090.7, LENGTH);
  });
  it('roll centre, kingpin, caster, scrub', () => {
    near(k.mm(k.sum.rollCentreHeight), 126.1, RC);
    near(k.deg(k.sum.kingpinInclination), 11.92, ANGLE);
    near(k.deg(k.sum.caster), 6.64, ANGLE);
    near(k.mm(k.sum.scrubRadius), 103.0, LENGTH);
    near(k.mm(k.sum.trail), 41.9, LENGTH);
  });
});

describe('Chrono Sedan multi-link (R 0.3266)', () => {
  const k = solve(CHRONO_SEDAN_MULTILINK, false);
  it('camber over travel, low bump steer', () => {
    near(k.at(25).camber, -0.838, ANGLE);
    near(k.at(50).camber, -1.851, ANGLE);
    near(k.at(-50).camber, 1.198, ANGLE);
    near(k.at(50).toe, 0.126, ANGLE);
    near(k.at(-50).toe, -0.117, ANGLE);
    near(k.per10mm(k.sum.bumpSteer), 0.02, 0.01);
  });
  it('roll centre', () => {
    near(k.mm(k.sum.rollCentreHeight), 38.7, RC);
  });
});

describe('opensus double wishbone (expected values only)', () => {
  const k = solve(OPENSUS_DOUBLE_WISHBONE);
  it('camber gain, roll centre, kingpin, caster, scrub, bump steer', () => {
    // Published secant over +-10 mm.
    near((k.at(10).camber - k.at(-10).camber) / 2, -0.317, 0.01);
    near(k.mm(k.sum.rollCentreHeight), 89.9, RC);
    near(k.deg(k.sum.kingpinInclination), 5.19, ANGLE);
    // opensus quotes the ball-joint line (5.19 deg); the solver's steering axis is the travel-locked
    // instantaneous axis (one definition for every layout, virtual kingpins included): recomputed 5.04 deg.
    near(k.deg(k.sum.caster), 5.037, ANGLE);
    near(k.deg(k.sum.caster), 5.19, 0.2);
    near(k.mm(k.sum.scrubRadius), 39.1, LENGTH);
    near(k.per10mm(k.sum.bumpSteer), 0, 0.01);
  });
});
