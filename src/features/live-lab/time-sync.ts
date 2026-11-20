/**
 * NTP-style server-clock offset (Cristian's algorithm, research 17 §4.4). Pure: callers pass timestamps.
 * offset = server unix ms − local Date.now(); the kernel clock adds it (`clock.setOffset`).
 */

export interface SyncSample {
  /** Round trip, ms (monotonic clock). */
  readonly rtt: number;
  /** Estimated server − local wall clock, ms. */
  readonly offset: number;
}

const WINDOW = 16;
const BEST = 3;
/** Samples that set the offset directly (first fix) before slewing starts. */
const FIRST_FIX = 3;
/** Max correction per sample once fixed, ms (no visible hitch). */
const SLEW_MS = 5;
/** A local clock step larger than this is applied at once (device clock changed). */
const STEP_MS = 1000;

/**
 * One probe: `c0`/`c2` from performance.now() around the round trip, `s1` the server stamp, `wall2` = Date.now()
 * at receipt. The server stamped s1 at about the midpoint of the round trip.
 */
export function sampleFrom(c0: number, s1: number, c2: number, wall2: number): SyncSample | null {
  const rtt = c2 - c0;
  if (!(rtt >= 0) || !Number.isFinite(s1)) return null;
  return { rtt, offset: s1 - (wall2 - rtt / 2) };
}

export class TimeSync {
  private readonly samples: SyncSample[] = [];
  private count = 0;
  offset = 0;

  /** Adds a sample and returns the updated offset. */
  add(sample: SyncSample): number {
    this.samples.push(sample);
    if (this.samples.length > WINDOW) this.samples.shift();
    this.count++;
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, BEST);
    const target = best.reduce((sum, s) => sum + s.offset, 0) / best.length;
    const error = target - this.offset;
    this.offset = this.count <= FIRST_FIX || Math.abs(error) > STEP_MS ? target : this.offset + Math.max(-SLEW_MS, Math.min(SLEW_MS, error));
    return this.offset;
  }

  /** Lowest round trip in the window (diagnostics; Infinity before the first sample). */
  get bestRtt(): number {
    return this.samples.reduce((m, s) => Math.min(m, s.rtt), Infinity);
  }
}
