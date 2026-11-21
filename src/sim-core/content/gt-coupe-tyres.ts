/**
 * GT coupe tyre slip behaviour and the shared bushing table (ARCHITECTURE-M2 §7.15; research m2/04 §10, m2/23).
 * REPRESENTATIVE model values, never manufacturer data. Peak mu, its load sensitivity and the radius are the
 * existing gtCoupe TyreParams (the same peakMu() Auto uses); these add slip stiffness, relaxation and inertia.
 * The bushing table is ONE role-based table shared by every suspension type (no per-type constant).
 */
import { DEG_TO_RAD } from '../../contracts/units';
import type { CarCompliance, TyreHandling } from '../../contracts/vehicle';

export const gtCoupeTyres: { readonly front: TyreHandling; readonly rear: TyreHandling } = {
  front: {
    corneringStiffness: 20,
    slipStiffness: 20,
    stiffnessLoadShape: 2,
    shape: 1.35,
    curvature: 0,
    camberRatio: 0.07,
    relaxationLateral: 0.6,
    relaxationLongitudinal: 0.15,
    wheelInertia: 1.2,
  },
  rear: {
    corneringStiffness: 24,
    slipStiffness: 22,
    stiffnessLoadShape: 2,
    shape: 1.35,
    curvature: 0,
    camberRatio: 0.07,
    relaxationLateral: 0.7,
    relaxationLongitudinal: 0.15,
    wheelInertia: 1.3,
  },
};

export const gtCoupeCompliance: CarCompliance = {
  bushingRates: {
    'lower-arm': 5e6,
    'upper-arm': 8e6,
    'lateral-link': 10e6,
    'trailing-link': 1.5e6,
    'tie-rod': 20e6,
    strut: 2.5e6,
  },
  maxAngle: 0.5 * DEG_TO_RAD,
  filter: 0.03,
};
