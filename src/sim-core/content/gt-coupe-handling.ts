/** GT coupe Manual Drive inputs (ARCHITECTURE-M2 §7.15): tyres, powertrain, brakes, steering actuator, compliance. */
import type { CarHandling } from '../../contracts/vehicle';
import { gtCoupeBrakes, gtCoupePowertrain } from './gt-coupe-powertrain';
import { gtCoupeCompliance, gtCoupeTyres } from './gt-coupe-tyres';

export const gtCoupeHandling: CarHandling = {
  tyres: gtCoupeTyres,
  powertrain: gtCoupePowertrain,
  brakes: gtCoupeBrakes,
  steering: { lag: 0.06, rate: 0.7 },
  compliance: gtCoupeCompliance,
};
