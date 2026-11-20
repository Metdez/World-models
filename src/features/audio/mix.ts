/**
 * Pure sound mapping: telemetry -> playback rates and gains (bounded), plus the one ramp helper every
 * parameter change goes through. No WebAudio here, so it is unit-tested (tests/features/audio.test.ts).
 */
import type { VehicleClass } from '../../contracts/suspension';

/** Exponential approach time constant for every parameter change, s (no zipper noise, no clicks). */
export const RAMP_TAU = 0.06;
export const MASTER_GAIN = 0.7;

/** Pseudo gearbox: upper speed of each gear, m/s (the loop is one sample, so "rpm" is its playback rate). */
const GEARS: Readonly<Record<VehicleClass, readonly number[]>> = {
  car: [13, 23, 33, 44, 56, 70, 90],
  motorcycle: [11, 19, 27, 35, 44, 54, 70],
};
const RATE: Readonly<Record<VehicleClass, readonly [idle: number, redline: number]>> = {
  car: [0.62, 1.55],
  motorcycle: [0.72, 1.85],
};
export const RATE_MIN = 0.5;
export const RATE_MAX = 2.2;
export const ENGINE_GAIN_MAX = 0.5;
export const SKID_GAIN_MAX = 0.32;
export const THUMP_GAIN_MAX = 0.6;

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Revs after an upshift, as a fraction of the band. */
const SHIFT_DROP = 0.45;

/** 0 (idle) .. 1 (redline): first gear rises from idle, every later gear from SHIFT_DROP. */
export function engineRevs(cls: VehicleClass, speed: number): number {
  const v = Number.isFinite(speed) ? Math.abs(speed) : 0;
  let lo = 0;
  for (const hi of GEARS[cls]) {
    if (v < hi) {
      const base = lo === 0 ? 0 : SHIFT_DROP;
      return base + (1 - base) * ((v - lo) / (hi - lo));
    }
    lo = hi;
  }
  return 1;
}

export interface Tone {
  rate: number;
  gain: number;
}

/**
 * Engine loop: rate from the pseudo revs, gain from throttle (forward acceleration ax, m/s^2) with a quieter
 * overrun under braking. Slow motion lowers the pitch; pause silences it. Writes into `out` (no allocation).
 */
export function engineTone(out: Tone, cls: VehicleClass, speed: number, ax: number, timeScale: number, paused: boolean): Tone {
  const revs = engineRevs(cls, speed);
  const [idle, red] = RATE[cls];
  const slow = 0.5 + 0.5 * clamp(timeScale, 0, 1);
  out.rate = clamp((idle + (red - idle) * revs) * slow, RATE_MIN, RATE_MAX);
  const a = Number.isFinite(ax) ? ax : 0;
  const throttle = clamp(a / 4, 0, 1);
  const overrun = clamp(-a / 6, 0, 1);
  const gain = 0.16 + 0.24 * throttle + 0.1 * revs - 0.06 * overrun;
  out.gain = paused ? 0 : clamp(gain, 0, ENGINE_GAIN_MAX);
  return out;
}

/** Tyre noise from the highest grip use (a model estimate, 0..~1.2): nothing below 0.8, full by 1.05. */
export function skidTone(out: Tone, maxGripUse: number, speed: number, paused: boolean): Tone {
  const g = Number.isFinite(maxGripUse) ? maxGripUse : 0;
  out.rate = clamp(0.9 + 0.3 * clamp((g - 0.8) / 0.4, 0, 1), RATE_MIN, RATE_MAX);
  out.gain = paused ? 0 : SKID_GAIN_MAX * smoothstep(0.8, 1.05, g) * smoothstep(2, 6, Math.abs(speed));
  return out;
}

/** Wheel-travel rate (m/s) above which a corner "thumps" (kerb, bump); also the hysteresis re-arm level is half. */
export const THUMP_RATE = 0.45;

/** One-shot gain for a travel-rate spike (kerbs, bumps) or a bump-stop hit (`stop` = 1). */
export function thumpGain(travelRate: number, stop = 0): number {
  const fromRate = clamp((Math.abs(travelRate) - THUMP_RATE) / 0.9, 0, 1);
  return THUMP_GAIN_MAX * clamp(0.35 + 0.65 * Math.max(fromRate, stop), 0, 1);
}

/** The subset of AudioParam the ramp needs (fakes in tests). */
export interface RampParam {
  setTargetAtTime(target: number, startTime: number, timeConstant: number): unknown;
}

/** Moves `param` toward `target` smoothly; skips tiny changes so the automation timeline stays short. */
export function ramp(param: RampParam, last: { v: number }, target: number, now: number, eps = 1e-3): void {
  if (Math.abs(target - last.v) < eps) return;
  last.v = target;
  param.setTargetAtTime(target, now, RAMP_TAU);
}
