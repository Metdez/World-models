/**
 * Tilt steering maths (research m2/17 §1-2; ARCHITECTURE-M2 §12.3). Pure. The wheel angle comes from the gravity
 * vector in the DEVICE frame (`devicemotion.accelerationIncludingGravity` x, y), never from Euler angles (a phone held
 * upright like a wheel sits in their gimbal-degenerate zone) and never from the UI orientation (the OS may rotate the
 * page mid-turn). Engines disagree on axis signs, so the angle is taken relative to a captured neutral and its sign is
 * learned from one "turn right" sample. Also the pedal/slider helpers of the touch controls and the input frame.
 */

export const TILT = {
  /** Dead zone and full lock, degrees of wheel rotation; response exponent. */
  deadZone: 3,
  lock: 35,
  exponent: 1.4,
  /** Below this in-plane gravity (m/s²) the phone lies too flat to read a wheel angle: hold the last value. */
  minPlane: 3,
  /** The "turn right" sample must be at least this far from the neutral, degrees. */
  learnMin: 10,
  /** One-Euro filter (Casiez et al. 2012) on the angle in degrees. */
  minCutoff: 1.5,
  beta: 0.01,
  dCutoff: 1,
} as const;

/** Wraps degrees to (-180, 180]. */
export function wrap180(deg: number): number {
  const w = ((((deg + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w;
}

/** Direction of gravity in the device x-y plane, degrees; null when the phone lies too flat to tell. */
export function rawAngle(gx: number, gy: number): number | null {
  if (!(Math.hypot(gx, gy) >= TILT.minPlane)) return null;
  return (Math.atan2(gx, gy) * 180) / Math.PI;
}

/** +1 / -1 so that the "turn right" sample reads as positive; 0 when it is too close to the neutral to tell. */
export function learnSign(neutral: number, raw: number): 1 | -1 | 0 {
  const d = wrap180(raw - neutral);
  return Math.abs(d) < TILT.learnMin ? 0 : d > 0 ? 1 : -1;
}

/** Wheel rotation (degrees, + = right after the learned sign) -> steer -1..1 (+ = RIGHT): dead zone, lock, curve. */
export function steerFromAngle(deg: number): number {
  const m = Math.abs(deg) - TILT.deadZone;
  if (!(m > 0)) return 0;
  return Math.sign(deg) * Math.min(1, m / (TILT.lock - TILT.deadZone)) ** TILT.exponent;
}

/** Adaptive low-pass (One-Euro): smooth at rest, little lag when turning. Times in ms. */
export class OneEuro {
  private x = Number.NaN;
  private dx = 0;
  private t = Number.NaN;

  constructor(
    private readonly minCutoff: number = TILT.minCutoff,
    private readonly beta: number = TILT.beta,
    private readonly dCutoff: number = TILT.dCutoff,
  ) {}

  filter(value: number, tMs: number): number {
    if (this.x !== this.x || this.t !== this.t) {
      this.x = value;
      this.t = tMs;
      return value;
    }
    const dt = Math.max(1e-3, (tMs - this.t) / 1000);
    this.t = tMs;
    const alpha = (cutoff: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    this.dx += alpha(this.dCutoff) * ((value - this.x) / dt - this.dx);
    this.x += alpha(this.minCutoff + this.beta * Math.abs(this.dx)) * (value - this.x);
    return this.x;
  }

  reset(): void {
    this.x = this.t = Number.NaN;
    this.dx = 0;
  }
}

/** Touch slider: relative drag `dx` px on a track `halfWidth` px wide -> steer -1..1 (+ = RIGHT); 4 px dead band. */
export function sliderSteer(dx: number, halfWidth: number): number {
  const a = Math.abs(dx) - 4;
  if (!(a > 0) || !(halfWidth > 0)) return 0;
  return Math.sign(dx) * Math.min(1, a / (halfWidth * 0.85 - 4));
}

/** Pedal levels: an immediate bite on press (so the edge frame carries it), then a ramp; quick release. */
export const PEDAL = { bite: 0.25, rise: 6, fall: 12 } as const;

export function pedalStep(level: number, held: boolean, dt: number): number {
  return held ? Math.min(1, Math.max(level, PEDAL.bite) + PEDAL.rise * dt) : Math.max(0, level - PEDAL.fall * dt);
}

/** The driver's `in` frame (integers, contract ranges); `steerRight` + = right, the wire's `s` + = LEFT. */
export function inFrame(n: number, steerRight: number, throttle: number, brake: number, flags: number): { t: 'in'; n: number; s: number; th: number; br: number; f: number } {
  const q = (v: number, lo: number, hi: number, k: number) => (v === v ? Math.round(Math.max(lo, Math.min(hi, v)) * k) : 0);
  return { t: 'in', n: n >>> 0, s: q(-steerRight, -1, 1, 1000) || 0, th: q(throttle, 0, 1, 1000), br: q(brake, 0, 1, 1000), f: flags & 7 };
}
