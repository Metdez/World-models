/**
 * Room Durable Object glue with a fake DurableObjectState and fake hibernatable sockets (the node shim of
 * 'cloudflare:workers' only stores ctx/env). WebSocketPair/101 responses cannot be built in node, so join()
 * is driven directly; the real upgrade path is covered by scripts/smoke-room.mjs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NET_LIMITS, type ServerMessage } from '../../src/contracts/net';
import { CLOSE, ROOM_LIMITS, type Attachment } from '../../worker/room-logic';
import { Room } from '../../worker/room';

class FakeSocket {
  readyState = 1;
  sent: ServerMessage[] = [];
  closed: { code: number; reason: string } | null = null;
  private att: unknown = null;
  serializeAttachment(a: unknown) {
    this.att = structuredClone(a);
  }
  deserializeAttachment() {
    return structuredClone(this.att);
  }
  send(text: string) {
    if (this.readyState !== 1) throw new Error('closed');
    this.sent.push(JSON.parse(text) as ServerMessage);
  }
  close(code: number, reason: string) {
    this.closed = { code, reason };
    this.readyState = 3;
  }
  last<T extends ServerMessage['t']>(t: T) {
    return this.sent.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t).at(-1);
  }
}

function fakeState() {
  const kv = new Map<string, unknown>();
  const votes = new Map<string, { poll: string; choice: number }>();
  let alarm: number | null = null;
  const sockets: FakeSocket[] = [];
  const rows = (r: Record<string, number>[]) => ({ toArray: () => r });
  const state = {
    sockets,
    kv,
    votes,
    alarm: () => alarm,
    ready: Promise.resolve(),
    blockConcurrencyWhile(fn: () => Promise<void>) {
      state.ready = fn();
      return state.ready;
    },
    setWebSocketAutoResponse: vi.fn(),
    acceptWebSocket: (ws: FakeSocket) => sockets.push(ws),
    getWebSockets: () => sockets,
    storage: {
      get: async (k: string) => structuredClone(kv.get(k)),
      put: async (k: string, v: unknown) => void kv.set(k, structuredClone(v)),
      delete: async (k: string) => kv.delete(k),
      deleteAll: async () => {
        kv.clear();
        votes.clear();
        alarm = null;
      },
      getAlarm: async () => alarm,
      setAlarm: async (t: number) => void (alarm = t),
      sql: {
        exec(query: string, ...b: (string | number)[]) {
          if (query.startsWith('CREATE')) return rows([]);
          if (query.startsWith('INSERT OR REPLACE')) {
            votes.set(`${b[0]}|${b[1]}`, { poll: String(b[0]), choice: Number(b[2]) });
            return rows([]);
          }
          if (query.startsWith('DELETE')) {
            for (const [k, v] of votes) if (v.poll !== b[0]) votes.delete(k);
            return rows([]);
          }
          if (query.startsWith('SELECT')) {
            const counts = new Map<number, number>();
            for (const v of votes.values()) if (v.poll === b[0]) counts.set(v.choice, (counts.get(v.choice) ?? 0) + 1);
            return rows([...counts].map(([choice, n]) => ({ choice, n })));
          }
          throw new Error(`unexpected SQL ${query}`);
        },
      },
    },
  };
  return state;
}

type RoomInternals = {
  join(ws: FakeSocket, att: Attachment): void;
  webSocketMessage(ws: FakeSocket, raw: string | ArrayBuffer): Promise<void>;
  webSocketClose(ws: FakeSocket, code: number, reason: string): Promise<void>;
  init(hostKey: string): Promise<boolean>;
  alarm(): Promise<void>;
  fetch(req: Request): Promise<Response>;
};

const HOST_KEY = 'k'.repeat(32);

async function setup() {
  const state = fakeState();
  vi.stubGlobal('WebSocketRequestResponsePair', class {
    constructor(
      readonly request: string,
      readonly response: string,
    ) {}
  });
  const room = new Room(state as unknown as DurableObjectState, {} as Env) as unknown as RoomInternals;
  await state.ready;
  const connect = (att: Attachment) => {
    const ws = new FakeSocket();
    state.acceptWebSocket(ws);
    ws.serializeAttachment(att);
    room.join(ws, att);
    return ws;
  };
  const say = (ws: FakeSocket, m: unknown) => room.webSocketMessage(ws, JSON.stringify(m));
  return { state, room, connect, say };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Room DO', () => {
  it('registers the ping/pong auto-response', async () => {
    const { state } = await setup();
    expect(state.setWebSocketAutoResponse).toHaveBeenCalledOnce();
  });

  it('welcomes with server time and current state, then broadcasts coalesced presence once', async () => {
    const { connect, say } = await setup();
    const a = connect({ id: 'a', role: 'viewer', vehicleId: 'gt-coupe', suspensionId: 'macpherson' });
    const b = connect({ id: 'b', role: 'viewer', vehicleId: 'gt-coupe', suspensionId: 'multilink' });
    const welcome = a.sent[0];
    expect(welcome).toMatchObject({ t: 'welcome', id: 'a', role: 'viewer', serverNow: Date.now(), ctl: { seq: 0 }, poll: null });
    expect(b.sent[0]).toMatchObject({ t: 'welcome', id: 'b' });
    expect(a.last('presence')).toBeUndefined();

    vi.advanceTimersByTime(NET_LIMITS.presenceFlushMs);
    const expected = { t: 'presence', viewers: 2, hosts: 0, dist: { 'gt-coupe:macpherson': 1, 'gt-coupe:multilink': 1 } };
    expect(a.last('presence')).toEqual(expected);
    expect(b.last('presence')).toEqual(expected);

    // A pick to the same value changes nothing; an actual change is broadcast after the flush delay.
    await say(b, { t: 'pick', vehicleId: 'gt-coupe', suspensionId: 'multilink' });
    vi.advanceTimersByTime(NET_LIMITS.presenceFlushMs);
    expect(a.sent.filter((m) => m.t === 'presence')).toHaveLength(1);
    await say(b, { t: 'pick', vehicleId: 'gt-coupe', suspensionId: 'macpherson' });
    await say(b, { t: 'pick', vehicleId: 'gt-coupe', suspensionId: 'double-wishbone' });
    await say(b, { t: 'pick', vehicleId: 'gt-coupe', suspensionId: 'macpherson' });
    vi.advanceTimersByTime(NET_LIMITS.presenceFlushMs);
    expect(a.sent.filter((m) => m.t === 'presence')).toHaveLength(2);
    expect(a.last('presence')).toEqual({ t: 'presence', viewers: 2, hosts: 0, dist: { 'gt-coupe:macpherson': 2 } });
  });

  it('a burst of joins produces one presence broadcast', async () => {
    const { connect } = await setup();
    const first = connect({ id: 'x0', role: 'viewer' });
    for (let i = 1; i < 50; i++) connect({ id: `x${i}`, role: 'viewer' });
    vi.advanceTimersByTime(NET_LIMITS.presenceFlushMs);
    expect(first.sent.filter((m) => m.t === 'presence')).toEqual([{ t: 'presence', viewers: 50, hosts: 0, dist: {} }]);
  });

  it('drops closed sockets from presence and excludes the host', async () => {
    const { connect, room } = await setup();
    const a = connect({ id: 'a', role: 'viewer' });
    const b = connect({ id: 'b', role: 'audience' });
    connect({ id: 'h', role: 'host' });
    vi.advanceTimersByTime(NET_LIMITS.presenceFlushMs);
    expect(a.last('presence')).toMatchObject({ viewers: 2, hosts: 1 });
    b.readyState = 3;
    await room.webSocketClose(b, 1001, 'gone');
    vi.advanceTimersByTime(NET_LIMITS.presenceFlushMs);
    expect(a.last('presence')?.viewers).toBe(1);
  });

  it('answers sync probes with Date.now()', async () => {
    const { connect, say } = await setup();
    const a = connect({ id: 'a', role: 'viewer' });
    await say(a, { t: 'sync', c0: 42.25 });
    expect(a.last('sync')).toEqual({ t: 'sync', c0: 42.25, s1: Date.now() });
  });

  it('rejects host messages from non-hosts and applies them from the host', async () => {
    const { connect, say, state } = await setup();
    const screen = connect({ id: 's', role: 'screen' });
    const host = connect({ id: 'h', role: 'host' });
    await say(screen, { t: 'ctl', set: { xray: true } });
    expect(screen.last('err')).toEqual({ t: 'err', code: 'forbidden' });
    expect(screen.last('ctl')).toBeUndefined();

    await say(host, { t: 'ctl', set: { xray: true, suspensionId: 'multilink' } });
    await say(host, { t: 'ctl', set: { xray: false } });
    expect(screen.last('ctl')).toEqual({ t: 'ctl', state: { seq: 2, xray: false, suspensionId: 'multilink' } });
    expect(state.kv.get('ctl')).toEqual({ seq: 2, xray: false, suspensionId: 'multilink' });
    expect(state.alarm()).toBe(Date.now() + NET_LIMITS.roomIdleTtlMs);

    await say(host, { t: 'cue', cue: 'focus-car' });
    const cue1 = screen.last('cue');
    await say(host, { t: 'cue', cue: 'focus-car' });
    expect(screen.last('cue')!.seq).toBeGreaterThan(cue1!.seq);

    // A screen joining later sees the persisted state in its welcome.
    const late = connect({ id: 'late', role: 'screen' });
    expect(late.sent[0]).toMatchObject({ t: 'welcome', ctl: { seq: 2, xray: false } });
  });

  it('a pending host is welcomed only after a good auth frame; a wrong key closes 4401', async () => {
    const { room, connect, say, state } = await setup();
    await room.init(HOST_KEY);
    const screen = connect({ id: 's', role: 'screen' });
    const pending = new FakeSocket();
    state.acceptWebSocket(pending);
    pending.serializeAttachment({ id: 'h', role: 'host', pending: true });
    await say(pending, { t: 'ctl', set: { xray: true } });
    expect(pending.last('err')).toEqual({ t: 'err', code: 'forbidden' });
    await say(pending, { t: 'auth', k: HOST_KEY });
    expect(pending.last('welcome')).toMatchObject({ role: 'host', id: 'h' });
    vi.advanceTimersByTime(NET_LIMITS.presenceFlushMs);
    expect(screen.last('presence')).toMatchObject({ viewers: 1, hosts: 1 });
    await say(pending, { t: 'ctl', set: { xray: true } });
    expect(screen.last('ctl')).toMatchObject({ state: { xray: true } });

    const intruder = new FakeSocket();
    state.acceptWebSocket(intruder);
    intruder.serializeAttachment({ id: 'x', role: 'host', pending: true });
    await say(intruder, { t: 'auth', k: 'x'.repeat(32) });
    expect(intruder.closed).toEqual({ code: CLOSE.forbidden, reason: 'forbidden' });
    expect(intruder.last('welcome')).toBeUndefined();
  });

  it('runs a poll: one vote per client (re-vote replaces), tally coalesced to 2 Hz, close keeps results', async () => {
    const { connect, say, state } = await setup();
    const host = connect({ id: 'h', role: 'host' });
    const v1 = connect({ id: 'v1', role: 'audience' });
    const v2 = connect({ id: 'v2', role: 'viewer' });
    await say(host, { t: 'poll', poll: { question: 'Best over the kerbs?', options: ['MacPherson', 'Wishbone', 'Multi-link'] } });
    const opened = v1.last('poll')!.poll!;
    expect(opened).toMatchObject({ question: 'Best over the kerbs?', counts: [0, 0, 0], open: true });

    await say(v1, { t: 'vote', pollId: opened.id, choice: 0 });
    await say(v1, { t: 'vote', pollId: opened.id, choice: 1 });
    await say(v2, { t: 'vote', pollId: opened.id, choice: 1 });
    await say(v2, { t: 'vote', pollId: 'stale', choice: 2 });
    const before = v1.sent.length;
    vi.advanceTimersByTime(ROOM_LIMITS.tallyFlushMs);
    expect(v1.sent.length).toBe(before + 1);
    expect(v1.last('poll')!.poll!.counts).toEqual([0, 2, 0]);

    await say(host, { t: 'poll', poll: null });
    expect(v2.last('poll')!.poll).toMatchObject({ id: opened.id, open: false, counts: [0, 2, 0] });
    await say(v1, { t: 'vote', pollId: opened.id, choice: 2 });
    expect(state.votes.size).toBe(2);

    // A new poll discards the old votes.
    await say(host, { t: 'poll', poll: { question: 'Again?', options: ['Yes', 'No'] } });
    expect(state.votes.size).toBe(0);
    expect(connect({ id: 'late', role: 'audience' }).sent[0]).toMatchObject({ t: 'welcome', poll: { question: 'Again?', counts: [0, 0] } });
  });

  it('validates frames: binary and invalid -> err, oversized -> close 1009', async () => {
    const { connect, say, room } = await setup();
    const a = connect({ id: 'a', role: 'viewer' });
    await room.webSocketMessage(a, new ArrayBuffer(4));
    expect(a.last('err')).toEqual({ t: 'err', code: 'bad-message' });
    await room.webSocketMessage(a, '{"t":"pick"');
    await say(a, { t: 'pick', vehicleId: '<script>', suspensionId: 'x' });
    expect(a.sent.filter((m) => m.t === 'err')).toHaveLength(3);
    await room.webSocketMessage(a, JSON.stringify({ t: 'sync', c0: 1, pad: 'x'.repeat(NET_LIMITS.wsMessageBytes) }));
    expect(a.closed).toEqual({ code: CLOSE.tooBig, reason: 'too-big' });
  });

  it('rate limits per connection: drops with one err, closes 1008 on sustained flooding', async () => {
    const { connect, say } = await setup();
    const a = connect({ id: 'a', role: 'viewer' });
    const b = connect({ id: 'b', role: 'viewer' });
    for (let i = 0; i < NET_LIMITS.wsBurst; i++) await say(a, { t: 'sync', c0: i });
    expect(a.sent.filter((m) => m.t === 'sync')).toHaveLength(NET_LIMITS.wsBurst);
    await say(a, { t: 'sync', c0: 99 });
    await say(a, { t: 'sync', c0: 100 });
    expect(a.sent.filter((m) => m.t === 'err')).toEqual([{ t: 'err', code: 'rate' }]);
    // the other socket has its own bucket
    await say(b, { t: 'sync', c0: 1 });
    expect(b.last('sync')).toBeDefined();
    for (let i = 0; i < ROOM_LIMITS.rateStrikes; i++) await say(a, { t: 'sync', c0: i });
    expect(a.closed).toEqual({ code: CLOSE.policy, reason: 'rate' });
  });

  it('init claims a code exactly once and arms the expiry alarm', async () => {
    const { room, state } = await setup();
    expect(await room.init(HOST_KEY)).toBe(true);
    expect(await room.init('other'.repeat(8))).toBe(false);
    expect(state.kv.get('hostKey')).toBe(HOST_KEY);
    expect(state.alarm()).toBe(Date.now() + NET_LIMITS.roomIdleTtlMs);
  });

  it('alarm postpones while sockets are connected and wipes an idle room', async () => {
    const { room, state, connect, say } = await setup();
    await room.init(HOST_KEY);
    const host = connect({ id: 'h', role: 'host' });
    await say(host, { t: 'ctl', set: { xray: true } });
    vi.advanceTimersByTime(1000);
    await room.alarm();
    expect(state.kv.get('ctl')).toBeDefined();
    expect(state.alarm()).toBe(Date.now() + NET_LIMITS.roomIdleTtlMs);
    host.readyState = 3;
    await room.alarm();
    expect(state.kv.size).toBe(0);
    // The code is free again after expiry.
    expect(await room.init(HOST_KEY)).toBe(true);
  });

  it('restores persisted state after hibernation (fresh instance, same storage)', async () => {
    const { room, state, connect, say } = await setup();
    await room.init(HOST_KEY);
    await say(connect({ id: 'h', role: 'host' }), { t: 'ctl', set: { view: 'closeup' } });
    const revived = new Room(state as unknown as DurableObjectState, {} as Env) as unknown as RoomInternals;
    await state.ready;
    expect(await revived.init(HOST_KEY)).toBe(false);
    const ws = new FakeSocket();
    state.acceptWebSocket(ws);
    revived.join(ws, { id: 'n', role: 'screen' });
    expect(ws.sent[0]).toMatchObject({ t: 'welcome', ctl: { seq: 1, view: 'closeup' } });
  });

  it('fetch without an upgrade header answers 426', async () => {
    const { room } = await setup();
    const res = await room.fetch(new Request('https://x/ws/LIVE?id=a&role=viewer&pv=1'));
    expect(res.status).toBe(426);
  });
});
