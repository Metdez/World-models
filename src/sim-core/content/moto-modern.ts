/**
 * Modern preset: upside-down telescopic fork + monoshock on a rising-rate linkage (research 08 §1 preset 2).
 * Same frame, steering geometry and swingarm as the classic; only the mechanisms differ. Inputs are estimates.
 */
import type { MotorcycleSuspensionDefinition } from '../../contracts/suspension';
import { FORK_OFFSET, FORK_RAKE, HEAD_ABOVE_AXLE, REAR_AXLE, steeringPoints, SWINGARM_PIVOT } from './cafe-racer';

export const motoModern: MotorcycleSuspensionDefinition = {
  id: 'moto-modern',
  vehicleClass: 'motorcycle',
  visualKey: 'moto-planar',
  copy: {
    label: 'Modern',
    short: 'Modern',
    descriptor: 'Upside-down fork and rising-rate monoshock',
    strengths: [
      'The large tubes in the clamps typically flex less under hard braking',
      'The linkage makes the rear soft early in its travel and firm near the end',
      'Shock and linkage sit low and central in the chassis',
    ],
    costs: [
      'Same pro-dive geometry as any telescopic fork: it still dives under braking',
      'More pivots and bearings to look after, typically',
      'The linkage takes room under the swingarm and engine',
    ],
    qualitative: { cost: 'medium', packaging: 'medium', complexity: 'medium' },
  },
  front: {
    kind: 'telescopic',
    inverted: true,
    rake: FORK_RAKE,
    offset: FORK_OFFSET,
    steeringHead: steeringPoints(FORK_RAKE, FORK_OFFSET, HEAD_ABOVE_AXLE).head,
    travel: 0.12,
    spring: { rate: 20_000, preload: 450, progression: 0.3 },
    damper: { bump: 1_100, rebound: 2_100 },
    stiction: 45,
    unsprungMass: 15.5,
    stanchionDiameter: 0.043,
  },
  rear: {
    kind: 'swingarm-linkage',
    pivot: SWINGARM_PIVOT,
    axle: [REAR_AXLE[0], 0, REAR_AXLE[1]],
    rockerPivot: [-0.303, 0, 0.227],
    swingarmLink: [-0.326, 0, 0.318],
    rockerLink: [-0.353, 0, 0.253],
    rockerShock: [-0.4, 0, 0.28],
    shockTop: [-0.39, 0, 0.578],
    travel: 0.12,
    spring: { rate: 130_000, preload: 1_500, progression: 0 },
    damper: { bump: 7_000, rebound: 14_000 },
    unsprungMass: 19,
  },
};
