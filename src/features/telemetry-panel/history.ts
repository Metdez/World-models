/**
 * Telemetry history for the sparkline (pure, allocation-free after construction).
 * - `live`: rolling window of the last `slots` samples, every corner x metric, plus the track position `s`.
 * - lap records: one per suspension id, binned by track position. The ghost of a live slot is the PREVIOUS
 *   suspension's value at that slot's track position, so the A/B compares the same road, never different seconds.
 */
import type { CornerFrame, TelemetryFrame } from '../../contracts/telemetry';

export const METRICS = ['camber', 'travel', 'load'] as const;
export type Metric = (typeof METRICS)[number];

/** TRUE (never POSE) SI value of a corner metric. */
export function metricValue(c: CornerFrame, m: Metric): number {
  return m === 'camber' ? c.camber : m === 'travel' ? c.travel : c.load;
}

/** Bins skipped between two samples are filled when the gap is at most this many bins (fast straights). */
const MAX_FILL_BINS = 8;

export class History {
  readonly stride: number;
  readonly live: Float32Array;
  readonly liveS: Float32Array;
  /** Index of the next write; count = filled slots (<= slots). */
  head = 0;
  count = 0;
  private readonly records = new Map<string, Float32Array>();
  private record: Float32Array;
  private ghost: Float32Array | undefined;
  private lastBin = -1;

  constructor(
    readonly corners: number,
    readonly trackLength: number,
    suspensionId: string,
    readonly slots = 180,
    readonly bins = 1024,
  ) {
    this.stride = corners * METRICS.length;
    this.live = new Float32Array(slots * this.stride).fill(Number.NaN);
    this.liveS = new Float32Array(slots).fill(Number.NaN);
    this.record = this.recordFor(suspensionId);
  }

  /** Previous suspension's lap record becomes the ghost; allocates only for a never-seen id. */
  setSuspension(id: string, previous: string | undefined): void {
    this.ghost = previous === undefined ? undefined : this.records.get(previous);
    this.record = this.recordFor(id);
    this.lastBin = -1;
  }

  get hasGhost(): boolean {
    return this.ghost !== undefined;
  }

  /** Discontinuity (seek): the window restarts; lap records stay valid (the path is a pure function of s). */
  resetWindow(): void {
    this.live.fill(Number.NaN);
    this.liveS.fill(Number.NaN);
    this.head = 0;
    this.count = 0;
    this.lastBin = -1;
  }

  push(t: TelemetryFrame): void {
    const base = this.head * this.stride;
    for (let c = 0; c < this.corners; c++) {
      const k = t.corners[c]!;
      for (let m = 0; m < METRICS.length; m++) this.live[base + c * METRICS.length + m] = metricValue(k, METRICS[m]!);
    }
    this.liveS[this.head] = t.s;
    this.writeRecord(t.s, base);
    this.head = (this.head + 1) % this.slots;
    if (this.count < this.slots) this.count++;
  }

  /** k = 0 (oldest) .. count-1 (newest). */
  liveAt(k: number, corner: number, metric: number): number {
    const slot = (this.head - this.count + k + this.slots) % this.slots;
    return this.live[slot * this.stride + corner * METRICS.length + metric]!;
  }

  ghostAt(k: number, corner: number, metric: number): number {
    if (!this.ghost) return Number.NaN;
    const slot = (this.head - this.count + k + this.slots) % this.slots;
    const s = this.liveS[slot]!;
    if (s !== s) return Number.NaN;
    return this.ghost[this.bin(s) * this.stride + corner * METRICS.length + metric]!;
  }

  bin(s: number): number {
    const u = (((s % this.trackLength) + this.trackLength) % this.trackLength) / this.trackLength;
    return Math.min(this.bins - 1, Math.floor(u * this.bins));
  }

  private writeRecord(s: number, liveBase: number): void {
    const b = this.bin(s);
    const gap = this.lastBin < 0 ? 0 : (b - this.lastBin + this.bins) % this.bins;
    const fill = gap > 1 && gap <= MAX_FILL_BINS ? gap : 1;
    for (let i = 0; i < fill; i++) {
      const at = ((b - i + this.bins) % this.bins) * this.stride;
      for (let j = 0; j < this.stride; j++) this.record[at + j] = this.live[liveBase + j]!;
    }
    this.lastBin = b;
  }

  private recordFor(id: string): Float32Array {
    let r = this.records.get(id);
    if (!r) {
      r = new Float32Array(this.bins * this.stride).fill(Number.NaN);
      this.records.set(id, r);
    }
    return r;
  }
}
