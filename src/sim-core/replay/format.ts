/**
 * Replay binary format (ARCHITECTURE-M2 §7.13; research m2/24 §b–c). Pure (contracts only): the replay feature and the
 * worker import it. Layout, little endian:
 *   'SLR1' · u8 format · u16 n + UTF-8 header JSON · u16 n + n × float64 start snapshot · u32 samples + 5 channels
 *   (steer, throttle, brake, handbrake, flags; each delta-coded vs the previous sample, zig-zag, LEB128 varint, channel
 *   after channel) · u16 events (varint tick, u8 kind 0 suspension / 1 aids / 2 reset, u16 n + UTF-8 value) ·
 *   u16 keyframes + u32 each · u32 CRC32 of every preceding byte.
 * The feature compresses the bytes (deflate-raw) for links; this file never compresses.
 */
import { CONTROL_TICKS, INTENT_QUANT, REPLAY_FORMAT, REPLAY_LIMITS, type DecodedReplay, type ReplayEventRecord, type ReplayHeader } from '../../contracts/drive';

/** Bump whenever plant behaviour changes (tests/sim-core/replay-golden.test.ts pins it with the golden hash). */
export const SIM_VERSION = 'm2.1';

const MAGIC = [0x53, 0x4c, 0x52, 0x31]; // 'SLR1'
const KINDS: readonly ReplayEventRecord['kind'][] = ['suspension', 'aids', 'reset'];
const CHANNELS = 5;
/** Start snapshots are a few hundred doubles; anything larger is not ours. */
const MAX_START = 4096;

// ---------------------------------------------------------------- CRC32 (IEEE, reflected), table at module load
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

export function crc32(bytes: Uint8Array, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = 0; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function crcWord(c: number, w: number): number {
  c = CRC_TABLE[(c ^ w) & 0xff]! ^ (c >>> 8);
  c = CRC_TABLE[(c ^ (w >>> 8)) & 0xff]! ^ (c >>> 8);
  c = CRC_TABLE[(c ^ (w >>> 16)) & 0xff]! ^ (c >>> 8);
  return CRC_TABLE[(c ^ (w >>> 24)) & 0xff]! ^ (c >>> 8);
}

/**
 * CRC32 of a state snapshot, each value rounded to 1e-6 and fed as two int32 words (low, high), so -0/0, NaN payloads
 * and last-bit noise below the rounding do not count (a near-tie can still flip: the replay then resyncs or says so).
 * Allocation-free.
 */
export function stateChecksum(snapshot: Float64Array, length = snapshot.length): number {
  let c = 0xffffffff;
  for (let i = 0; i < length; i++) {
    const q = Math.round(snapshot[i]! * 1e6);
    c = crcWord(c, q | 0);
    c = crcWord(c, Math.floor(q / 4294967296) | 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** FNV-1a (32) over the UTF-16 code units of JSON.stringify([vehicle, suspension, world]), 8 hex chars. */
export function paramsHash(vehicle: unknown, suspension: unknown, world: unknown): string {
  const s = JSON.stringify([vehicle, suspension, world ?? null]);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------- encode
class Writer {
  bytes = new Uint8Array(1024);
  n = 0;
  private room(k: number): void {
    if (this.n + k <= this.bytes.length) return;
    let size = this.bytes.length * 2;
    while (size < this.n + k) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.bytes.subarray(0, this.n));
    this.bytes = next;
  }
  u8(v: number): void {
    this.room(1);
    this.bytes[this.n++] = v & 0xff;
  }
  u16(v: number): void {
    if (v < 0 || v > 0xffff) throw new RangeError('u16 out of range');
    this.u8(v);
    this.u8(v >>> 8);
  }
  u32(v: number): void {
    this.u16(v & 0xffff);
    this.u16((v >>> 16) & 0xffff);
  }
  varint(v: number): void {
    v >>>= 0;
    while (v > 0x7f) {
      this.u8((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    this.u8(v);
  }
  zigzag(v: number): void {
    this.varint((v << 1) ^ (v >> 31));
  }
  f64(v: number): void {
    this.room(8);
    new DataView(this.bytes.buffer, this.n, 8).setFloat64(0, v, true);
    this.n += 8;
  }
  text(s: string): void {
    const b = new TextEncoder().encode(s);
    this.u16(b.length);
    this.room(b.length);
    this.bytes.set(b, this.n);
    this.n += b.length;
  }
  done(): Uint8Array {
    return this.bytes.slice(0, this.n);
  }
}

/** Samples needed for `ticks` fixed steps (one per CONTROL_TICKS, the last one may be partial). */
export const samplesFor = (ticks: number): number => Math.ceil(ticks / CONTROL_TICKS);
/** Keyframe CRCs a replay of `ticks` steps carries (one at every multiple of keyframeTicks, excluding 0). */
export const keyframesFor = (ticks: number): number => Math.floor(ticks / REPLAY_LIMITS.keyframeTicks);

/** Uncompressed binary (§7.13). Throws on a replay that breaks the format's own limits (never for recorder output). */
export function encodeReplay(r: DecodedReplay): Uint8Array {
  const w = new Writer();
  for (const b of MAGIC) w.u8(b);
  w.u8(REPLAY_FORMAT);
  const h = r.header;
  w.text(
    JSON.stringify({
      format: h.format,
      simVersion: h.simVersion,
      paramsHash: h.paramsHash,
      trackId: h.trackId,
      worldId: h.worldId,
      vehicleId: h.vehicleId,
      suspensionId: h.suspensionId,
      ticks: h.ticks,
    } satisfies ReplayHeader),
  );
  w.u16(r.start.length);
  for (let i = 0; i < r.start.length; i++) w.f64(r.start[i]!);
  const samples = r.intents.length / CHANNELS;
  w.u32(samples);
  for (let c = 0; c < CHANNELS; c++) {
    let prev = 0;
    for (let j = 0; j < samples; j++) {
      const v = r.intents[j * CHANNELS + c]!;
      w.zigzag(v - prev);
      prev = v;
    }
  }
  w.u16(r.events.length);
  for (const e of r.events) {
    w.varint(e.tick);
    w.u8(KINDS.indexOf(e.kind));
    w.text(e.value);
  }
  w.u16(r.keyframes.length);
  for (let i = 0; i < r.keyframes.length; i++) w.u32(r.keyframes[i]!);
  w.u32(crc32(w.bytes, w.n));
  return w.done();
}

// ---------------------------------------------------------------- decode
/** Why bytes are not a replay this build can play: damaged (truncated, CRC, ranges) or a newer format. */
export type ReplayDecodeError = 'damaged' | 'newer-format';
export type ReplayDecodeResult = { readonly replay: DecodedReplay } | { readonly error: ReplayDecodeError };

class Fail extends Error {
  constructor(readonly reason: ReplayDecodeError) {
    super(reason);
  }
}

class Reader {
  i = 0;
  constructor(readonly b: Uint8Array) {}
  u8(): number {
    if (this.i >= this.b.length) throw new Fail('damaged');
    return this.b[this.i++]!;
  }
  u16(): number {
    return this.u8() | (this.u8() << 8);
  }
  u32(): number {
    return (this.u16() | (this.u16() << 16)) >>> 0;
  }
  varint(): number {
    let v = 0;
    for (let k = 0, scale = 1; k < 5; k++, scale *= 128) {
      const b = this.u8();
      v += (b & 0x7f) * scale;
      if ((b & 0x80) === 0) {
        if (v > 0xffffffff) throw new Fail('damaged');
        return v;
      }
    }
    throw new Fail('damaged');
  }
  zigzag(): number {
    const z = this.varint();
    return z % 2 === 0 ? z / 2 : -(z + 1) / 2;
  }
  f64(): number {
    if (this.i + 8 > this.b.length) throw new Fail('damaged');
    const v = new DataView(this.b.buffer, this.b.byteOffset + this.i, 8).getFloat64(0, true);
    this.i += 8;
    return v;
  }
  text(): string {
    const n = this.u16();
    if (this.i + n > this.b.length) throw new Fail('damaged');
    const s = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(this.b.subarray(this.i, this.i + n));
    this.i += n;
    return s;
  }
}

const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;
const isTicks = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= REPLAY_LIMITS.maxSeconds * 240 + REPLAY_LIMITS.keyframeTicks;

function parseHeader(text: string): ReplayHeader {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    throw new Fail('damaged');
  }
  const h = o as Record<string, unknown>;
  if (typeof h !== 'object' || h === null) throw new Fail('damaged');
  if (h.format !== REPLAY_FORMAT) throw new Fail(typeof h.format === 'number' && h.format > REPLAY_FORMAT ? 'newer-format' : 'damaged');
  if (!isId(h.simVersion) || typeof h.paramsHash !== 'string' || !/^[0-9a-f]{8}$/.test(h.paramsHash)) throw new Fail('damaged');
  if (!isId(h.trackId) || !(h.worldId === null || isId(h.worldId)) || !isId(h.vehicleId) || !isId(h.suspensionId) || !isTicks(h.ticks)) throw new Fail('damaged');
  return {
    format: REPLAY_FORMAT,
    simVersion: h.simVersion,
    paramsHash: h.paramsHash,
    trackId: h.trackId,
    worldId: h.worldId,
    vehicleId: h.vehicleId,
    suspensionId: h.suspensionId,
    ticks: h.ticks,
  };
}

/** Decodes and validates every field; a reason instead of a replay when the bytes are damaged or from a newer format. */
export function decodeReplayResult(bytes: Uint8Array): ReplayDecodeResult {
  try {
    if (bytes.length < MAGIC.length + 5) throw new Fail('damaged');
    for (let k = 0; k < 3; k++) if (bytes[k] !== MAGIC[k]) throw new Fail('damaged');
    // 'SLR2'… = a later layout of the same family
    if (bytes[3] !== MAGIC[3]) throw new Fail(bytes[3]! > MAGIC[3]! && bytes[3]! <= 0x39 ? 'newer-format' : 'damaged');
    const r = new Reader(bytes);
    r.i = 4;
    const format = r.u8();
    if (format !== REPLAY_FORMAT) throw new Fail(format > REPLAY_FORMAT ? 'newer-format' : 'damaged');
    if (bytes.length < 4 + 4 || crc32(bytes, bytes.length - 4) !== new Reader(bytes.subarray(bytes.length - 4)).u32()) throw new Fail('damaged');
    const header = parseHeader(r.text());
    const n = r.u16();
    if (n === 0 || n > MAX_START) throw new Fail('damaged');
    const start = new Float64Array(n);
    for (let k = 0; k < n; k++) start[k] = r.f64();
    const samples = r.u32();
    if (samples !== samplesFor(header.ticks)) throw new Fail('damaged');
    const intents = new Int16Array(samples * CHANNELS);
    const lo = [-INTENT_QUANT.steer, 0, 0, 0, 0];
    const hi = [INTENT_QUANT.steer, INTENT_QUANT.pedal, INTENT_QUANT.pedal, INTENT_QUANT.pedal, 15];
    for (let c = 0; c < CHANNELS; c++) {
      let v = 0;
      for (let j = 0; j < samples; j++) {
        v += r.zigzag();
        if (v < lo[c]! || v > hi[c]!) throw new Fail('damaged');
        intents[j * CHANNELS + c] = v;
      }
    }
    const nEvents = r.u16();
    const events: ReplayEventRecord[] = [];
    let last = 0;
    for (let k = 0; k < nEvents; k++) {
      const tick = r.varint();
      const kind = KINDS[r.u8()];
      const value = r.text();
      if (kind === undefined || tick < last || tick >= header.ticks || value.length > 128) throw new Fail('damaged');
      last = tick;
      events.push({ tick, kind, value });
    }
    const nKeys = r.u16();
    if (nKeys !== keyframesFor(header.ticks)) throw new Fail('damaged');
    const keyframes = new Uint32Array(nKeys);
    for (let k = 0; k < nKeys; k++) keyframes[k] = r.u32();
    if (r.i !== bytes.length - 4) throw new Fail('damaged');
    return { replay: { header, start, intents, events, keyframes } };
  } catch (e) {
    if (e instanceof Fail) return { error: e.reason };
    return { error: 'damaged' };
  }
}

/** null on any structural, range or CRC error (ARCH-M2 §7.1). */
export function decodeReplay(bytes: Uint8Array): DecodedReplay | null {
  const r = decodeReplayResult(bytes);
  return 'replay' in r ? r.replay : null;
}

// ---------------------------------------------------------------- fit (shared by the control and the feature)
export interface ReplayTarget {
  readonly trackId: string;
  readonly worldId: string | null;
  readonly vehicleId: string;
  /** Suspension ids the vehicle offers. */
  readonly suspensions: readonly string[];
  /** paramsHash of (vehicle, that suspension, world) in this build. */
  paramsHash(suspensionId: string): string;
  /** Start snapshot length this build's plant + driver use. */
  readonly startLength: number;
}

export type ReplayRefusal = 'track' | 'world' | 'vehicle' | 'suspension' | 'state';
export type ReplayFit =
  | { readonly ok: true; readonly sameModel: boolean; readonly sameVersion: boolean }
  | { readonly ok: false; readonly reason: ReplayRefusal };

/** Refused when track, world or vehicle differ (or the start state does not fit this build's plant); otherwise playable,
 * with `sameModel`/`sameVersion` false when the replay was recorded with other parameters or another SIM_VERSION. */
export function replayFit(replay: DecodedReplay, target: ReplayTarget): ReplayFit {
  const h = replay.header;
  if (h.trackId !== target.trackId) return { ok: false, reason: 'track' };
  if (h.worldId !== target.worldId) return { ok: false, reason: 'world' };
  if (h.vehicleId !== target.vehicleId) return { ok: false, reason: 'vehicle' };
  if (!target.suspensions.includes(h.suspensionId)) return { ok: false, reason: 'suspension' };
  if (replay.start.length !== target.startLength) return { ok: false, reason: 'state' };
  for (const e of replay.events) if (e.kind === 'suspension' && !target.suspensions.includes(e.value)) return { ok: false, reason: 'suspension' };
  return { ok: true, sameModel: h.paramsHash === target.paramsHash(h.suspensionId), sameVersion: h.simVersion === SIM_VERSION };
}

/** 'abs,traction,stability,steering' subset (ReplayEventRecord value for kind 'aids'). */
export function aidsValue(a: { readonly abs: boolean; readonly traction: boolean; readonly stability: boolean; readonly steering: boolean }): string {
  const on: string[] = [];
  if (a.abs) on.push('abs');
  if (a.traction) on.push('traction');
  if (a.stability) on.push('stability');
  if (a.steering) on.push('steering');
  return on.join(',');
}

export function parseAids(value: string): { abs: boolean; traction: boolean; stability: boolean; steering: boolean } {
  const on = new Set(value.split(','));
  return { abs: on.has('abs'), traction: on.has('traction'), stability: on.has('stability'), steering: on.has('steering') };
}
