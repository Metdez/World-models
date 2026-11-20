/**
 * Double wishbone (short-long arm) car suspension, front + rear. AXLE frame, LEFT side, metres.
 *
 * Topology from Project Chrono's ChDoubleWishbone (BSD-3-Clause): lower and upper A-arms (revolute to the chassis,
 * ball joint to the upright) + tie rod / toe link. Hardpoints are our own sports-car packaging for the GT coupe
 * (shared wheel centre, tyre, alignment and travel from gt-geometry.ts): lower ball joint deep in a 20-inch wheel,
 * upper ball joint inside the top of the rim barrel, upper arm about half the lower arm length, coil-over from the
 * lower arm to the chassis between the upper arm legs. Lower-arm pivot axes are inclined in side view (front axle
 * front pivot down, rear axle front pivot up). Tie-rod / toe-link inner points were placed by a 2-D search so toe
 * is unchanged at +-30 mm travel (the usual bump-steer setup). All metrics are computed by the solver.
 */
import type { AxleLinkage, CarSuspensionDefinition } from '../../contracts/suspension';
import { GT_CORNER } from './gt-geometry';

function axle(points: AxleLinkage['points'], steered: boolean, corner: typeof GT_CORNER.front | typeof GT_CORNER.rear): AxleLinkage {
  return {
    points: { wheelCentre: corner.wheelCentre, ...points },
    uprightPoints: ['wheelCentre', 'lbj', 'ubj', 'tieRodOuter'],
    constraints: [
      { kind: 'distance', upright: 'lbj', chassis: 'lcaFront', role: 'lower-arm', member: 'lowerArm' },
      { kind: 'distance', upright: 'lbj', chassis: 'lcaRear', role: 'lower-arm', member: 'lowerArm' },
      { kind: 'distance', upright: 'ubj', chassis: 'ucaFront', role: 'upper-arm', member: 'upperArm' },
      { kind: 'distance', upright: 'ubj', chassis: 'ucaRear', role: 'upper-arm', member: 'upperArm' },
      { kind: 'distance', upright: 'tieRodOuter', chassis: 'tieRodInner', role: 'tie-rod', member: 'tieRod' },
    ],
    ...(steered ? { steer: 'tieRodInner' } : {}),
    spring: { upper: 'springTop', lower: { on: 'arm', member: 'lowerArm', point: 'springSeat' } },
    antiRollBarMount: { member: 'lowerArm', point: 'arbPickup' },
    alignment: corner.alignment,
    travel: GT_CORNER.travel,
  };
}

export const doubleWishbone: CarSuspensionDefinition = {
  id: 'double-wishbone',
  vehicleClass: 'car',
  visualKey: 'spatial-linkage',
  copy: {
    label: 'Double wishbone',
    short: 'Wishbone',
    descriptor: 'Two arms hold the wheel upright through the corner',
    strengths: [
      'Typically the strongest camber control: the outer tyre stays flatter as the body rolls',
      'Typically a low, steady roll centre',
      'Typically low damper friction, with the coil-over in line with the wheel motion',
      'Allows a low bonnet line and free choice of kingpin geometry',
    ],
    costs: [
      'Typically more parts, joints and cost than a strut',
      'Strong camber gain typically comes with more track change in bump',
      'Typically claims more width beside the engine bay',
    ],
    qualitative: { cost: 'medium', packaging: 'medium', complexity: 'medium' },
  },
  axles: {
    front: axle(
      {
        lbj: [0, 0.815, 0.165],
        ubj: [-0.045, 0.765, 0.585],
        lcaFront: [0.22, 0.37, 0.1362],
        lcaRear: [-0.2, 0.39, 0.158],
        ucaFront: [0.08, 0.52, 0.49],
        ucaRear: [-0.17, 0.53, 0.495],
        tieRodOuter: [-0.13, 0.78, 0.25],
        tieRodInner: [-0.15, 0.4332, 0.2124],
        springSeat: [-0.03, 0.7, 0.165],
        springTop: [-0.05, 0.62, 0.72],
        arbPickup: [0.04, 0.65, 0.155],
      },
      true,
      GT_CORNER.front,
    ),
    rear: axle(
      {
        lbj: [0, 0.815, 0.16],
        ubj: [0, 0.765, 0.58],
        lcaFront: [0.22, 0.38, 0.1588],
        lcaRear: [-0.2, 0.4, 0.142],
        ucaFront: [0.13, 0.53, 0.5],
        ucaRear: [-0.13, 0.53, 0.5],
        tieRodOuter: [-0.13, 0.78, 0.26],
        tieRodInner: [-0.14, 0.4333, 0.2257],
        springSeat: [0.07, 0.7, 0.17],
        springTop: [0.08, 0.62, 0.7],
        arbPickup: [0.06, 0.66, 0.16],
      },
      false,
      GT_CORNER.rear,
    ),
  },
  extras: { damperFriction: 15, unsprungMassDelta: 0 },
};
