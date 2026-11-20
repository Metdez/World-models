import { describe, expect, it } from 'vitest';
import { NET_LIMITS, PROTOCOL_VERSION, PUBLIC_ROOM, ROOM_CODE_ALPHABET } from '../../src/contracts/net';
import {
  alarmToSet,
  CLOSE,
  decideJoin,
  expireOnAlarm,
  frameTooBig,
  generateHostKey,
  generateRoomCode,
  isPrivateCode,
  isRoomCode,
  mergeCtl,
  newBucket,
  nextCueSeq,
  presenceOf,
  reduceMessage,
  ROOM_LIMITS,
  roomCodeFromBytes,
  samePresence,
  takeToken,
  tally,
  timingSafeEqual,
  type Attachment,
  type PollRecord,
  type RoomView,
} from '../../worker/room-logic';
import { hostKeySchema, type UpgradeQuery } from '../../worker/schemas/room';

const q = (over: Partial<UpgradeQuery> = {}): UpgradeQuery => ({ id: 'client-1', role: 'viewer', pv: PROTOCOL_VERSION, ...over });
const KEY = 'abcdefghijklmnopqrstuvwxyz012345';

describe('room codes and host keys', () => {
  it('generates 5-char codes from the unambiguous alphabet, never LIVE', () => {
    for (let i = 0; i < 500; i++) {
      const code = generateRoomCode();
      expect(code).toMatch(new RegExp(`^[${ROOM_CODE_ALPHABET}]{5}$`));
      expect(isPrivateCode(code)).toBe(true);
    }
    expect(isPrivateCode(PUBLIC_ROOM)).toBe(false);
    expect(isRoomCode(PUBLIC_ROOM)).toBe(true);
    expect(isRoomCode('ABCD1')).toBe(false); // 1 is not in the alphabet
    expect(isRoomCode('abcde')).toBe(false);
  });

  it('rejection-samples biased bytes and reports exhaustion', () => {
    const limit = Math.floor(256 / ROOM_CODE_ALPHABET.length) * ROOM_CODE_ALPHABET.length;
    expect(roomCodeFromBytes(new Uint8Array([limit, 0, 1, 2, 3, 4]))).toBe('ABCDE');
    expect(roomCodeFromBytes(new Uint8Array([255, 255, 0]))).toBeNull();
    let calls = 0;
    const code = generateRoomCode((n) => (calls++ === 0 ? new Uint8Array(n).fill(255) : new Uint8Array(n)));
    expect(code).toBe('AAAAA');
    expect(calls).toBe(2);
  });

  it('host keys are url-safe, 32 chars and valid for the upgrade schema', () => {
    const key = generateHostKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(hostKeySchema.safeParse(key).success).toBe(true);
    expect(generateHostKey((n) => new Uint8Array(n).fill(0xfb))).toMatch(/^[-_A-Za-z0-9]+$/);
  });

  it('compares keys in constant time per length', () => {
    expect(timingSafeEqual(KEY, KEY)).toBe(true);
    expect(timingSafeEqual(KEY, KEY.slice(0, -1) + 'x')).toBe(false);
    expect(timingSafeEqual(KEY, KEY.slice(1))).toBe(false);
    expect(timingSafeEqual('', '')).toBe(false);
  });
});

describe('decideJoin', () => {
  it('admits viewers to LIVE with their pick as attachment', () => {
    const d = decideJoin({ code: PUBLIC_ROOM, query: q({ v: 'gt-coupe', s: 'macpherson' }), hostKey: null, connections: 3 });
    expect(d).toEqual({ ok: true, attachment: { id: 'client-1', role: 'viewer', vehicleId: 'gt-coupe', suspensionId: 'macpherson' } });
  });

  it('omits a half-specified pick', () => {
    const d = decideJoin({ code: PUBLIC_ROOM, query: q({ v: 'gt-coupe' }), hostKey: null, connections: 0 });
    expect(d).toEqual({ ok: true, attachment: { id: 'client-1', role: 'viewer' } });
  });

  it('rejects bad queries and stale protocol versions with 4400', () => {
    expect(decideJoin({ code: PUBLIC_ROOM, query: null, hostKey: null, connections: 0 })).toMatchObject({ ok: false, close: CLOSE.badRequest });
    expect(decideJoin({ code: PUBLIC_ROOM, query: q({ pv: PROTOCOL_VERSION + 1 }), hostKey: null, connections: 0 })).toMatchObject({
      ok: false,
      close: CLOSE.badRequest,
      reason: 'protocol',
    });
  });

  it('rejects private codes that were never created (4404)', () => {
    expect(decideJoin({ code: 'ABCDE', query: q(), hostKey: null, connections: 0 })).toMatchObject({ ok: false, close: CLOSE.unknownRoom });
    expect(decideJoin({ code: 'ABCDE', query: q(), hostKey: KEY, connections: 0 }).ok).toBe(true);
  });

  it('requires a matching host key for role=host; LIVE has none (4401)', () => {
    expect(decideJoin({ code: PUBLIC_ROOM, query: q({ role: 'host', k: KEY }), hostKey: null, connections: 0 })).toMatchObject({ close: CLOSE.forbidden });
    expect(decideJoin({ code: 'ABCDE', query: q({ role: 'host' }), hostKey: KEY, connections: 0 })).toMatchObject({ close: CLOSE.forbidden });
    expect(decideJoin({ code: 'ABCDE', query: q({ role: 'host', k: KEY.toUpperCase() }), hostKey: KEY, connections: 0 })).toMatchObject({
      close: CLOSE.forbidden,
    });
    expect(decideJoin({ code: 'ABCDE', query: q({ role: 'host', k: KEY }), hostKey: KEY, connections: 0 }).ok).toBe(true);
  });

  it('bounds the room size with a clear close code', () => {
    const full = decideJoin({ code: PUBLIC_ROOM, query: q(), hostKey: null, connections: ROOM_LIMITS.maxConnections });
    expect(full).toEqual({ ok: false, close: CLOSE.full, reason: 'room-full' });
    expect(decideJoin({ code: PUBLIC_ROOM, query: q(), hostKey: null, connections: ROOM_LIMITS.maxConnections - 1 }).ok).toBe(true);
  });
});

describe('token bucket', () => {
  it('allows a burst of 10, then 5 per second', () => {
    const b = newBucket(0);
    for (let i = 0; i < NET_LIMITS.wsBurst; i++) expect(takeToken(b, 0)).toBe('ok');
    expect(takeToken(b, 0)).toBe('drop');
    expect(takeToken(b, 199)).toBe('drop'); // 0.995 tokens
    expect(takeToken(b, 400)).toBe('ok');
    expect(takeToken(b, 400)).toBe('drop');
    // a long pause refills to the burst cap, not beyond
    const after = 100_000;
    let ok = 0;
    while (takeToken(b, after) === 'ok') ok++;
    expect(ok).toBe(NET_LIMITS.wsBurst);
  });

  it('closes only on sustained flooding; a good frame resets strikes', () => {
    const b = newBucket(0);
    for (let i = 0; i < NET_LIMITS.wsBurst; i++) takeToken(b, 0);
    for (let i = 1; i < ROOM_LIMITS.rateStrikes; i++) expect(takeToken(b, 0)).toBe('drop');
    expect(takeToken(b, 0)).toBe('close');
    const c = newBucket(0);
    for (let i = 0; i < NET_LIMITS.wsBurst + 5; i++) takeToken(c, 0);
    expect(takeToken(c, 1000)).toBe('ok');
    expect(c.strikes).toBe(0);
  });

  it('ignores a clock that goes backwards', () => {
    const b = newBucket(1000);
    for (let i = 0; i < NET_LIMITS.wsBurst; i++) takeToken(b, 1000);
    expect(takeToken(b, 0)).toBe('drop');
    expect(b.tokens).toBeGreaterThanOrEqual(0);
  });

  it('measures frame size in UTF-8 bytes', () => {
    expect(frameTooBig('x'.repeat(NET_LIMITS.wsMessageBytes))).toBe(false);
    expect(frameTooBig('x'.repeat(NET_LIMITS.wsMessageBytes + 1))).toBe(true);
    expect(frameTooBig('é'.repeat(NET_LIMITS.wsMessageBytes / 2))).toBe(false);
    expect(frameTooBig('é'.repeat(NET_LIMITS.wsMessageBytes / 2 + 1))).toBe(true);
  });
});

describe('presence', () => {
  const a = (id: string, role: Attachment['role'], s?: string): Attachment =>
    s ? { id, role, vehicleId: 'gt-coupe', suspensionId: s } : { id, role };

  it('counts everyone but hosts and builds the vehicle:suspension distribution', () => {
    const p = presenceOf([a('1', 'viewer', 'macpherson'), a('2', 'viewer', 'macpherson'), a('3', 'screen', 'multilink'), a('4', 'audience'), a('5', 'host', 'x'), null]);
    expect(p).toEqual({ viewers: 4, dist: { 'gt-coupe:macpherson': 2, 'gt-coupe:multilink': 1 } });
  });

  it('detects unchanged snapshots (coalescing skips the broadcast)', () => {
    const p = { viewers: 2, dist: { 'a:b': 1, 'a:c': 1 } };
    expect(samePresence(null, p)).toBe(false);
    expect(samePresence(p, { viewers: 2, dist: { 'a:c': 1, 'a:b': 1 } })).toBe(true);
    expect(samePresence(p, { viewers: 2, dist: { 'a:b': 2 } })).toBe(false);
    expect(samePresence(p, { viewers: 3, dist: p.dist })).toBe(false);
    expect(samePresence(p, { viewers: 2, dist: { 'a:b': 1, 'a:d': 1 } })).toBe(false);
  });
});

describe('presenter state, cues and poll tally', () => {
  it('merges ctl with a monotonic seq', () => {
    const s1 = mergeCtl({ seq: 0 }, { suspensionId: 'macpherson', xray: true });
    const s2 = mergeCtl(s1, { xray: false, view: 'closeup' });
    expect(s2).toEqual({ seq: 2, suspensionId: 'macpherson', xray: false, view: 'closeup' });
  });

  it('cue seq is monotonic even if the wall clock stalls', () => {
    expect(nextCueSeq(0, 1000)).toBe(1000);
    expect(nextCueSeq(1000, 1000)).toBe(1001);
    expect(nextCueSeq(1001, 900)).toBe(1002);
  });

  it('tallies votes per option and ignores out-of-range rows', () => {
    const poll: PollRecord = { id: 'p', question: 'Best on the kerbs?', options: ['A', 'B', 'C'], open: true };
    expect(tally(poll, [{ choice: 0, n: 3 }, { choice: 2, n: 1 }, { choice: 7, n: 9 }])).toEqual({ ...poll, counts: [3, 0, 1] });
  });
});

describe('reduceMessage', () => {
  const viewer: Attachment = { id: 'v1', role: 'viewer', vehicleId: 'gt-coupe', suspensionId: 'macpherson' };
  const host: Attachment = { id: 'h1', role: 'host' };
  const poll: PollRecord = { id: 'p1', question: 'Q?', options: ['A', 'B'], open: true };
  const room = (over: Partial<RoomView> = {}): RoomView => ({ ctl: { seq: 4 }, poll: null, now: 1234, newPollId: () => 'p2', ...over });

  it('answers sync with the server stamp', () => {
    expect(reduceMessage(viewer, { t: 'sync', c0: 55.5 }, room())).toEqual([{ k: 'reply', msg: { t: 'sync', c0: 55.5, s1: 1234 } }]);
  });

  it('pick updates the attachment only when it changed; hosts have no pick', () => {
    expect(reduceMessage(viewer, { t: 'pick', vehicleId: 'gt-coupe', suspensionId: 'macpherson' }, room())).toEqual([]);
    expect(reduceMessage(viewer, { t: 'pick', vehicleId: 'gt-coupe', suspensionId: 'multilink' }, room())).toEqual([
      { k: 'attach', attachment: { id: 'v1', role: 'viewer', vehicleId: 'gt-coupe', suspensionId: 'multilink' } },
    ]);
    expect(reduceMessage(host, { t: 'pick', vehicleId: 'gt-coupe', suspensionId: 'multilink' }, room())).toEqual([]);
  });

  it('host-only messages are forbidden for everyone else', () => {
    const forbidden = [{ k: 'reply', msg: { t: 'err', code: 'forbidden' } }];
    for (const role of ['viewer', 'screen', 'audience'] as const) {
      const att = { id: 'x', role };
      expect(reduceMessage(att, { t: 'ctl', set: { xray: true } }, room())).toEqual(forbidden);
      expect(reduceMessage(att, { t: 'cue', cue: 'focus-car' }, room())).toEqual(forbidden);
      expect(reduceMessage(att, { t: 'poll', poll: null }, room())).toEqual(forbidden);
    }
  });

  it('host ctl advances seq; cue passes through', () => {
    expect(reduceMessage(host, { t: 'ctl', set: { timeScale: 0.25 } }, room())).toEqual([{ k: 'ctl', state: { seq: 5, timeScale: 0.25 } }]);
    expect(reduceMessage(host, { t: 'cue', cue: 'replay-section' }, room())).toEqual([{ k: 'cue', cue: 'replay-section' }]);
  });

  it('host opens and closes polls; closing twice is a no-op', () => {
    expect(reduceMessage(host, { t: 'poll', poll: { question: 'Q?', options: ['A', 'B'] } }, room())).toEqual([
      { k: 'poll', poll: { id: 'p2', question: 'Q?', options: ['A', 'B'], open: true } },
    ]);
    expect(reduceMessage(host, { t: 'poll', poll: null }, room({ poll }))).toEqual([{ k: 'poll', poll: { ...poll, open: false } }]);
    expect(reduceMessage(host, { t: 'poll', poll: null }, room({ poll: { ...poll, open: false } }))).toEqual([]);
    expect(reduceMessage(host, { t: 'poll', poll: null }, room())).toEqual([]);
  });

  it('votes only for the open poll and a valid option', () => {
    const audience: Attachment = { id: 'a1', role: 'audience' };
    expect(reduceMessage(audience, { t: 'vote', pollId: 'p1', choice: 1 }, room({ poll }))).toEqual([
      { k: 'vote', pollId: 'p1', voterId: 'a1', choice: 1 },
    ]);
    expect(reduceMessage(audience, { t: 'vote', pollId: 'p1', choice: 2 }, room({ poll }))).toEqual([]);
    expect(reduceMessage(audience, { t: 'vote', pollId: 'old', choice: 0 }, room({ poll }))).toEqual([]);
    expect(reduceMessage(audience, { t: 'vote', pollId: 'p1', choice: 0 }, room({ poll: { ...poll, open: false } }))).toEqual([]);
    expect(reduceMessage(audience, { t: 'vote', pollId: 'p1', choice: 0 }, room())).toEqual([]);
  });
});

describe('expiry alarm', () => {
  it('sets the alarm 12 h out, re-arming at most once per slack period', () => {
    expect(alarmToSet(null, 0)).toBe(NET_LIMITS.roomIdleTtlMs);
    expect(alarmToSet(NET_LIMITS.roomIdleTtlMs, 60_000)).toBeNull();
    const later = ROOM_LIMITS.alarmSlackMs + 1;
    expect(alarmToSet(NET_LIMITS.roomIdleTtlMs, later)).toBe(later + NET_LIMITS.roomIdleTtlMs);
  });

  it('wipes only rooms without connections', () => {
    expect(expireOnAlarm(0)).toBe(true);
    expect(expireOnAlarm(1)).toBe(false);
  });
});
