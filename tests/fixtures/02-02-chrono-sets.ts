/**
 * Reference hardpoint sets for the kinematics regression (ARCHITECTURE §7.3), LEFT side, metres, X fwd / Y left /
 * Z up, each in its own source origin (ground = wheel-centre z - tyre radius).
 *
 * Project Chrono data (BSD-3-Clause, Copyright (c) 2016, Project Chrono Development Team):
 *   data/vehicle/sedan/suspension/Sedan_DoubleWishbone.json, data/vehicle/generic/suspension/MacPhersonStrut.json,
 *   data/vehicle/sedan/suspension/Sedan_MultiLink.json (topology per ChDoubleWishbone/ChMacPhersonStrut/ChMultiLink).
 * Expected values: research 03 §5, reproduced by the researcher's independent prototype (unrounded where §7.3 rounds).
 * opensus sample: published expected values only (its licence is unverified, so only the numbers are used).
 */
import type { AxleLinkage } from '../../src/contracts/suspension';

export interface ReferenceSet {
  readonly linkage: AxleLinkage;
  readonly tyreRadius: number;
}

const ZERO_ALIGNMENT = { camber: 0, toe: 0 } as const;
const TRAVEL = { bump: 0.05, droop: 0.05 } as const;

export const CHRONO_SEDAN_DOUBLE_WISHBONE: ReferenceSet = {
  tyreRadius: 0.3266,
  linkage: {
    points: {
      wheelCentre: [0, 0.7979, -0.1199],
      ucaFront: [-0.1, 0.47, 0.105],
      ucaBack: [-0.25, 0.51, 0.11],
      ubj: [-0.04, 0.695, 0.105],
      lcaFront: [0.2, 0.42, -0.27],
      lcaBack: [-0.2, 0.47, -0.265],
      lbj: [0, 0.77, -0.32],
      tieRodInner: [-0.2, 0.42, -0.12],
      tieRodOuter: [-0.15, 0.77, -0.12],
      shockTop: [-0.04, 0.52, 0.23],
      shockArm: [0, 0.62, -0.27],
    },
    uprightPoints: ['wheelCentre', 'ubj', 'lbj', 'tieRodOuter'],
    constraints: [
      { kind: 'distance', upright: 'lbj', chassis: 'lcaFront', role: 'lower-arm', member: 'lca' },
      { kind: 'distance', upright: 'lbj', chassis: 'lcaBack', role: 'lower-arm', member: 'lca' },
      { kind: 'distance', upright: 'ubj', chassis: 'ucaFront', role: 'upper-arm', member: 'uca' },
      { kind: 'distance', upright: 'ubj', chassis: 'ucaBack', role: 'upper-arm', member: 'uca' },
      { kind: 'distance', upright: 'tieRodOuter', chassis: 'tieRodInner', role: 'tie-rod', member: 'tieRod' },
    ],
    steer: 'tieRodInner',
    spring: { upper: 'shockTop', lower: { on: 'arm', member: 'lca', point: 'shockArm' } },
    alignment: ZERO_ALIGNMENT,
    travel: TRAVEL,
  },
};

export const CHRONO_GENERIC_MACPHERSON: ReferenceSet = {
  tyreRadius: 0.4,
  linkage: {
    points: {
      wheelCentre: [-0.04, 1.1, -0.026],
      lcaFront: [0.22, 0.52, -0.156],
      lcaBack: [-0.3, 0.507, -0.137],
      lbj: [-0.02165371, 0.94057703, -0.17402826],
      tieRodInner: [-0.3, 0.52, -0.059],
      tieRodOuter: [-0.2373756, 0.89495045, -0.01605418],
      strutTop: [-0.115, 0.785, 0.579],
      strutLower: [-0.07402507, 0.8532915, 0.2484536],
    },
    uprightPoints: ['wheelCentre', 'lbj', 'tieRodOuter', 'strutLower'],
    constraints: [
      { kind: 'distance', upright: 'lbj', chassis: 'lcaFront', role: 'lower-arm', member: 'lca' },
      { kind: 'distance', upright: 'lbj', chassis: 'lcaBack', role: 'lower-arm', member: 'lca' },
      { kind: 'distance', upright: 'tieRodOuter', chassis: 'tieRodInner', role: 'tie-rod', member: 'tieRod' },
      { kind: 'strut', upright: 'strutLower', chassis: 'strutTop' },
    ],
    steer: 'tieRodInner',
    spring: { upper: 'strutTop', lower: { on: 'upright', point: 'strutLower' } },
    alignment: ZERO_ALIGNMENT,
    travel: TRAVEL,
  },
};

export const CHRONO_SEDAN_MULTILINK: ReferenceSet = {
  tyreRadius: 0.3266,
  linkage: {
    points: {
      wheelCentre: [0, 0.8, 0],
      uaFront: [0.06, 0.397, 0.082],
      uaBack: [-0.157, 0.358, 0.062],
      uaOuter: [0.056, 0.714, 0.151],
      latInner: [0.036, 0.188, -0.133],
      latOuter: [0.029, 0.692, -0.093],
      tlInner: [0.723, 0.449, -0.072],
      tlOuter: [0, 0.714, -0.156],
      toeInner: [-0.257, 0.17, -0.116],
      toeOuter: [-0.144, 0.712, -0.056],
      springTop: [0.181, 0.491, 0.11],
      springLink: [0.181, 0.419, -0.164],
    },
    uprightPoints: ['wheelCentre', 'uaOuter', 'latOuter', 'tlOuter', 'toeOuter'],
    constraints: [
      { kind: 'distance', upright: 'uaOuter', chassis: 'uaFront', role: 'upper-arm', member: 'upperArm' },
      { kind: 'distance', upright: 'uaOuter', chassis: 'uaBack', role: 'upper-arm', member: 'upperArm' },
      { kind: 'distance', upright: 'latOuter', chassis: 'latInner', role: 'lateral-link', member: 'lateral' },
      { kind: 'distance', upright: 'tlOuter', chassis: 'tlInner', role: 'trailing-link', member: 'trailing' },
      { kind: 'distance', upright: 'toeOuter', chassis: 'toeInner', role: 'tie-rod', member: 'toeLink' },
    ],
    spring: { upper: 'springTop', lower: { on: 'arm', member: 'trailing', point: 'springLink' } },
    alignment: ZERO_ALIGNMENT,
    travel: TRAVEL,
  },
};

/** opensus double-wishbone example (mm in the source), ground at z = 0, tyre radius = wheel-centre height. */
export const OPENSUS_DOUBLE_WISHBONE: ReferenceSet = {
  tyreRadius: 0.228,
  linkage: {
    points: {
      wheelCentre: [0, 0.6, 0.228],
      ucaFront: [0.1, 0.28, 0.33],
      ucaBack: [-0.1, 0.28, 0.33],
      ubj: [-0.015, 0.53, 0.34],
      lcaFront: [0.1, 0.2, 0.15],
      lcaBack: [-0.1, 0.2, 0.15],
      lbj: [0.005, 0.55, 0.12],
      tieRodInner: [-0.07, 0.2, 0.15],
      tieRodOuter: [-0.07, 0.55, 0.12],
    },
    uprightPoints: ['wheelCentre', 'ubj', 'lbj', 'tieRodOuter'],
    constraints: [
      { kind: 'distance', upright: 'lbj', chassis: 'lcaFront', role: 'lower-arm', member: 'lca' },
      { kind: 'distance', upright: 'lbj', chassis: 'lcaBack', role: 'lower-arm', member: 'lca' },
      { kind: 'distance', upright: 'ubj', chassis: 'ucaFront', role: 'upper-arm', member: 'uca' },
      { kind: 'distance', upright: 'ubj', chassis: 'ucaBack', role: 'upper-arm', member: 'uca' },
      { kind: 'distance', upright: 'tieRodOuter', chassis: 'tieRodInner', role: 'tie-rod', member: 'tieRod' },
    ],
    steer: 'tieRodInner',
    // The sample has no spring; a pushrod-like stand-in on the upright keeps the definition complete.
    spring: { upper: 'ucaFront', lower: { on: 'upright', point: 'lbj' } },
    alignment: ZERO_ALIGNMENT,
    travel: TRAVEL,
  },
};
