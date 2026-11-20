/** The remote's room socket (partysocket, no app kernel) and the room/host-key parsing of its URL. */
import ReconnectingWebSocket from 'partysocket/ws';
import { PROTOCOL_VERSION, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, WS_PREFIX, type ClientMessage, type RoomRole, type ServerMessage } from '../contracts/net';

const HEARTBEAT_MS = 25_000;
const CLIENT_ID_KEY = 'sl-client-id';
const HOST_KEY_PREFIX = 'sl-remote-host:';
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

/**
 * Room and host key for this page. The key moves from the fragment into sessionStorage and the fragment is removed
 * from the address bar, so a reload keeps the role but a shared screenshot or copied link does not carry the key.
 */
export function readRemoteTarget(loc: Pick<Location, 'search' | 'hash' | 'pathname'>, storage: Storage | null): { code: string | null; hostKey: string | null } {
  const code = normaliseCode(new URLSearchParams(loc.search).get('room'));
  if (!code) return { code: null, hostKey: null };
  let hostKey = hostKeyFromHash(loc.hash);
  try {
    if (hostKey) storage?.setItem(HOST_KEY_PREFIX + code, hostKey);
    else hostKey = storage?.getItem(HOST_KEY_PREFIX + code) ?? null;
  } catch {
    /* storage blocked: the key lives only as long as the fragment */
  }
  return { code, hostKey };
}

export function forgetHostKey(code: string, storage: Storage | null): void {
  try {
    storage?.removeItem(HOST_KEY_PREFIX + code);
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

export type LinkStatus = 'connecting' | 'live' | 'offline' | 'denied' | 'gone' | 'full' | 'outdated';

/** Close codes from the room (06-01): 4400 protocol, 4401 host key, 4404 unknown room, 4503 full. */
export function statusForClose(code: number): LinkStatus | null {
  if (code === 4400) return 'outdated';
  if (code === 4401) return 'denied';
  if (code === 4404) return 'gone';
  if (code >= 4400 && code < 4600) return 'full';
  return null;
}

export interface RemoteLink {
  send(message: ClientMessage): void;
  close(): void;
}

export function connectRemote(opts: {
  readonly origin: string;
  readonly code: string;
  readonly role: Extract<RoomRole, 'host' | 'audience'>;
  readonly hostKey: string | null;
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
  // The host key is the first frame after every (re)open, never part of the URL (which lands in request logs).
  const key = opts.role === 'host' ? opts.hostKey : null;
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
    close() {
      clearInterval(heartbeat);
      ws.close(1000, 'bye');
    },
  };
}
