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
  laneOf,
  frameLimit,
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
const DKEY = 'ZYXWVUTSRQPONMLKJIHGFEDCBA_-9876';

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
    const d = decideJoin({ code: PUBLIC_ROOM, query: q({ v: 'gt-coupe', s: 'macpherson' }), hostKey: null, driverKey: null, connections: 3 });
    expect(d).toEqual({ ok: true, attachment: { id: 'client-1', role: 'viewer', vehicleId: 'gt-coupe', suspensionId: 'macpherson' } });
  });

  it('omits a half-specified pick', () => {
    const d = decideJoin({ code: PUBLIC_ROOM, query: q({ v: 'gt-coupe' }), hostKey: null, driverKey: null, connections: 0 });
    expect(d).toEqual({ ok: true, attachment: { id: 'client-1', role: 'viewer' } });
  });

  it('rejects bad queries and stale protocol versions with 4400', () => {
    expect(decideJoin({ code: PUBLIC_ROOM, query: null, hostKey: null, driverKey: null, connections: 0 })).toMatchObject({ ok: false, close: CLOSE.badRequest });
    expect(decideJoin({ code: PUBLIC_ROOM, query: q({ pv: PROTOCOL_VERSION + 1 }), hostKey: null, driverKey: null, connections: 0 })).toMatchObject({
      ok: false,
      close: CLOSE.badRequest,
      reason: 'protocol',
    });
  });

  it('rejects private codes that were never created (4404)', () => {
    expect(decideJoin({ code: 'ABCDE', query: q(), hostKey: null, driverKey: null, connections: 0 })).toMatchObject({ ok: false, close: CLOSE.unknownRoom });
    expect(decideJoin({ code: 'ABCDE', query: q(), hostKey: KEY, driverKey: null, connections: 0 }).ok).toBe(true);
  });

  it('admits role=host only as pending (the key comes in the auth frame); LIVE has no host (4401)', () => {
    expect(decideJoin({ code: PUBLIC_ROOM, query: q({ role: 'host' }), hostKey: null, driverKey: null, connections: 0 })).toMatchObject({ close: CLOSE.forbidden });
    expect(decideJoin({ code: 'ABCDE', query: q({ role: 'host', v: 'gt-coupe', s: 'macpherson' }), hostKey: KEY, driverKey: null, connections: 0 })).toEqual({
      ok: true,
      attachment: { id: 'client-1', role: 'host', pending: true },
    });
  });

  it('bounds the room size with a clear close code', () => {
    const full = decideJoin({ code: PUBLIC_ROOM, query: q(), hostKey: null, driverKey: null, connections: ROOM_LIMITS.maxConnections });
    expect(full).toEqual({ ok: false, close: CLOSE.full, reason: 'room-full' });
    expect(decideJoin({ code: PUBLIC_ROOM, query: q(), hostKey: null, driverKey: null, connections: ROOM_LIMITS.maxConnections - 1 }).ok).toBe(true);
  });
});

describe('token bucket', () => {
  it('allows a burst of 10, then 5 per second', () => {
    const b = newBucket(0);
    for (let i = 0; i < NET_LIMITS.wsBurst; i++) expect(takeToken(b, 0)).toBe('ok');
    expect(takeToken(b, 0)).toBe('drop');
    expect(takeToken(b, 199)).toBe('drop'); // 0.995 tokens
    // 0.4 s since empty = 2 tokens
    expect(takeToken(b, 400)).toBe('ok');
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
    expect(p).toEqual({ viewers: 4, hosts: 1, drivers: 0, dist: { 'gt-coupe:macpherson': 2, 'gt-coupe:multilink': 1 } });
    expect(presenceOf([{ id: '6', role: 'host', pending: true }]).hosts).toBe(0);
  });

  it('detects unchanged snapshots (coalescing skips the broadcast)', () => {
    const p = { viewers: 2, hosts: 0, dist: { 'a:b': 1, 'a:c': 1 } };
    expect(samePresence(null, p)).toBe(false);
    expect(samePresence(p, { viewers: 2, hosts: 0, dist: { 'a:c': 1, 'a:b': 1 } })).toBe(true);
    expect(samePresence(p, { viewers: 2, hosts: 0, dist: { 'a:b': 2 } })).toBe(false);
    expect(samePresence(p, { viewers: 3, hosts: 0, dist: p.dist })).toBe(false);
    expect(samePresence(p, { viewers: 2, hosts: 0, dist: { 'a:b': 1, 'a:d': 1 } })).toBe(false);
    expect(samePresence(p, { ...p, hosts: 1 })).toBe(false);
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
  const room = (over: Partial<RoomView> = {}): RoomView => ({ hostKey: KEY, driverKey: DKEY, ctl: { seq: 4 }, poll: null, now: 1234, newPollId: () => 'p2', ...over });

  it('a pending host authenticates with its first frame; anything else (or a wrong key) is refused', () => {
    const pending: Attachment = { id: 'h1', role: 'host', pending: true };
    expect(reduceMessage(pending, { t: 'auth', k: KEY }, room())).toEqual([{ k: 'attach', attachment: { id: 'h1', role: 'host' } }, { k: 'welcome' }]);
    expect(reduceMessage(pending, { t: 'auth', k: KEY.toUpperCase() }, room())).toEqual([{ k: 'close', code: CLOSE.forbidden, reason: 'forbidden' }]);
    expect(reduceMessage(pending, { t: 'auth', k: KEY }, room({ hostKey: null }))).toEqual([{ k: 'close', code: CLOSE.forbidden, reason: 'forbidden' }]);
    expect(reduceMessage(pending, { t: 'ctl', set: { xray: true } }, room())).toEqual([{ k: 'reply', msg: { t: 'err', code: 'forbidden' } }]);
    expect(reduceMessage(viewer, { t: 'auth', k: KEY }, room())).toEqual([]);
  });

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

  it('host opens, closes and then clears polls', () => {
    expect(reduceMessage(host, { t: 'poll', poll: { question: 'Q?', options: ['A', 'B'] } }, room())).toEqual([
      { k: 'poll', poll: { id: 'p2', question: 'Q?', options: ['A', 'B'], open: true } },
    ]);
    expect(reduceMessage(host, { t: 'poll', poll: null }, room({ poll }))).toEqual([{ k: 'poll', poll: { ...poll, open: false } }]);
    expect(reduceMessage(host, { t: 'poll', poll: null }, room({ poll: { ...poll, open: false } }))).toEqual([{ k: 'poll', poll: null }]);
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

describe('driver role (12-02)', () => {
  const room = (over: Partial<RoomView> = {}): RoomView => ({ hostKey: KEY, driverKey: DKEY, ctl: { seq: 0 }, poll: null, now: 5000, newPollId: () => 'p', ...over });
  const driver: Attachment = { id: 'd1', role: 'driver' };
  const forbidden = [{ k: 'reply', msg: { t: 'err', code: 'forbidden' } }];

  it('admits role=driver only as pending in rooms with a driver key; LIVE and pre-12-02 rooms refuse 4401', () => {
    expect(decideJoin({ code: 'ABCDE', query: q({ role: 'driver' }), hostKey: KEY, driverKey: DKEY, connections: 0 })).toEqual({
      ok: true,
      attachment: { id: 'client-1', role: 'driver', pending: true },
    });
    expect(decideJoin({ code: PUBLIC_ROOM, query: q({ role: 'driver' }), hostKey: null, driverKey: null, connections: 0 })).toMatchObject({ close: CLOSE.forbidden });
    expect(decideJoin({ code: 'ABCDE', query: q({ role: 'driver' }), hostKey: KEY, driverKey: null, connections: 0 })).toMatchObject({ close: CLOSE.forbidden });
  });

  it('authenticates with the driver key only (timing-safe); success replaces older drivers', () => {
    const pending: Attachment = { id: 'd1', role: 'driver', pending: true };
    expect(reduceMessage(pending, { t: 'auth', k: DKEY }, room())).toEqual([
      { k: 'attach', attachment: { id: 'd1', role: 'driver' } },
      { k: 'welcome' },
      { k: 'replace-driver' },
    ]);
    const close = [{ k: 'close', code: CLOSE.forbidden, reason: 'forbidden' }];
    expect(reduceMessage(pending, { t: 'auth', k: KEY }, room())).toEqual(close); // the host key is not a driver key
    expect(reduceMessage(pending, { t: 'auth', k: DKEY }, room({ driverKey: null }))).toEqual(close);
    expect(reduceMessage({ id: 'h', role: 'host', pending: true }, { t: 'auth', k: DKEY }, room())).toEqual(close);
    expect(reduceMessage(pending, { t: 'in', n: 1, s: 0, th: 0, br: 0, f: 1 }, room())).toEqual(forbidden);
    expect(CLOSE.replaced).toBe(4409);
  });

  it('relays `in` to screens stamped with the room time; `tel` from screens to the driver; others are forbidden', () => {
    const frame = { t: 'in', n: 7, s: -250, th: 1000, br: 0, f: 5 } as const;
    expect(reduceMessage(driver, frame, room())).toEqual([{ k: 'to-screens', msg: { ...frame, r: 5000 } }]);
    const tel = { t: 'tel', v: 87, g: 3, m: 1, k: 2 } as const;
    expect(reduceMessage({ id: 's', role: 'screen' }, tel, room())).toEqual([{ k: 'to-driver', msg: tel }]);
    for (const role of ['viewer', 'screen', 'audience', 'host'] as const) expect(reduceMessage({ id: 'x', role }, frame, room())).toEqual(forbidden);
    for (const role of ['viewer', 'audience', 'host', 'driver'] as const) expect(reduceMessage({ id: 'x', role }, tel, room())).toEqual(forbidden);
    // A driver has no presenter powers and no pick.
    expect(reduceMessage(driver, { t: 'ctl', set: { xray: true } }, room())).toEqual(forbidden);
    expect(reduceMessage(driver, { t: 'pick', vehicleId: 'gt-coupe', suspensionId: 'multilink' }, room())).toEqual([]);
    expect(reduceMessage(driver, { t: 'sync', c0: 1 }, room())).toEqual([{ k: 'reply', msg: { t: 'sync', c0: 1, s1: 5000 } }]);
  });

  it('per-role lanes: drivers 90/s burst 30, screen telemetry 5/s, viewers unchanged; 128 B driver frames', () => {
    expect(laneOf('driver', 'in')).toBe('driver');
    expect(laneOf('driver', null)).toBe('driver');
    expect(laneOf('screen', 'tel')).toBe('tel');
    expect(laneOf('screen', 'sync')).toBe('general');
    expect(laneOf('viewer', 'tel')).toBe('general');
    expect(laneOf('audience', 'in')).toBe('general');
    const b = newBucket(0, 'driver');
    for (let i = 0; i < NET_LIMITS.driverBurst; i++) expect(takeToken(b, 0, 'driver')).toBe('ok');
    expect(takeToken(b, 0, 'driver')).toBe('drop');
    // A steady 60 Hz stream for 30 s never drops (refill 90/s).
    const s = newBucket(0, 'driver');
    let drops = 0;
    for (let i = 0; i < 1800; i++) if (takeToken(s, (i * 1000) / 60, 'driver') !== 'ok') drops++;
    expect(drops).toBe(0);
    // ...while the same stream on the general lane (the M1 blocker) would lose most frames.
    const g = newBucket(0);
    const lost = Array.from({ length: 1800 }, (_, i) => takeToken(g, (i * 1000) / 60)).filter((v) => v !== 'ok').length;
    expect(lost).toBeGreaterThan(1600);
    const t = newBucket(0, 'tel');
    for (let i = 0; i < NET_LIMITS.telemetryPerSecond; i++) expect(takeToken(t, 0, 'tel')).toBe('ok');
    expect(takeToken(t, 0, 'tel')).toBe('drop');
    expect(frameLimit('driver')).toBe(NET_LIMITS.driverMessageBytes);
    expect(frameLimit('viewer')).toBe(NET_LIMITS.wsMessageBytes);
    expect(frameTooBig('x'.repeat(129), frameLimit('driver'))).toBe(true);
    expect(frameTooBig(JSON.stringify({ t: 'in', n: 4294967295, s: -1000, th: 1000, br: 1000, f: 7 }), frameLimit('driver'))).toBe(false);
  });

  it('presence counts authenticated drivers apart from viewers', () => {
    const p = presenceOf([{ id: '1', role: 'screen' }, { id: 'd', role: 'driver' }, { id: 'e', role: 'driver', pending: true }]);
    expect(p).toEqual({ viewers: 1, hosts: 0, drivers: 1, dist: {} });
    expect(samePresence(p, { ...p, drivers: 0 })).toBe(false);
  });
});
