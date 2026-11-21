/**
 * In-memory recorder of a Manual Drive run (ARCHITECTURE-M2 §7.1, §7.10 F/G; research m2/24 §b): the latched,
 * quantised intents (exactly what the HumanDriver consumed), suspension/aids/reset events at their ticks, and every
 * SNAP_TICKS steps a full start-state snapshot with its CRC. Spans (`last(s)`) start on a snapshot tick, so any
 * span — the moment replay's last seconds, 11-04's ghost span, the whole run — replays from an exact state.
 * Buffers are allocated once (first start) and cover REPLAY_LIMITS.maxSeconds; older data is dropped in whole seconds.
 * `latch` and `tick` do not allocate.
 */
import { CONTROL_TICKS, REPLAY_LIMITS, type DecodedReplay, type ReplayEventRecord, type ReplayHeader } from '../../contracts/drive';
import type { QuantIntent } from '../drive/types';
import { keyframesFor, samplesFor, stateChecksum } from './format';

/** Steps between in-memory snapshots (1 s): span starts and resync states. */
export const SNAP_TICKS = 240;
const TICKS_PER_S = 240;
const CH = 5;
const MAX_TICKS = REPLAY_LIMITS.maxSeconds * TICKS_PER_S;
const SAMPLE_CAP = MAX_TICKS / CONTROL_TICKS + 2 * (SNAP_TICKS / CONTROL_TICKS);
const SLOTS = MAX_TICKS / SNAP_TICKS + 2;
const MAX_EVENTS = 2048;

export interface Recorder {
  /** New run from this start state (copied). Old data is discarded. */
  start(snapshot: Float64Array, header: Omit<ReplayHeader, 'ticks'>): void;
  /** At control ticks only (tick % CONTROL_TICKS === 0), before the step. */
  latch(q: Readonly<QuantIntent>): void;
  /** Applied before the step of the current tick. */
  event(kind: ReplayEventRecord['kind'], value: string): void;
  /** After each step; `snapshotIfKeyframe` is called on snapshot ticks only (its array is copied). */
  tick(snapshotIfKeyframe: () => Float64Array): void;
  /** The newest >= `seconds` (to the next whole snapshot second; less if the run is shorter), or null when empty. */
  last(seconds: number): DecodedReplay | null;
  whole(): DecodedReplay | null;
  /** Ticks recorded since start (absolute; the retained part starts at `base`). */
  readonly ticks: number;
  readonly base: number;
  /** Absolute start tick of a span this recorder returned in the current run, or -1. */
  origin(replay: DecodedReplay): number;
  /** Copies the snapshot of absolute tick `tick` (a retained snapshot tick <= ticks) into `out`; false if none. */
  snapshotAt(tick: number, out: Float64Array, offset?: number): boolean;
  /** Drop everything from absolute tick `tick` (a retained snapshot tick) on: recording continues from there. */
  rewind(tick: number): boolean;
}

interface Ev {
  tick: number;
  kind: ReplayEventRecord['kind'];
  value: string;
}

export function createRecorder(o: { readonly snapshotLength: number; readonly paramsHash: (suspensionId: string) => string }): Recorder {
  const L = o.snapshotLength;
  let intents: Int16Array | null = null;
  let snaps: Float64Array | null = null;
  let crcs: Uint32Array | null = null;
  let header: Omit<ReplayHeader, 'ticks'> | null = null;
  let events: Ev[] = [];
  const st = new Float64Array(3); // [ticks, samples, base]
  let run = 0;
  const spans = new WeakMap<DecodedReplay, { run: number; start: number }>();

  const slot = (tick: number) => ((tick / SNAP_TICKS) % SLOTS) * L;

  function inForce(kind: 'aids' | 'suspension', before: number): string | null {
    let v: string | null = null;
    for (const e of events) if (e.kind === kind && e.tick < before) v = e.value;
    return v;
  }

  function build(startTick: number): DecodedReplay | null {
    const T = st[0]!;
    const ticks = T - startTick;
    if (!header || ticks <= 0 || !snaps || !intents || !crcs) return null;
    const start = snaps.slice(slot(startTick), slot(startTick) + L);
    const n = samplesFor(ticks);
    const out = new Int16Array(n * CH);
    const j0 = startTick / CONTROL_TICKS;
    for (let j = 0; j < n; j++) {
      const p = ((j0 + j) % SAMPLE_CAP) * CH;
      for (let c = 0; c < CH; c++) out[j * CH + c] = intents[p + c]!;
    }
    const nk = keyframesFor(ticks);
    const keyframes = new Uint32Array(nk);
    for (let k = 0; k < nk; k++) keyframes[k] = crcs[slot(startTick + (k + 1) * REPLAY_LIMITS.keyframeTicks) / L]!;
    const suspensionId = inForce('suspension', startTick) ?? header.suspensionId;
    const evs: ReplayEventRecord[] = [];
    const aids = inForce('aids', startTick);
    if (aids !== null) evs.push({ tick: 0, kind: 'aids', value: aids });
    for (const e of events) if (e.tick >= startTick && e.tick < T) evs.push({ tick: e.tick - startTick, kind: e.kind, value: e.value });
    const replay: DecodedReplay = {
      header: { ...header, suspensionId, paramsHash: o.paramsHash(suspensionId), ticks },
      start,
      intents: out,
      events: evs,
      keyframes,
    };
    spans.set(replay, { run, start: startTick });
    return replay;
  }

  const rec: Recorder = {
    get ticks() {
      return st[0]!;
    },
    get base() {
      return st[2]!;
    },
    start(snapshot, h) {
      if (!intents) {
        intents = new Int16Array(SAMPLE_CAP * CH);
        snaps = new Float64Array(SLOTS * L);
        crcs = new Uint32Array(SLOTS);
      }
      header = h;
      events = [];
      st[0] = 0;
      st[1] = 0;
      st[2] = 0;
      run++;
      for (let k = 0; k < L; k++) snaps![k] = snapshot[k]!;
      crcs![0] = stateChecksum(snapshot, L);
    },
    latch(q) {
      if (!intents) return;
      const p = (st[1]! % SAMPLE_CAP) * CH;
      intents[p] = q.steer;
      intents[p + 1] = q.throttle;
      intents[p + 2] = q.brake;
      intents[p + 3] = q.handbrake;
      intents[p + 4] = q.flags;
      st[1] = st[1]! + 1;
    },
    event(kind, value) {
      if (!header) return;
      events.push({ tick: st[0]!, kind, value });
      if (events.length > MAX_EVENTS) {
        // keep the state in force at the base and everything after it
        const base = st[2]!;
        const a = inForce('aids', base);
        const s = inForce('suspension', base);
        events = events.filter((e) => e.tick >= base);
        if (s !== null) events.unshift({ tick: base - 1, kind: 'suspension', value: s });
        if (a !== null) events.unshift({ tick: base - 1, kind: 'aids', value: a });
      }
    },
    tick(snapshotIfKeyframe) {
      if (!snaps) return;
      const T = st[0]! + 1;
      st[0] = T;
      if (T % SNAP_TICKS === 0) {
        const src = snapshotIfKeyframe();
        const at = slot(T);
        for (let k = 0; k < L; k++) snaps[at + k] = src[k]!;
        crcs![at / L] = stateChecksum(src, L);
        while (T - st[2]! > MAX_TICKS) st[2] = st[2]! + SNAP_TICKS;
      }
    },
    last(seconds) {
      const T = st[0]!;
      if (T <= 0) return null;
      const want = T - Math.round(seconds * TICKS_PER_S);
      const s = want <= st[2]! ? st[2]! : Math.floor(want / SNAP_TICKS) * SNAP_TICKS;
      return build(s);
    },
    whole() {
      return build(st[2]!);
    },
    origin(replay) {
      const w = spans.get(replay);
      return w && w.run === run && w.start >= st[2]! && w.start <= st[0]! ? w.start : -1;
    },
    snapshotAt(tick, out, offset = 0) {
      if (!snaps || tick % SNAP_TICKS !== 0 || tick < st[2]! || tick > st[0]!) return false;
      const at = slot(tick);
      for (let k = 0; k < L; k++) out[offset + k] = snaps[at + k]!;
      return true;
    },
    rewind(tick) {
      if (!snaps || tick % SNAP_TICKS !== 0 || tick < st[2]! || tick > st[0]!) return false;
      st[0] = tick;
      st[1] = tick / CONTROL_TICKS;
      events = events.filter((e) => e.tick < tick);
      return true;
    },
  };
  return rec;
}
