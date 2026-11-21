/**
 * GT coupe powertrain and brakes (ARCHITECTURE-M2 §7.15; research m2/06 §2). REPRESENTATIVE: the 8-speed ratios and
 * the torque shape are published facts of a V12 GT gearbox/engine used as a representative powertrain; UI copy never
 * names a manufacturer. Brake split uses the existing gtCoupe brakeShare (the same value Auto's anti-dive uses).
 */
import type { CarBrakes, CarPowertrain } from '../../contracts/vehicle';

export const gtCoupePowertrain: CarPowertrain = {
  torqueCurve: { rpm: [1000, 1250, 1600, 5000, 5500, 6000, 6500, 7000], torque: [330, 520, 700, 700, 695, 685, 657, 600] },
  idleRpm: 750,
  redlineRpm: 7000,
  frictionTorque: [40, 0.012],
  engineInertia: 0.35,
  gears: [4.714, 3.143, 2.106, 1.667, 1.285, 1.0, 0.839, 0.667],
  reverse: 3.317,
  finalDrive: 2.703,
  efficiency: 0.92,
  shift: { cut: 0.18, ramp: 0.15, lockout: 0.6 },
  upshiftRpm: [2200, 6400],
  downshiftRpm: 1300,
  limitedSlipRatio: 1.4,
  reverseSpeedCap: 7,
  reverseThrottle: 0.5,
};

export const gtCoupeBrakes: CarBrakes = { maxTorque: 7300, handbrakeTorque: 1500 };
