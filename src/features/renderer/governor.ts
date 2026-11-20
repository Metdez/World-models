/** Adaptive pixel-ratio governor (ARCHITECTURE.md §10). Pure: no DOM, no three.js. */

/** Frame-time EMA window, frames. */
const EMA_FRAMES = 60;
const SLOW_MS = 18.5;
const FAST_MS = 14;
const SLOW_HOLD_S = 2;
const FAST_HOLD_S = 5;
const MIN_HOLD_S = 5;
const STEP_DOWN = 0.1;
const STEP_UP = 0.05;

export interface Governor {
  /** Frame-time EMA, ms. */
  ema: number;
  /** Seconds the EMA has continuously been above SLOW_MS / below FAST_MS. */
  slowS: number;
  fastS: number;
  /** Seconds spent at the minimum pixel ratio while still slow. */
  minS: number;
  ratio: number;
  /** The one tier downgrade per session has happened. */
  downgraded: boolean;
  /** Lowest ratio found too slow on this tier: climbing never returns to it, so the ratio cannot oscillate. */
  ceiling: number;
}

export interface RatioBounds {
  readonly minPixelRatio: number;
  readonly maxPixelRatio: number;
}

export type GovernorAction = 'none' | 'ratio' | 'downgrade';

export function createGovernor(ratio: number): Governor {
  return { ema: 1000 / 60, slowS: 0, fastS: 0, minS: 0, ratio, downgraded: false, ceiling: Infinity };
}

/** Starting ratio for a tier: device ratio clamped into the tier's bounds. */
export function startRatio(deviceRatio: number, b: RatioBounds): number {
  return Math.max(b.minPixelRatio, Math.min(deviceRatio, b.maxPixelRatio));
}

/** Frame-time EMA only (stats when the governor is off). */
export function trackFrame(g: Governor, dt: number): void {
  if (dt > 0) g.ema += (dt * 1000 - g.ema) / EMA_FRAMES;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Feed one rendered frame (dt in s). Returns what the caller must apply:
 * 'ratio' → setPixelRatio(g.ratio); 'downgrade' → store.quality one tier down (once per session).
 */
export function stepGovernor(g: Governor, dt: number, b: RatioBounds): GovernorAction {
  if (!(dt > 0)) return 'none';
  trackFrame(g, dt);
  const slow = g.ema > SLOW_MS;
  const atMin = g.ratio <= b.minPixelRatio + 1e-6;
  g.slowS = slow ? g.slowS + dt : 0;
  g.fastS = g.ema < FAST_MS ? g.fastS + dt : 0;
  // "At min for 5 s" only counts while still slow: a device happily running at min keeps its tier.
  g.minS = slow && atMin ? g.minS + dt : 0;

  if (g.minS >= MIN_HOLD_S && !g.downgraded) {
    g.downgraded = true;
    g.minS = g.slowS = 0;
    return 'downgrade';
  }
  if (g.slowS >= SLOW_HOLD_S && !atMin) {
    g.ceiling = Math.min(g.ceiling, g.ratio);
    g.ratio = Math.max(b.minPixelRatio, round2(g.ratio - STEP_DOWN));
    g.slowS = 0;
    return 'ratio';
  }
  const next = Math.min(b.maxPixelRatio, round2(g.ratio + STEP_UP));
  if (g.fastS >= FAST_HOLD_S && g.ratio < b.maxPixelRatio - 1e-6 && next < g.ceiling - 1e-6) {
    g.ratio = next;
    g.fastS = 0;
    return 'ratio';
  }
  return 'none';
}
