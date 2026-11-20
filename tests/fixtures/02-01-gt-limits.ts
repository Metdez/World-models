/** GT coupe driving parameters from ARCHITECTURE §7.5 (representative design values), until 02-04 ships gt-coupe.ts. */
import type { DrivingLimits } from '../../src/contracts/vehicle';

export const GT_LIMITS: DrivingLimits = { lateral: 8.3, accel: 5.0, brake: 8.5, vMax: 36 };
export const GT_DRAG_AREA = 0.65;
export const GT_MASS = 1700;
