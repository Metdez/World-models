/**
 * Powertrain and gearbox (ARCHITECTURE-M2 §7.7; research m2/06 §2–§4). v0 (08-02); 09-02 owns the full version.
 * Engine torque from the full-throttle curve at an rpm floored by a converter-like stall speed in 1st/reverse (launch
 * without creep at zero throttle), closed-throttle engine braking a + b*rpm, rev limiter; automatic gearbox whose
 * shift state machine (cut, ramp back, lockout; up/down/kick-down thresholds) follows the shape of Jolt Physics'
 * VehicleTransmission (MIT, Jorrit Rouwe; ideas re-expressed, no code copied); limited-slip split with the Jolt
 * differential's speed-ratio formula; traction scale (aids.traction) on the driven wheels' slip speed.
 */
import type { DriveAids } from '../../contracts/drive';
import type { CarPowertrain } from '../../contracts/vehicle';

export interface PowertrainIo {
  throttle: number;
  direction: 1 | -1;
  /** u, m/s. */
  speed: number;
  /** Driven wheels' spin, rad/s. */
  omegaL: number;
  omegaR: number;
  /** Max slip ratio of the driven wheels (previous step). */
  driveSlip: number;
  /** Max slip SPEED R*omega - vx of the driven wheels, m/s (traction aid; v0 addition to the §7.1 shape). */
  slipSpeed: number;
  /** Out: N m at each driven wheel (+ drives forward). */
  torqueL: number;
  torqueR: number;
  /** Out: effective rotating inertia per driven wheel (wheel + reflected engine), kg m^2. */
  inertia: number;
  gear: number;
  engineRpm: number;
  tractionActive: boolean;
}

export interface Powertrain {
  reset(speed: number, direction: 1 | -1): void;
  step(dt: number, io: PowertrainIo, aids: DriveAids): void;
}

export const createPowertrainIo = (): PowertrainIo => ({
  throttle: 0,
  direction: 1,
  speed: 0,
  omegaL: 0,
  omegaR: 0,
  driveSlip: 0,
  slipSpeed: 0,
  torqueL: 0,
  torqueR: 0,
  inertia: 0,
  gear: 1,
  engineRpm: 0,
  tractionActive: false,
});

/** Converter-like launch: the torque lookup rpm is floored at idle + (STALL - idle) * throttle in 1st and reverse. */
const STALL_RPM = 2200;
const RAD_S_TO_RPM = 60 / (2 * Math.PI);
const TCS_TAU = 0.06;

/** Persistent state (snapshot-friendly): gear, clutch, timers, rpm, traction scale. */
const GEAR = 0;
const CLUTCH = 1;
const CUT = 2;
const RAMP = 3;
const LOCK = 4;
const RPM = 5;
const TCS = 6;
export const POWERTRAIN_STATE_LENGTH = 7;

export function createPowertrain(p: CarPowertrain, radius: number, wheelInertia: number): Powertrain & { readonly state: Float64Array } {
  const n = p.gears.length;
  const st = new Float64Array(POWERTRAIN_STATE_LENGTH);
  const ratio = (g: number): number => (g < 0 ? p.reverse * p.finalDrive : p.gears[g - 1]! * p.finalDrive);
  const curve = p.torqueCurve;
  function torqueAt(rpm: number): number {
    const xs = curve.rpm;
    const ys = curve.torque;
    if (rpm <= xs[0]!) return ys[0]!;
    for (let k = 1; k < xs.length; k++) {
      if (rpm <= xs[k]!) {
        const t = (rpm - xs[k - 1]!) / (xs[k]! - xs[k - 1]!);
        return ys[k - 1]! + (ys[k]! - ys[k - 1]!) * t;
      }
    }
    return ys[ys.length - 1]!;
  }
  /** Engine rpm the gear g would run at road speed u (no slip). */
  const rpmIdeal = (u: number, g: number): number => (Math.abs(u) / radius) * ratio(g) * RAD_S_TO_RPM;

  function shift(to: number): void {
    st[GEAR] = to;
    st[CLUTCH] = 0;
    st[CUT] = p.shift.cut;
    st[RAMP] = p.shift.ramp;
    st[LOCK] = p.shift.lockout;
  }

  return {
    state: st,
    reset(speed, direction) {
      let g = 1;
      if (direction < 0) g = -1;
      else for (g = 1; g < n && rpmIdeal(speed, g) > p.upshiftRpm[0]; g++);
      st[GEAR] = g;
      st[CLUTCH] = 1;
      st[CUT] = 0;
      st[RAMP] = 0;
      st[LOCK] = 0;
      st[RPM] = Math.max(p.idleRpm, rpmIdeal(speed, g));
      st[TCS] = 1;
    },
    step(dt, io, aids) {
      let g = st[GEAR]!;
      // Direction change selects 1st or reverse (through a shift cut).
      if ((io.direction < 0) !== (g < 0)) shift(io.direction < 0 ? -1 : 1);
      g = st[GEAR]!;
      // Clutch: cut, then a linear ramp back; lockout runs from the shift.
      if (st[CUT]! > 0) {
        st[CUT] = Math.max(0, st[CUT]! - dt);
        st[CLUTCH] = 0;
      } else if (st[RAMP]! > 0) {
        st[RAMP] = Math.max(0, st[RAMP]! - dt);
        st[CLUTCH] = p.shift.ramp > 0 ? 1 - st[RAMP]! / p.shift.ramp : 1;
      } else st[CLUTCH] = 1;
      if (st[LOCK]! > 0) st[LOCK] = Math.max(0, st[LOCK]! - dt);

      // Automatic gearbox (forward gears only).
      if (g > 0 && st[LOCK] === 0) {
        const up = p.upshiftRpm[0] + (p.upshiftRpm[1] - p.upshiftRpm[0]) * Math.min(1, Math.max(0, io.throttle));
        const rpmNow = rpmIdeal(io.speed, g);
        if (g < n && rpmNow > up && io.driveSlip < 0.1) shift(g + 1);
        else if (g > 1 && (rpmNow < p.downshiftRpm || (io.throttle > 0.9 && rpmIdeal(io.speed, g - 1) < 0.92 * p.redlineRpm))) shift(g - 1);
        g = st[GEAR]!;
      }

      const r = ratio(g);
      const dir = g < 0 ? -1 : 1;
      const clutch = st[CLUTCH]!;
      const rpmWheel = ((io.omegaL + io.omegaR) / 2) * r * dir * RAD_S_TO_RPM;
      const rpm = Math.max(p.idleRpm, rpmWheel);
      st[RPM] = rpm;

      // Traction scale (aids.traction): slip speed above 1.5 m/s cuts throttle, first-order 0.06 s.
      const target = aids.traction ? Math.min(1, Math.max(0.15, 1 - (io.slipSpeed - 1.5) / 2.5)) : 1;
      st[TCS] = st[TCS]! + (target - st[TCS]!) * Math.min(1, dt / TCS_TAU);
      const tcs = st[TCS]!;

      const throttle = io.throttle * (g < 0 ? p.reverseThrottle : 1);
      let te = 0;
      if (io.throttle >= 0.05) {
        const launch = g === 1 || g < 0 ? p.idleRpm + (STALL_RPM - p.idleRpm) * io.throttle : 0;
        te = torqueAt(Math.max(rpm, launch)) * throttle * tcs * clutch;
      } else if (rpmWheel > p.idleRpm + 200) te = -(p.frictionTorque[0] + p.frictionTorque[1] * rpmWheel) * clutch;
      if (rpm >= p.redlineRpm) te = Math.min(te, 0);
      if (g < 0 && -io.speed >= p.reverseSpeedCap) te = Math.min(te, 0);

      const axle = dir * te * r * p.efficiency;
      // Limited slip (Jolt form): alpha = min((w_max / w_min - 1) / (LSR - 1), 1); the slower wheel gets more.
      const wl = Math.max(1e-3, Math.abs(io.omegaL));
      const wr = Math.max(1e-3, Math.abs(io.omegaR));
      const lsr = p.limitedSlipRatio;
      const alpha = lsr > 1 && lsr < Infinity ? Math.min(((wl > wr ? wl / wr : wr / wl) - 1) / (lsr - 1), 1) : 0;
      const slowShare = (1 - alpha) * 0.5 + alpha;
      const fastShare = (1 - alpha) * 0.5;
      io.torqueL = axle * (wl <= wr ? slowShare : fastShare);
      io.torqueR = axle * (wl <= wr ? fastShare : slowShare);
      io.inertia = wheelInertia + (p.engineInertia * r * r * clutch) / 2;
      io.gear = g;
      io.engineRpm = rpm;
      io.tractionActive = tcs < 0.98;
    },
  };
}
