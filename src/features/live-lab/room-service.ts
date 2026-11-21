/**
 * The app's single room WebSocket (ROOM service): reconnecting socket, heartbeat, time sync, pick, dispatch.
 * Never throws into the app: any network failure just leaves `connected: false`.
 */
import ReconnectingWebSocket from 'partysocket/ws';
import type { Clock } from '../../contracts/app';
import { API, type ClientMessage, type CreateRoomResponse, type RoomRole, type ServerMessage, type TimeResponse } from '../../contracts/net';
import type { RoomService } from '../../contracts/services';
import { isFinalClose, socketUrl, UNKNOWN_ROOM_CLOSE } from './presence';
import { sampleFrom, TimeSync } from './time-sync';

const HEARTBEAT_MS = 25_000;
const RESYNC_MS = 30_000;
const PROBE_GAP_MS = 150;
const JOIN_PROBES = 8;
const HTTP_PROBES = 5;
const PICK_THROTTLE_MS = 500;
const SCREEN_ROOM_KEY = 'sl-live-lab-screen-room';

type Handler = (message: ServerMessage) => void;

export interface RoomTarget {
  readonly code: string;
  readonly role: RoomRole;
  readonly hostKey: string | null;
  /** Phone-driver pairing key (12-02), only for a screen that created the room; absent on older rooms. */
  readonly driverKey?: string | null;
}

export interface RoomServiceDeps {
  readonly origin: string;
  readonly clientId: string;
  readonly clock: Clock;
  /** Current pick, read at (re)connect and when a pick is sent. */
  readonly pick: () => { vehicleId: string; suspensionId: string };
  readonly onStatus: (connected: boolean) => void;
}

export interface RoomConnection {
  readonly service: RoomService;
  /** Resolve the room (screen: create one), first clock fix over HTTP, then open the socket. */
  start(target: RoomTarget | 'create-screen-room'): Promise<void>;
  /** Trailing-throttled `pick` (suspension/vehicle changed). */
  schedulePick(): void;
  /** Re-probe the clock (tab became visible). */
  resync(): void;
  dispose(): void;
}

export function createRoomConnection(deps: RoomServiceDeps): RoomConnection {
  const handlers = new Map<string, Set<Handler>>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const sync = new TimeSync();
  let ws: ReconnectingWebSocket | null = null;
  let target: RoomTarget | null = null;
  let connected = false;
  let disposed = false;
  let pickTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let resyncTimer: ReturnType<typeof setInterval> | null = null;

  const later = (fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };

  const setConnected = (value: boolean) => {
    if (connected === value) return;
    connected = value;
    deps.onStatus(value);
  };

  const send = (message: ClientMessage) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  };

  const applySample = (c0: number, s1: number, c2: number) => {
    const sample = sampleFrom(c0, s1, c2, Date.now());
    if (sample) deps.clock.setOffset(sync.add(sample));
  };

  const probe = (n: number) => {
    for (let i = 0; i < n; i++) later(() => send({ t: 'sync', c0: performance.now() }), i * PROBE_GAP_MS);
  };

  /** First fix before the socket is up (also the only sync if WebSockets are blocked). */
  const httpFix = async () => {
    for (let i = 0; i < HTTP_PROBES && !disposed; i++) {
      const c0 = performance.now();
      const res = await fetch(API.time, { cache: 'no-store' });
      if (!res.ok) return;
      const { t } = (await res.json()) as TimeResponse;
      applySample(c0, t, performance.now());
    }
  };

  const dispatch = (event: MessageEvent) => {
    if (typeof event.data !== 'string' || event.data[0] !== '{') return; // "pong" heartbeat replies
    let message: ServerMessage;
    try {
      message = JSON.parse(event.data) as ServerMessage;
    } catch {
      return;
    }
    if (message.t === 'sync') applySample(message.c0, message.s1, performance.now());
    if (message.t === 'welcome') {
      setConnected(true);
      probe(JOIN_PROBES);
    }
    for (const handler of handlers.get(message.t) ?? []) {
      try {
        handler(message);
      } catch (err) {
        console.warn('[live-lab] room handler failed', err);
      }
    }
  };

  const createScreenRoom = async (): Promise<RoomTarget | null> => {
    const res = await fetch(API.rooms, { method: 'POST' });
    if (!res.ok) return null;
    const { code, hostKey, driverKey } = (await res.json()) as CreateRoomResponse;
    const room: RoomTarget = { code, role: 'screen', hostKey, driverKey: driverKey ?? null };
    store(SCREEN_ROOM_KEY, JSON.stringify(room));
    return room;
  };

  const open = (room: RoomTarget, mayRecreate = true) => {
    target = room;
    const socket = new ReconnectingWebSocket(
      () => socketUrl({ origin: deps.origin, code: room.code, id: deps.clientId, role: room.role, ...deps.pick() }),
      [],
      {
        minReconnectionDelay: 500 + Math.random() * 500,
        maxReconnectionDelay: 8000,
        reconnectionDelayGrowFactor: 1.5,
        connectionTimeout: 4000,
        minUptime: 5000,
        maxEnqueuedMessages: 0,
        shouldReconnectOnClose: (e) => !isFinalClose(e.code),
      },
    );
    ws = socket;
    socket.addEventListener('message', dispatch);
    socket.addEventListener('close', (e) => {
      setConnected(false);
      if (!isFinalClose(e.code) || disposed || ws !== socket) return;
      socket.close();
      // A screen's remembered room expired: make a fresh one (once).
      if (e.code === UNKNOWN_ROOM_CLOSE && room.role === 'screen' && mayRecreate) {
        store(SCREEN_ROOM_KEY, null);
        createScreenRoom().then(
          (fresh) => fresh && !disposed && open(fresh, false),
          () => undefined,
        );
      }
    });
  };

  const service: RoomService = {
    get code() {
      return target?.code ?? null;
    },
    get role() {
      return target?.role ?? null;
    },
    get hostKey() {
      return target?.hostKey ?? null;
    },
    get driverKey() {
      return target?.driverKey ?? null;
    },
    get connected() {
      return connected;
    },
    send,
    on(type, handler) {
      let set = handlers.get(type);
      if (!set) handlers.set(type, (set = new Set()));
      const h = handler as Handler;
      set.add(h);
      return () => void set.delete(h);
    },
  };

  return {
    service,
    async start(request) {
      try {
        const fix = httpFix();
        let room: RoomTarget | null;
        if (request === 'create-screen-room') {
          const saved = read(SCREEN_ROOM_KEY);
          room = saved ? (JSON.parse(saved) as RoomTarget) : await createScreenRoom();
        } else room = request;
        if (room && !disposed) {
          open(room);
          heartbeat = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('ping'), HEARTBEAT_MS);
          resyncTimer = setInterval(() => probe(2), RESYNC_MS);
        }
        await fix;
      } catch (err) {
        console.warn('[live-lab] offline:', err instanceof Error ? err.message : err);
      }
    },
    schedulePick() {
      if (pickTimer) return;
      pickTimer = setTimeout(() => {
        pickTimer = null;
        send({ t: 'pick', ...deps.pick() });
      }, PICK_THROTTLE_MS);
    },
    resync() {
      if (connected) probe(3);
    },
    dispose() {
      disposed = true;
      for (const id of timers) clearTimeout(id);
      timers.clear();
      if (pickTimer) clearTimeout(pickTimer);
      if (heartbeat) clearInterval(heartbeat);
      if (resyncTimer) clearInterval(resyncTimer);
      ws?.close(1000, 'bye');
      ws = null;
      handlers.clear();
      setConnected(false);
    },
  };
}

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the room just is not remembered */
  }
}
