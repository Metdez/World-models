/**
 * Pure room reducers (ARCHITECTURE §12.4). No I/O, no timers, no Date: callers pass `now`.
 * worker/room.ts is the Durable Object glue that executes the returned effects.
 */
import {
  NET_LIMITS,
  PUBLIC_ROOM,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type ClientMessage,
  type PollState,
  type PresenceSnapshot,
  type PresenterControls,
  type PresenterState,
  type RoomRole,
  type ServerMessage,
} from '../src/contracts/net';
import { isCurrentProtocol, type UpgradeQuery } from './schemas/room';

/** Hibernation-safe per-socket state (serializeAttachment; far below the 2 KB budget). */
export interface Attachment {
  readonly id: string;
  readonly role: RoomRole;
  readonly vehicleId?: string;
  readonly suspensionId?: string;
}

export const ROOM_LIMITS = {
  /** Sockets per room (one DO). Research 17: design for <= 1.5k per DO; above that a shard tree is needed (v2). */
  maxConnections: 1000,
  /** Poll tally broadcast coalescing (<= 2 Hz). */
  tallyFlushMs: 500,
  /** Consecutive over-rate frames before the socket is closed with 1008. */
  rateStrikes: 20,
  /** The expiry alarm is only re-armed when it would move by more than this (each setAlarm is a row write). */
  alarmSlackMs: 3600 * 1000,
} as const;

/** WebSocket close codes. 4xxx are application codes the client treats as final (no reconnect). */
export const CLOSE = {
  policy: 1008,
  tooBig: 1009,
  badRequest: 4400,
  forbidden: 4401,
  unknownRoom: 4404,
  full: 4503,
} as const;

// ---------------------------------------------------------------- codes and keys

const PRIVATE_CODE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

export const isPrivateCode = (code: string): boolean => PRIVATE_CODE.test(code);
export const isRoomCode = (code: string): boolean => code === PUBLIC_ROOM || isPrivateCode(code);

type RandomBytes = (n: number) => Uint8Array;
const cryptoBytes: RandomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

/** Unbiased code from random bytes (rejection sampling); null if the bytes ran out (caller draws again). */
export function roomCodeFromBytes(bytes: Uint8Array): string | null {
  const n = ROOM_CODE_ALPHABET.length;
  const limit = Math.floor(256 / n) * n;
  let code = '';
  for (const b of bytes) {
    if (b >= limit) continue;
    code += ROOM_CODE_ALPHABET[b % n];
    if (code.length === ROOM_CODE_LENGTH) return code;
  }
  return null;
}

export function generateRoomCode(random: RandomBytes = cryptoBytes): string {
  for (;;) {
    const code = roomCodeFromBytes(random(ROOM_CODE_LENGTH * 2));
    if (code) return code;
  }
}

/** 24 random bytes as base64url (32 chars). Matches hostKeySchema. */
export function generateHostKey(random: RandomBytes = cryptoBytes): string {
  const bytes = random(24);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** Constant-time for equal lengths (length itself is not secret: keys have a fixed length). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------- join

export type JoinDecision =
  | { readonly ok: true; readonly attachment: Attachment }
  | { readonly ok: false; readonly close: number; readonly reason: string };

export interface JoinInput {
  readonly code: string;
  readonly query: UpgradeQuery | null;
  /** Stored host key; null for LIVE and for codes never created via POST /api/rooms. */
  readonly hostKey: string | null;
  readonly connections: number;
}

export function decideJoin({ code, query, hostKey, connections }: JoinInput): JoinDecision {
  if (!query) return { ok: false, close: CLOSE.badRequest, reason: 'bad-query' };
  if (!isCurrentProtocol(query)) return { ok: false, close: CLOSE.badRequest, reason: 'protocol' };
  if (code !== PUBLIC_ROOM && hostKey === null) return { ok: false, close: CLOSE.unknownRoom, reason: 'unknown-room' };
  if (query.role === 'host' && (hostKey === null || !timingSafeEqual(query.k ?? '', hostKey))) {
    return { ok: false, close: CLOSE.forbidden, reason: 'forbidden' };
  }
  if (connections >= ROOM_LIMITS.maxConnections) return { ok: false, close: CLOSE.full, reason: 'room-full' };
  const attachment: Attachment =
    query.v !== undefined && query.s !== undefined
      ? { id: query.id, role: query.role, vehicleId: query.v, suspensionId: query.s }
      : { id: query.id, role: query.role };
  return { ok: true, attachment };
}

// ---------------------------------------------------------------- rate limiting

export interface Bucket {
  tokens: number;
  at: number;
  strikes: number;
}

export const newBucket = (now: number): Bucket => ({ tokens: NET_LIMITS.wsBurst, at: now, strikes: 0 });

/** Token bucket (5/s, burst 10). Mutates `b`. `drop` = ignore the frame; `close` = sustained flooding. */
export function takeToken(b: Bucket, now: number): 'ok' | 'drop' | 'close' {
  const elapsed = Math.max(0, now - b.at) / 1000;
  b.tokens = Math.min(NET_LIMITS.wsBurst, b.tokens + elapsed * NET_LIMITS.wsMessagesPerSecond);
  b.at = now;
  if (b.tokens >= 1) {
    b.tokens -= 1;
    b.strikes = 0;
    return 'ok';
  }
  b.strikes++;
  return b.strikes >= ROOM_LIMITS.rateStrikes ? 'close' : 'drop';
}

/** UTF-8 byte length without allocating for the common short frame. */
export function frameTooBig(text: string): boolean {
  if (text.length * 3 <= NET_LIMITS.wsMessageBytes) return false;
  return new TextEncoder().encode(text).byteLength > NET_LIMITS.wsMessageBytes;
}

// ---------------------------------------------------------------- presence

export const distKey = (vehicleId: string, suspensionId: string): string => `${vehicleId}:${suspensionId}`;

/** Viewers = every connection except hosts; dist counts those that reported a pick. */
export function presenceOf(attachments: Iterable<Attachment | null>): PresenceSnapshot {
  let viewers = 0;
  const dist: Record<string, number> = {};
  for (const a of attachments) {
    if (!a || a.role === 'host') continue;
    viewers++;
    if (a.vehicleId !== undefined && a.suspensionId !== undefined) {
      const key = distKey(a.vehicleId, a.suspensionId);
      dist[key] = (dist[key] ?? 0) + 1;
    }
  }
  return { viewers, dist };
}

export function samePresence(a: PresenceSnapshot | null, b: PresenceSnapshot): boolean {
  if (!a || a.viewers !== b.viewers) return false;
  const ka = Object.keys(a.dist);
  if (ka.length !== Object.keys(b.dist).length) return false;
  return ka.every((k) => a.dist[k] === b.dist[k]);
}

// ---------------------------------------------------------------- presenter state

export const INITIAL_CTL: PresenterState = { seq: 0 };

export const mergeCtl = (state: PresenterState, set: PresenterControls): PresenterState => ({ ...state, ...set, seq: state.seq + 1 });

/** Cue sequence: monotonic across hibernation (seeded by wall time). */
export const nextCueSeq = (last: number, now: number): number => Math.max(last + 1, now);

// ---------------------------------------------------------------- poll

export interface PollRecord {
  readonly id: string;
  readonly question: string;
  readonly options: readonly string[];
  readonly open: boolean;
}

export interface VoteCount {
  readonly choice: number;
  readonly n: number;
}

export function tally(poll: PollRecord, rows: Iterable<VoteCount>): PollState {
  const counts = poll.options.map(() => 0);
  for (const r of rows) if (r.choice >= 0 && r.choice < counts.length) counts[r.choice] = r.n;
  return { id: poll.id, question: poll.question, options: poll.options, counts, open: poll.open };
}

// ---------------------------------------------------------------- message reducer

export type Effect =
  | { readonly k: 'reply'; readonly msg: ServerMessage }
  /** Persist the new attachment and mark presence dirty. */
  | { readonly k: 'attach'; readonly attachment: Attachment }
  /** Persist and broadcast the new presenter state. */
  | { readonly k: 'ctl'; readonly state: PresenterState }
  | { readonly k: 'cue'; readonly cue: Extract<ClientMessage, { t: 'cue' }>['cue'] }
  /** Persist the poll (null = none) and broadcast its tally now. */
  | { readonly k: 'poll'; readonly poll: PollRecord | null }
  /** Record the vote (one per client id per poll) and mark the tally dirty. */
  | { readonly k: 'vote'; readonly pollId: string; readonly voterId: string; readonly choice: number };

export interface RoomView {
  readonly ctl: PresenterState;
  readonly poll: PollRecord | null;
  readonly now: number;
  readonly newPollId: () => string;
}

const forbidden: Effect = { k: 'reply', msg: { t: 'err', code: 'forbidden' } };

export function reduceMessage(att: Attachment, msg: ClientMessage, room: RoomView): readonly Effect[] {
  switch (msg.t) {
    case 'sync':
      return [{ k: 'reply', msg: { t: 'sync', c0: msg.c0, s1: room.now } }];
    case 'pick':
      if (att.role === 'host') return [];
      if (att.vehicleId === msg.vehicleId && att.suspensionId === msg.suspensionId) return [];
      return [{ k: 'attach', attachment: { id: att.id, role: att.role, vehicleId: msg.vehicleId, suspensionId: msg.suspensionId } }];
    case 'ctl':
      if (att.role !== 'host') return [forbidden];
      return [{ k: 'ctl', state: mergeCtl(room.ctl, msg.set) }];
    case 'cue':
      if (att.role !== 'host') return [forbidden];
      return [{ k: 'cue', cue: msg.cue }];
    case 'poll':
      if (att.role !== 'host') return [forbidden];
      if (msg.poll === null) return room.poll?.open ? [{ k: 'poll', poll: { ...room.poll, open: false } }] : [];
      return [{ k: 'poll', poll: { id: room.newPollId(), question: msg.poll.question, options: msg.poll.options, open: true } }];
    case 'vote': {
      const p = room.poll;
      if (!p || !p.open || p.id !== msg.pollId || msg.choice >= p.options.length) return [];
      return [{ k: 'vote', pollId: p.id, voterId: att.id, choice: msg.choice }];
    }
  }
}

// ---------------------------------------------------------------- expiry

/** Returns the new alarm time, or null when the current one is close enough (saves a row write). */
export function alarmToSet(current: number | null, now: number): number | null {
  const target = now + NET_LIMITS.roomIdleTtlMs;
  return current === null || target - current > ROOM_LIMITS.alarmSlackMs ? target : null;
}

/** On alarm: a room with live sockets is not idle (activity re-arms lazily), so postpone instead of wiping. */
export const expireOnAlarm = (connections: number): boolean => connections === 0;
