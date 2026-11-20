/**
 * Multi-link car suspension, front + rear: five separate ball-jointed links per wheel. AXLE frame, LEFT side, metres.
 *
 * Topology seeded from Project Chrono's ChMultiLink (BSD-3-Clause: upper arm + lateral link + trailing link + tie rod),
 * with the upper arm split into two separate links so every link is a single rod. Hardpoints are our own sports-car
 * packaging for the GT coupe (shared wheel centre, tyre, alignment and travel from gt-geometry.ts):
 * - front: two short upper links mounted high beside the tyre, a transverse lower link carrying the coil-over and a
 *   lower tension link from behind; the virtual lower pivot sits deep in the wheel, so the steering axis is virtual.
 * - rear: two upper links, a forward lower link, a transverse lower spring link behind the drive shaft, a toe link.
 * Lower-link chassis points are inclined in side view like the other types. Tie-rod / toe-link inner points were
 * placed by a 2-D search so toe is unchanged at +-60 mm travel. All metrics are computed by the solver.
 */
import type { AxleLinkage, CarSuspensionDefinition, ComponentRole } from '../../contracts/suspension';
import { GT_CORNER } from './gt-geometry';

function axle(
  points: AxleLinkage['points'],
  steered: boolean,
  corner: typeof GT_CORNER.front | typeof GT_CORNER.rear,
  roles: { lowerFront: ComponentRole; lowerRear: ComponentRole },
  springLink: 'lowerFront' | 'lowerRear',
  springFraction: number,
): AxleLinkage {
  return {
    points: { wheelCentre: corner.wheelCentre, ...points },
    uprightPoints: ['wheelCentre', 'upperFrontOuter', 'upperRearOuter', 'lowerFrontOuter', 'lowerRearOuter', 'tieRodOuter'],
    constraints: [
      { kind: 'distance', upright: 'upperFrontOuter', chassis: 'upperFrontInner', role: 'upper-arm', member: 'upperFront' },
      { kind: 'distance', upright: 'upperRearOuter', chassis: 'upperRearInner', role: 'upper-arm', member: 'upperRear' },
      { kind: 'distance', upright: 'lowerFrontOuter', chassis: 'lowerFrontInner', role: roles.lowerFront, member: 'lowerFront' },
      { kind: 'distance', upright: 'lowerRearOuter', chassis: 'lowerRearInner', role: roles.lowerRear, member: 'lowerRear' },
      { kind: 'distance', upright: 'tieRodOuter', chassis: 'tieRodInner', role: 'tie-rod', member: 'tieRod' },
    ],
    ...(steered ? { steer: 'tieRodInner' } : {}),
    spring: { upper: 'springTop', lower: { on: 'link', member: springLink, fraction: springFraction } },
    antiRollBarMount: { member: springLink, point: 'arbPickup' },
    alignment: corner.alignment,
    travel: GT_CORNER.travel,
  };
}

export const multilink: CarSuspensionDefinition = {
  id: 'multilink',
  vehicleClass: 'car',
  visualKey: 'spatial-linkage',
  copy: {
    label: 'Multi-link',
    short: 'Multi-link',
    descriptor: 'Separate links, each placed on its own. Most parts.',
    strengths: [
      'Typically the most freedom to tune camber, toe and anti-dive or anti-squat separately',
      'Typically the best control of toe under load, using deliberate bushing compliance',
      'A virtual steering axis can keep the ground offset small with wide tyres',
      'Typically good isolation, with links on a subframe',
    ],
    costs: [
      'Typically the most links, joints and bushings, and the highest cost',
      'Typically the hardest layout to package and to tune',
      'Typically many bushings, whose wear changes the alignment',
    ],
    qualitative: { cost: 'higher', packaging: 'higher', complexity: 'higher' },
  },
  axles: {
    front: axle(
      {
        upperFrontInner: [0.09, 0.48, 0.61],
        upperFrontOuter: [0, 0.68, 0.68],
        upperRearInner: [-0.19, 0.5, 0.61],
        upperRearOuter: [-0.07, 0.68, 0.675],
        lowerFrontInner: [0.04, 0.37, 0.1284],
        lowerFrontOuter: [0.02, 0.8, 0.145],
        lowerRearInner: [-0.4, 0.62, 0.156],
        lowerRearOuter: [-0.04, 0.79, 0.15],
        tieRodOuter: [-0.14, 0.785, 0.24],
        tieRodInner: [-0.15, 0.4488, 0.2099],
        springTop: [-0.035, 0.58, 0.75],
        arbPickup: [0.028, 0.628, 0.138],
      },
      true,
      GT_CORNER.front,
      { lowerFront: 'lateral-link', lowerRear: 'trailing-link' },
      'lowerFront',
      0.75,
    ),
    rear: axle(
      {
        upperFrontInner: [0.12, 0.48, 0.6],
        upperFrontOuter: [0.03, 0.68, 0.68],
        upperRearInner: [-0.16, 0.5, 0.6],
        upperRearOuter: [-0.04, 0.68, 0.675],
        lowerFrontInner: [0.4, 0.62, 0.161],
        lowerFrontOuter: [0.04, 0.79, 0.15],
        lowerRearInner: [-0.12, 0.37, 0.1302],
        lowerRearOuter: [-0.09, 0.795, 0.145],
        tieRodOuter: [-0.16, 0.775, 0.27],
        tieRodInner: [-0.17, 0.4524, 0.2321],
        springTop: [-0.1, 0.62, 0.72],
        arbPickup: [-0.102, 0.625, 0.139],
      },
      false,
      GT_CORNER.rear,
      { lowerFront: 'trailing-link', lowerRear: 'lateral-link' },
      'lowerRear',
      0.8,
    ),
  },
  extras: { damperFriction: 20, unsprungMassDelta: 0 },
};
