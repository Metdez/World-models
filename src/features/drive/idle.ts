/** Hint and idle timing (ARCHITECTURE-M2 §10.2, m2 SUMMARY decision 5). Pure; times in seconds. */

export const TIMING = {
  /** Auto: the "take the wheel" prompt appears after this long in Auto ... */
  promptAfter: 4,
  /** ... and stays this long. */
  promptFor: 8,
  /** Manual: the control hint shown on takeover stays this long. */
  controlsFor: 6,
  /** Manual: hand back after this long without input ... */
  handBack: 12,
  /** ... ×2.5 on the presenter's big screen (?screen=1): 30 s. */
  presenterScale: 2.5,
  /** The idle cue counts down over the last seconds before the hand-back. */
  cue: 3,
  /** Auto off the live lap after a drive (MD-07): re-sync to the shared lap after this long without input. */
  rejoinAfter: 20,
  /** A "Reset to road" after this many automatic state restores (plant faults) ... */
  faultResets: 3,
  /** ... within this much simulation time (MD-18). */
  faultWindow: 2,
} as const;

export interface IdleState {
  /** Whole seconds left on the cue ("Back to Auto in 3"), or 0 when no cue is shown. */
  countdown: number;
  /** Time to hand back. */
  handBack: boolean;
}

export function handBackAfter(screen: boolean): number {
  return TIMING.handBack * (screen ? TIMING.presenterScale : 1);
}

/** Idle cue for `idle` seconds without input in Manual. */
export function idleState(idle: number, screen: boolean, out: IdleState): IdleState {
  const left = handBackAfter(screen) - idle;
  out.handBack = left <= 0;
  out.countdown = left > 0 && left <= TIMING.cue ? Math.ceil(left) : 0;
  return out;
}

/** The Auto prompt is visible `autoTime` seconds into Auto (once per stretch of Auto). */
export function promptVisible(autoTime: number): boolean {
  return autoTime >= TIMING.promptAfter && autoTime < TIMING.promptAfter + TIMING.promptFor;
}

/**
 * MD-18: record an automatic state restore (a plant `fault` event) at `simTime` in `times` (kept to the last
 * TIMING.faultResets); true when that many fell within TIMING.faultWindow s, which clears the record ("Reset to road").
 */
export function noteFault(times: number[], simTime: number): boolean {
  times.push(simTime);
  while (times.length > TIMING.faultResets) times.shift();
  if (times.length < TIMING.faultResets || simTime - times[0]! > TIMING.faultWindow) return false;
  times.length = 0;
  return true;
}
