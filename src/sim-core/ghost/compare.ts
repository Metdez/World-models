/**
 * A/B comparison of ghost runs (ARCHITECTURE-M2 §7.14, §13.3). The noise floor of every channel is the driver model's
 * own repeat error: max |A' - visitor| where A' is the ghost with the visitor's suspension. A B-vs-A' difference
 * counts only when its peak exceeds MARGIN x that floor and a perceptual floor. When A' cannot repeat the visitor's
 * line (or does not finish it) the comparison is refused; when B leaves the line it is reported as such. Never ranks.
 */
import { CHANNELS, type Channel, type GhostRun, type Trace } from "./ghost";

/** A difference must exceed MARGIN x the A/A noise floor. */
export const MARGIN = 3;
/** Perceptual floors (rad, m): below these two runs read as the same whatever the noise floor. */
export const FLOOR: Readonly<Record<Channel, number>> = {
  steer: 0.25 * (Math.PI / 180),
  frontSlip: 0.15 * (Math.PI / 180),
  rearSlip: 0.15 * (Math.PI / 180),
  sideslip: 0.15 * (Math.PI / 180),
  roll: 0.1 * (Math.PI / 180),
  offset: 0.05,
};
/** A' farther than this from the visitor's line (m) = the driver model cannot repeat the drive: no conclusion. */
export const AA_MAX_OFFSET = 0.25;
/** B farther than this (m) = it did not hold the line: the cars took different paths. */
export const B_LOST_OFFSET = 0.75;
/** Share of the line a run must cover to be compared. */
const MIN_COVER = 0.95;

export interface ChannelStat {
  /** A/A noise floor: max |A' - visitor|. */
  readonly floor: number;
  /** Max |B - A'|, and the threshold it was held against. */
  readonly peakDiff: number;
  readonly threshold: number;
  /** Peak |value| of A' and of B. */
  readonly aPeak: number;
  readonly bPeak: number;
  readonly significant: boolean;
}

export type Verdict = "refused" | "lost" | "same" | "different";

export interface Comparison {
  readonly verdict: Verdict;
  /** Samples compared (k * GHOST_DS along the line). */
  readonly n: number;
  /** Largest A' and B distance from the visitor's line, m. */
  readonly aaOffset: number;
  readonly bOffset: number;
  /** sum |steer B| / sum |steer A'| - 1 (NaN when A' barely steered). */
  readonly steerEffort: number;
  readonly channels: Readonly<Record<Channel, ChannelStat>>;
  /** Significant channels, strongest first (peakDiff / threshold). */
  readonly order: readonly Channel[];
}

/** Mean |steer| below this (rad) makes a steering-effort ratio meaningless. */
const MIN_MEAN_STEER = 0.5 * (Math.PI / 180);

/** Sample 0 is the stretch's start state itself (identical by construction; a just-restored plant samples it without
 *  its previous step), so the comparison starts at sample 1. */
export function compareRuns(
  visitor: Trace,
  a: GhostRun,
  b: GhostRun,
): Comparison {
  const n = Math.min(visitor.n, a.trace.n, b.trace.n);
  const covered = (r: GhostRun) =>
    r.trace.n >= MIN_COVER * visitor.n && r.status !== "lost";
  const channels = {} as Record<Channel, ChannelStat>;
  for (const c of CHANNELS) {
    const v = visitor.ch[c];
    const x = a.trace.ch[c];
    const y = b.trace.ch[c];
    let floor = 0;
    let peak = 0;
    let aPeak = 0;
    let bPeak = 0;
    for (let k = 1; k < n; k++) {
      floor = Math.max(floor, Math.abs(x[k]! - v[k]!));
      peak = Math.max(peak, Math.abs(y[k]! - x[k]!));
      aPeak = Math.max(aPeak, Math.abs(x[k]!));
      bPeak = Math.max(bPeak, Math.abs(y[k]!));
    }
    const threshold = Math.max(MARGIN * floor, FLOOR[c]);
    channels[c] = {
      floor,
      peakDiff: peak,
      threshold,
      aPeak,
      bPeak,
      significant: peak > threshold,
    };
  }
  let sa = 0;
  let sb = 0;
  for (let k = 1; k < n; k++) {
    sa += Math.abs(a.trace.ch.steer[k]!);
    sb += Math.abs(b.trace.ch.steer[k]!);
  }
  const steerEffort =
    n > 1 && sa / (n - 1) >= MIN_MEAN_STEER ? sb / sa - 1 : NaN;
  const aaOffset = a.maxOffset;
  const bOffset = b.maxOffset;
  const refused = !covered(a) || aaOffset > AA_MAX_OFFSET;
  const lost = !refused && (!covered(b) || bOffset > B_LOST_OFFSET);
  const order = CHANNELS.filter((c) => channels[c].significant).sort(
    (p, q) =>
      channels[q].peakDiff / channels[q].threshold -
      channels[p].peakDiff / channels[p].threshold,
  );
  const verdict: Verdict = refused
    ? "refused"
    : lost
      ? "lost"
      : order.length > 0
        ? "different"
        : "same";
  return { verdict, n, aaOffset, bOffset, steerEffort, channels, order };
}
