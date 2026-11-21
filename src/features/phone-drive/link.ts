/**
 * Phone driver link, screen side (ARCHITECTURE-M2 §12.3; research m2/17 §5). Pure; times in ms.
 * Latest-wins `in` frames (u32 sequence, wrapping; a large jump back = another phone took the wheel) become a TARGET: the output moves to it over one packet period
 * (taken from the room's receive stamps `r`, so downlink jitter does not stretch it); no extrapolation. Silence:
 * after 250 ms the input decays to neutral over 300 ms while braking gently (moving only); after 1 s the link is lost.
 * Silence is counted per screen frame, each frame adding at most `stallStepMs`.
 */
import type { DriveMode } from '../../contracts/drive';

export const LINK = {
  decayAfterMs: 250,
  decayMs: 300,
  lostAfterMs: 1000,
  /** Link badge thresholds on the frame age, ms. */
  amberMs: 150,
  redMs: 250,
  /** Interpolation period bounds, ms (30 Hz nominal). */
  periodMinMs: 10,
  periodMaxMs: 100,
  periodMs: 1000 / 30,
  /** Longest step one screen frame adds to the silence, ms: a screen that itself stalled (a long frame, a busy main
   * thread holding queued messages) does not blame the phone for it. */
  stallStepMs: 100,
  /** Brake applied while decaying (only when the car moves). */
  brakeOnLoss: 0.5,
  /** Flags (contracts/net.ts `in.f`). */
  flagWanted: 1,
  flagHandbrake: 2,
  flagTouch: 4,
} as const;

export type LinkPhase = 'idle' | 'live' | 'decay' | 'lost';
export type LinkLevel = 'ok' | 'amber' | 'red';

/** A jump back by more than this is a new sender (the relay is ordered: only duplicates come back), not a stale frame. */
export const NEW_STREAM_BACK = 64;

/** `a` is a newer u32 sequence number than `b` (wrapping; half-range rule). */
export function seqNewer(a: number, b: number): boolean {
  const d = (a - b) >>> 0;
  return d !== 0 && d < 0x80000000;
}

/** 1 while frames are fresh, then linear to 0 over `decayMs` once `silentMs` passes `decayAfterMs`. */
export function failsafeGain(silentMs: number): number {
  if (!(silentMs > LINK.decayAfterMs)) return 1;
  return Math.max(0, 1 - (silentMs - LINK.decayAfterMs) / LINK.decayMs);
}

export function phaseOf(silentMs: number): Exclude<LinkPhase, 'idle'> {
  return silentMs >= LINK.lostAfterMs ? 'lost' : silentMs > LINK.decayAfterMs ? 'decay' : 'live';
}

export function linkLevel(ageMs: number): LinkLevel {
  return ageMs > LINK.redMs ? 'red' : ageMs > LINK.amberMs ? 'amber' : 'ok';
}

export interface InFrame {
  readonly n: number;
  readonly s: number;
  readonly th: number;
  readonly br: number;
  readonly f: number;
  readonly r: number;
}

/** What the link drives this frame (steer + = LEFT, as DriveIntent). */
export interface LinkOutput {
  steer: number;
  throttle: number;
  brake: number;
  handbrake: number;
  /** The phone asks to drive (flag 1 of its latest frame). */
  wanted: boolean;
}

export interface PhoneLink {
  /** A frame arrived at local time `now`; false = stale or duplicate (dropped). */
  receive(frame: InFrame, now: number): boolean;
  /** Writes the output for local time `now`; `moving` lets the decay brake. */
  sample(now: number, moving: boolean, out: LinkOutput): LinkPhase;
  /** The driver left (presence): lost until the next frame. */
  drop(): void;
  /** Silence since the last accepted frame as counted for the failsafe, ms. */
  readonly silentMs: number;
  /** Local time of the last accepted frame (-Infinity before the first). */
  readonly lastArrival: number;
  /** Room receive stamp of the last accepted frame. */
  readonly lastR: number;
}

const clamp1 = (v: number) => (v > 1 ? 1 : v < -1 ? -1 : v);
const clamp01 = (v: number) => (v > 1 ? 1 : v < 0 ? 0 : v);

export function createPhoneLink(): PhoneLink {
  let last = -1;
  let has = false;
  let arrival = -Infinity;
  let rLast = Number.NaN;
  let period: number = LINK.periodMs;
  let dropped = false;
  let flags = 0;
  let silent = 0;
  let lastSample = 0;
  // interpolation: from (output when the frame arrived) -> to (the frame), over `period`
  const from = { steer: 0, throttle: 0, brake: 0 };
  const to = { steer: 0, throttle: 0, brake: 0 };
  const cur = { steer: 0, throttle: 0, brake: 0 };

  const interpolate = (now: number) => {
    const k = clamp01((now - arrival) / period);
    cur.steer = from.steer + (to.steer - from.steer) * k;
    cur.throttle = from.throttle + (to.throttle - from.throttle) * k;
    cur.brake = from.brake + (to.brake - from.brake) * k;
  };

  return {
    receive(frame, now) {
      if (has && !seqNewer(frame.n, last) && ((last - frame.n) >>> 0) <= NEW_STREAM_BACK) return false;
      if (has && !dropped && silent < LINK.lostAfterMs) {
        interpolate(now);
        const gap = frame.r - rLast;
        period = Number.isFinite(gap) ? Math.min(LINK.periodMaxMs, Math.max(LINK.periodMinMs, gap)) : LINK.periodMs;
        from.steer = cur.steer;
        from.throttle = cur.throttle;
        from.brake = cur.brake;
      } else {
        // first frame or after a loss: no stale ramp from an old state, start at neutral over one period
        period = LINK.periodMs;
        from.steer = from.throttle = from.brake = 0;
      }
      has = true;
      dropped = false;
      last = frame.n >>> 0;
      arrival = lastSample = now;
      silent = 0;
      rLast = frame.r;
      flags = frame.f;
      to.steer = clamp1(frame.s / 1000);
      to.throttle = clamp01(frame.th / 1000);
      to.brake = clamp01(frame.br / 1000);
      return true;
    },
    sample(now, moving, out) {
      out.handbrake = 0;
      if (!has) {
        out.steer = out.throttle = out.brake = 0;
        out.wanted = false;
        return 'idle';
      }
      silent += Math.min(LINK.stallStepMs, Math.max(0, now - lastSample));
      lastSample = now;
      const phase = dropped ? 'lost' : phaseOf(silent);
      out.wanted = phase !== 'lost' && (flags & LINK.flagWanted) !== 0;
      if (phase === 'lost') {
        out.steer = out.throttle = out.brake = 0;
        return phase;
      }
      interpolate(now);
      const g = failsafeGain(silent);
      out.steer = cur.steer * g;
      out.throttle = cur.throttle * g;
      out.brake = Math.max(cur.brake * g, moving ? LINK.brakeOnLoss * (1 - g) : 0);
      out.handbrake = phase === 'live' && (flags & LINK.flagHandbrake) !== 0 ? 1 : 0;
      return phase;
    },
    drop() {
      dropped = true;
    },
    get silentMs() {
      return has ? silent : Infinity;
    },
    get lastArrival() {
      return arrival;
    },
    get lastR() {
      return rLast;
    },
  };
}

/** Deliberate input for the DRIVE arbiter: the phone wants to drive and shows input beyond small dead zones. */
export function deliberate(o: Readonly<LinkOutput>): boolean {
  return o.wanted && (Math.abs(o.steer) > 0.02 || o.throttle > 0.02 || o.brake > 0.02 || o.handbrake > 0);
}

const MODE_INDEX: Readonly<Record<DriveMode, number>> = { auto: 0, manual: 1, returning: 2, replay: 3 };

/** `tel` fields within the contract ranges (v km/h 0..999, g -1..12, m 0..3, k 0..3). */
export function telFrame(speedMs: number, gear: number, mode: DriveMode, bits: number): { t: 'tel'; v: number; g: number; m: number; k: number } {
  const v = Math.round(Math.abs(speedMs) * 3.6);
  const g = Math.round(gear);
  return {
    t: 'tel',
    v: Number.isFinite(v) ? Math.min(999, v) : 0,
    g: Number.isFinite(g) ? Math.max(-1, Math.min(12, g)) : 0,
    m: MODE_INDEX[mode],
    k: bits & 3,
  };
}
