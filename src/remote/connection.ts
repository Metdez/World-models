/** The remote's room socket (partysocket, no app kernel) and the room / host-key / driver-key parsing of its URL. */
import ReconnectingWebSocket from 'partysocket/ws';
import { PROTOCOL_VERSION, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, WS_PREFIX, type ClientMessage, type RoomRole, type ServerMessage } from '../contracts/net';

const HEARTBEAT_MS = 25_000;
const CLIENT_ID_KEY = 'sl-client-id';
const HOST_KEY_PREFIX = 'sl-remote-host:';
const DRIVER_KEY_PREFIX = 'sl-remote-driver:';
const CODE_RE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);
const KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;

export const normaliseCode = (raw: string | null | undefined): string | null => {
  const code = (raw ?? '').trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
};

/** `#k=KEY` (also accepts `#KEY`); anything else is no key. */
export function hostKeyFromHash(hash: string): string | null {
  const raw = hash.replace(/^#/, '');
  const key = new URLSearchParams(raw).get('k') ?? raw;
  return KEY_RE.test(key) ? key : null;
}

/** `#d=KEY` (the big screen's "Drive from your phone" QR, 12-04); anything else is no driver key. */
export function driverKeyFromHash(hash: string): string | null {
  const key = new URLSearchParams(hash.replace(/^#/, '')).get('d');
  return key !== null && KEY_RE.test(key) ? key : null;
}

/**
 * Room and key for this page. A key moves from the fragment into sessionStorage and the fragment is removed from the
 * address bar, so a reload keeps the role but a shared screenshot or copied link does not carry the key. A fresh
 * fragment replaces the other role's stored key for that room (a phone is a driver or a presenter remote, not both).
 */
export function readRemoteTarget(
  loc: Pick<Location, 'search' | 'hash' | 'pathname'>,
  storage: Storage | null,
): { code: string | null; hostKey: string | null; driverKey: string | null } {
  const code = normaliseCode(new URLSearchParams(loc.search).get('room'));
  if (!code) return { code: null, hostKey: null, driverKey: null };
  let driverKey = driverKeyFromHash(loc.hash);
  let hostKey = driverKey ? null : hostKeyFromHash(loc.hash);
  try {
    if (driverKey) {
      storage?.setItem(DRIVER_KEY_PREFIX + code, driverKey);
      storage?.removeItem(HOST_KEY_PREFIX + code);
    } else if (hostKey) {
      storage?.setItem(HOST_KEY_PREFIX + code, hostKey);
      storage?.removeItem(DRIVER_KEY_PREFIX + code);
    } else {
      driverKey = storage?.getItem(DRIVER_KEY_PREFIX + code) ?? null;
      hostKey = driverKey ? null : (storage?.getItem(HOST_KEY_PREFIX + code) ?? null);
    }
  } catch {
    /* storage blocked: the key lives only as long as the fragment */
  }
  return { code, hostKey, driverKey };
}

export function forgetHostKey(code: string, storage: Storage | null): void {
  try {
    storage?.removeItem(HOST_KEY_PREFIX + code);
    storage?.removeItem(DRIVER_KEY_PREFIX + code);
  } catch {
    /* nothing stored */
  }
}

export function clientId(storage: Storage | null): string {
  try {
    const saved = storage?.getItem(CLIENT_ID_KEY);
    if (saved) return saved;
    const id = crypto.randomUUID();
    storage?.setItem(CLIENT_ID_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export type LinkStatus = 'connecting' | 'live' | 'offline' | 'denied' | 'gone' | 'full' | 'outdated' | 'replaced';

/** Close codes from the room (06-01, 12-02): 4400 protocol, 4401 key, 4404 unknown room, 4409 another driver, 4503 full. */
export function statusForClose(code: number): LinkStatus | null {
  if (code === 4400) return 'outdated';
  if (code === 4401) return 'denied';
  if (code === 4409) return 'replaced';
  if (code === 4404) return 'gone';
  if (code >= 4400 && code < 4600) return 'full';
  return null;
}

export interface RemoteLink {
  send(message: ClientMessage): void;
  /** Bytes queued on the socket (the driver skips a tick while > 0: latest wins). */
  readonly bufferedAmount: number;
  /** Opens again after a final close (a driver taking the wheel back after 4409). */
  reconnect(): void;
  close(): void;
}

export function connectRemote(opts: {
  readonly origin: string;
  readonly code: string;
  readonly role: Extract<RoomRole, 'host' | 'audience' | 'driver'>;
  /** Host or driver key (sent as the first frame); ignored for the audience. */
  readonly key: string | null;
  readonly clientId: string;
  readonly onMessage: (message: ServerMessage) => void;
  readonly onStatus: (status: LinkStatus) => void;
}): RemoteLink {
  const url = new URL(`${WS_PREFIX}${opts.code}`, opts.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('id', opts.clientId);
  url.searchParams.set('role', opts.role);
  url.searchParams.set('pv', String(PROTOCOL_VERSION));

  const ws = new ReconnectingWebSocket(url.toString(), [], {
    minReconnectionDelay: 500 + Math.random() * 500,
    maxReconnectionDelay: 8000,
    reconnectionDelayGrowFactor: 1.5,
    connectionTimeout: 4000,
    maxEnqueuedMessages: 0,
    shouldReconnectOnClose: (e) => statusForClose(e.code) === null,
  });
  opts.onStatus('connecting');
  // The key is the first frame after every (re)open, never part of the URL (which lands in request logs).
  const key = opts.role === 'audience' ? null : opts.key;
  if (key) ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'auth', k: key } satisfies ClientMessage)));
  ws.addEventListener('message', (e) => {
    if (typeof e.data !== 'string' || e.data[0] !== '{') return; // "pong"
    try {
      const message = JSON.parse(e.data) as ServerMessage;
      if (message.t === 'welcome') opts.onStatus('live');
      opts.onMessage(message);
    } catch {
      /* ignore malformed frames */
    }
  });
  ws.addEventListener('close', (e) => {
    const final = statusForClose(e.code);
    opts.onStatus(final ?? 'offline');
    if (final) ws.close();
  });
  const heartbeat = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), HEARTBEAT_MS);
  return {
    send(message) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    },
    get bufferedAmount() {
      return ws.bufferedAmount;
    },
    reconnect() {
      opts.onStatus('connecting');
      ws.reconnect();
    },
    close() {
      clearInterval(heartbeat);
      ws.close(1000, 'bye');
    },
  };
}
