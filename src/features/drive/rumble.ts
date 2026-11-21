/**
 * Gamepad rumble (ARCHITECTURE-M2 §10.4; research m2/18 §3): subtle garnish, Manual only, feature-detected dual rumble.
 * weak (high-frequency motor) = road roughness (RMS wheel travel rate) plus a touch at the tyre limit; strong = a short
 * pulse on a kerb strike, a bump-stop hit or the anti-lock brakes starting. Effects of RUMBLE.durationMs sent at most
 * every RUMBLE.periodS. Pure levels; `createRumble` plays them on a pad.
 */
import type { DriveFrame } from '../../contracts/drive';
import type { CornerFrame } from '../../contracts/telemetry';
import { canRumble, type PadLike } from './gamepad';

export const RUMBLE = {
  /** Effect length and the shortest time between effects (≤ 20 Hz). */
  durationMs: 120,
  periodS: 0.05,
  /** Overall cap: this is a hint, not a shaker. */
  max: 0.5,
  /** Smoothing of the travel-rate RMS, s. */
  tau: 0.1,
  /** Strong pulse length, s. */
  pulseS: 0.12,
} as const;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface RumbleState {
  /** Smoothed mean square travel rate, (m/s)². */
  ms: number;
  /** Strong pulse time left, s, and its level. */
  pulse: number;
  pulseLevel: number;
  /** Rising-edge memory: any corner on a stop / on a kerb / ABS active. */
  wasStop: boolean;
  wasKerb: boolean;
  wasAbs: boolean;
}

export const createRumbleState = (): RumbleState => ({ ms: 0, pulse: 0, pulseLevel: 0, wasStop: false, wasKerb: false, wasAbs: false });

type Corner = Pick<CornerFrame, 'travelRate' | 'gripUse' | 'stop' | 'surface' | 'load'>;

/** Advances the state by `dt` and writes the magnitudes (0..RUMBLE.max) into `out`. Not driving: zero, state cleared. */
export function rumbleLevels(corners: readonly Corner[], d: Pick<DriveFrame, 'absActive'>, driving: boolean, dt: number, st: RumbleState, out: { weak: number; strong: number }): void {
  if (!driving || corners.length === 0) {
    Object.assign(st, createRumbleState());
    out.weak = out.strong = 0;
    return;
  }
  let sq = 0;
  let grip = 0;
  let stop = false;
  let kerb = false;
  for (const c of corners) {
    sq += c.travelRate * c.travelRate;
    grip = Math.max(grip, c.gripUse);
    if (c.stop > 0.5) stop = true;
    if (c.surface === 'kerb' && c.load > 0) kerb = true;
  }
  const k = 1 - Math.exp(-dt / RUMBLE.tau);
  st.ms += (sq / corners.length - st.ms) * k;
  const rough = 0.3 * smoothstep(0.03, 0.3, Math.sqrt(st.ms));
  const limit = 0.2 * smoothstep(0.9, 1.1, grip);
  out.weak = Math.min(RUMBLE.max, rough + limit);

  const hit = (stop && !st.wasStop) || (kerb && !st.wasKerb) ? 0.4 : d.absActive && !st.wasAbs ? 0.25 : 0;
  st.wasStop = stop;
  st.wasKerb = kerb;
  st.wasAbs = d.absActive;
  if (hit > 0) {
    st.pulseLevel = st.pulse > 0 ? Math.max(hit, st.pulseLevel) : hit;
    st.pulse = RUMBLE.pulseS;
  } else st.pulse = Math.max(0, st.pulse - dt);
  out.strong = st.pulse > 0 ? Math.min(RUMBLE.max, st.pulseLevel) : 0;
}

export interface Rumble {
  /** Call every frame with the levels; plays at most every RUMBLE.periodS on `pad` (nothing when it cannot rumble). */
  update(pad: PadLike | null, weak: number, strong: number, now: number): void;
  /** Stop any running effect (hand-back, toggle off, blur). */
  stop(pad: PadLike | null): void;
}

export function createRumble(): Rumble {
  let last = -Infinity;
  let playing = false;
  const quiet = (pad: PadLike | null) => {
    if (!playing) return;
    playing = false;
    void pad?.vibrationActuator?.reset?.()?.catch(() => {});
  };
  return {
    update(pad, weak, strong, now) {
      if (!canRumble(pad)) return;
      if (weak < 0.02 && strong < 0.02) return quiet(pad);
      if (now - last < RUMBLE.periodS) return;
      last = now;
      playing = true;
      void pad!
        .vibrationActuator!.playEffect!('dual-rumble', { startDelay: 0, duration: RUMBLE.durationMs, weakMagnitude: weak, strongMagnitude: strong })
        .catch(() => {});
    },
    stop: quiet,
  };
}
