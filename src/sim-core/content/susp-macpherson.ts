/**
 * MacPherson strut car suspension, front + rear (rear = Chapman-style strut with a fixed toe link).
 * AXLE frame, LEFT side, metres.
 *
 * Topology from Project Chrono's ChMacPhersonStrut (BSD-3-Clause): lower A-arm (revolute to the chassis, ball joint
 * to the upright), tie rod / toe link, and a strut clamped to the upright that slides and spins in line with the
 * chassis top mount (cylindrical joint = 2 equations). Hardpoints are our own sports-car packaging for the GT coupe
 * (shared wheel centre, tyre, alignment and travel from gt-geometry.ts): long strut with a high tower top mount,
 * strut body clearing the tyre's inner sidewall, lower ball joint deep in a 20-inch wheel to keep the ground offset
 * small, which leaves the steering axis (ball joint to top mount) steeply inclined. Lower-arm pivot axes are
 * inclined in side view like the other types. Tie-rod / toe-link inner points were placed by a 2-D search so toe is
 * unchanged at +-60 mm travel. All metrics are computed by the solver.
 */
import type { AxleLinkage, CarSuspensionDefinition } from '../../contracts/suspension';
import { GT_CORNER } from './gt-geometry';

function axle(points: AxleLinkage['points'], steered: boolean, corner: typeof GT_CORNER.front | typeof GT_CORNER.rear): AxleLinkage {
  return {
    points: { wheelCentre: corner.wheelCentre, ...points },
    uprightPoints: ['wheelCentre', 'lbj', 'strutLower', 'tieRodOuter'],
    constraints: [
      { kind: 'distance', upright: 'lbj', chassis: 'lcaFront', role: 'lower-arm', member: 'lowerArm' },
      { kind: 'distance', upright: 'lbj', chassis: 'lcaRear', role: 'lower-arm', member: 'lowerArm' },
      { kind: 'distance', upright: 'tieRodOuter', chassis: 'tieRodInner', role: 'tie-rod', member: 'tieRod' },
      { kind: 'strut', upright: 'strutLower', chassis: 'strutTop' },
    ],
    ...(steered ? { steer: 'tieRodInner' } : {}),
    // Coil and damper act along the strut: spring length = top mount to strut clamp.
    spring: { upper: 'strutTop', lower: { on: 'upright', point: 'strutLower' } },
    antiRollBarMount: { member: 'lowerArm', point: 'arbPickup' },
    alignment: corner.alignment,
    travel: GT_CORNER.travel,
  };
}

export const macpherson: CarSuspensionDefinition = {
  id: 'macpherson',
  vehicleClass: 'car',
  visualKey: 'spatial-linkage',
  copy: {
    label: 'MacPherson strut',
    short: 'Strut',
    descriptor: 'Compact and light. Camber follows body roll.',
    strengths: [
      'Typically the fewest parts and the lowest cost',
      'Typically compact across the car, leaving room for the engine bay',
      'Typically light, with one large top mount that isolates well',
      'Camber control is typically good enough for short, firm travel',
    ],
    costs: [
      'Typically little camber gain in bump, so the outer tyre leans with the body',
      'Typically a higher roll centre that moves a long way as the body rolls',
      'Typically more friction from side load on the strut',
      'Typically needs a tall tower, which raises the bonnet line',
    ],
    qualitative: { cost: 'lower', packaging: 'lower', complexity: 'lower' },
  },
  axles: {
    front: axle(
      {
        lbj: [0, 0.8, 0.155],
        strutTop: [-0.085, 0.64, 0.86],
        strutLower: [-0.06, 0.665, 0.52],
        lcaFront: [0.2, 0.38, 0.182],
        lcaRear: [-0.22, 0.4, 0.2038],
        tieRodOuter: [-0.14, 0.76, 0.24],
        tieRodInner: [-0.16, 0.3367, 0.2729],
        arbPickup: [0.04, 0.64, 0.17],
      },
      true,
      GT_CORNER.front,
    ),
    rear: axle(
      {
        lbj: [0, 0.8, 0.155],
        strutTop: [-0.01, 0.64, 0.86],
        strutLower: [0, 0.665, 0.52],
        lcaFront: [0.2, 0.38, 0.198],
        lcaRear: [-0.22, 0.4, 0.1812],
        tieRodOuter: [-0.14, 0.76, 0.24],
        tieRodInner: [-0.16, 0.3152, 0.2696],
        arbPickup: [0.04, 0.64, 0.18],
      },
      false,
      GT_CORNER.rear,
    ),
  },
  extras: { damperFriction: 60, unsprungMassDelta: -2 },
};
