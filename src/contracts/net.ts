/**
 * Worker HTTP API + room WebSocket protocol. Shared by src/ (client) and worker/ (server).
 * Types only + constants. Runtime validation lives in worker/schemas.ts (zod), type-tested against these.
 */
import type { ViewMode, OverlayLevel } from './store';

export const API = {
  health: '/api/health',
  time: '/api/time',
  rooms: '/api/rooms',
  engineer: '/api/engineer',
  event: '/api/event',
  /** POST saves a replay (Turnstile + limits); GET `${API.replays}/<id>` loads one (M2). */
  replays: '/api/replays',
  /** GET `?station=<id>&suspension=<id>` (M2 stretch): crowd distribution of station entry speeds, cached. */
  insight: '/api/insight',
} as const;

/** WebSocket upgrade path: `/ws/<CODE>?id=&role=&v=&s=&pv=` (a host's or driver's key goes in its first frame, `auth`). */
export const WS_PREFIX = '/ws/';
/** Short audience link: GET /r/<CODE> -> 302 /remote.html?room=<CODE> */
export const REMOTE_PREFIX = '/r/';
export const REMOTE_PAGE = '/remote.html';
/** Public room everyone joins by default (cannot have a host; not producible by the code alphabet). */
export const PUBLIC_ROOM = 'LIVE';
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;
export const PROTOCOL_VERSION = 3;

export const NET_LIMITS = {
  wsMessageBytes: 1024,
  wsMessagesPerSecond: 5,
  wsBurst: 10,
  presenceFlushMs: 1000,
  roomIdleTtlMs: 12 * 3600 * 1000,
  pollQuestionChars: 120,
  pollOptionChars: 40,
  pollOptionsMax: 4,
  engineerQuestionChars: 280,
  engineerHistoryMax: 6,
  engineerHistoryChars: 600,
  /** Phone driver (M2): input frames per second, burst and frame size. */
  driverMessagesPerSecond: 90,
  driverBurst: 30,
  driverMessageBytes: 128,
  /** Screen -> driver telemetry frames per second. */
  telemetryPerSecond: 5,
  /** Live ghosts (M2 stretch): position frames per second per viewer. */
  ghostPerSecond: 10,
} as const;

// ---------------------------------------------------------------- HTTP

export interface HealthResponse {
  readonly ok: true;
  /** Git short sha or package version baked at build. */
  readonly version: string;
  readonly time: number;
}

/** GET /api/time (Cache-Control: no-store). */
export interface TimeResponse {
  /** Server unix ms stamped immediately before responding. */
  readonly t: number;
}

/** POST /api/rooms (rate limited). The host key is shown only on the big screen (QR fragment #k=). */
export interface CreateRoomResponse {
  readonly code: string;
  readonly hostKey: string;
  /** Phone-driver pairing key (M2; QR fragment #d=). Absent from servers older than protocol 3. */
  readonly driverKey?: string;
}

/** POST /api/event -> 204. Anonymous; written to Analytics Engine. No ids, no IP stored. */
export type AnalyticsEvent =
  | { readonly type: 'suspension-picked'; readonly vehicle: string; readonly suspension: string }
  | { readonly type: 'view-changed'; readonly view: ViewMode }
  | { readonly type: 'engineer-asked'; readonly suspension: string }
  | { readonly type: 'session'; readonly quality: string; readonly fps: number }
  /** M2: one Manual Drive session ended (seconds driven, bucketed by the client to whole seconds). */
  | { readonly type: 'drive-session'; readonly vehicle: string; readonly suspension: string; readonly seconds: number }
  /** M2: a station of the proving ground was entered while driving, at `speed` m/s (rounded to an integer). */
  | { readonly type: 'station-visit'; readonly station: string; readonly suspension: string; readonly speed: number };

export interface ErrorResponse {
  readonly error: string;
}

// ---------------------------------------------------------------- replays (M2)

export const REPLAY_API = {
  /** Compressed replay bytes accepted (before base64url). */
  maxBytes: 65536,
  ttlMs: 30 * 24 * 3600 * 1000,
  /** Saves per address per minute and per UTC day (all addresses). */
  perMinute: 5,
  perDay: 2000,
  /** Id alphabet = ROOM_CODE_ALPHABET, this many characters (about 59 bits). */
  idLength: 12,
} as const;

/** POST /api/replays. `data` = base64url of the deflate-raw-compressed encoded replay (sim-core replay/format.ts). */
export interface ReplaySaveRequest {
  /** Cloudflare Turnstile token (single use, 300 s). */
  readonly token: string;
  readonly data: string;
}

export interface ReplaySaveResponse {
  readonly id: string;
  /** Unix ms. */
  readonly expiresAt: number;
}

/** GET /api/replays/<id>. */
export interface ReplayGetResponse {
  readonly data: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

/** GET /api/insight (M2 stretch). Shares of visitors' entry speeds in 2 m/s buckets; n < 30 => buckets empty. */
export interface InsightResponse {
  readonly station: string;
  readonly suspension: string;
  readonly n: number;
  /** [bucket start, m/s; share 0..1]. */
  readonly buckets: readonly (readonly [speed: number, share: number])[];
}

// ---------------------------------------------------------------- WebSocket rooms

/**
 * viewer   = normal app (presence only; ignores presenter commands)
 * screen   = presenter's big screen (applies `ctl` state and cues)
 * host     = phone remote with the host key (may send `ctl`)
 * audience = phone on /remote.html without key (may vote)
 * driver   = phone with the driver key (M2): streams input frames to the screen(s); one at a time, newest wins
 */
export type RoomRole = 'viewer' | 'screen' | 'host' | 'audience' | 'driver';

/** Controls the host can set; the screen applies them to its store. */
export interface PresenterControls {
  readonly vehicleId?: string;
  readonly suspensionId?: string;
  readonly view?: ViewMode;
  readonly xray?: boolean;
  readonly overlay?: OverlayLevel;
  readonly timeScale?: number;
  readonly amplification?: number;
  readonly attract?: boolean;
  /** Section id to jump to (screen seeks). */
  readonly section?: string;
}

export interface PresenterState extends PresenterControls {
  /** Monotonic per room; screens ignore stale state. */
  readonly seq: number;
}

export type PresenterCue = 'replay-section' | 'focus-front-left' | 'focus-car';

export interface PollState {
  readonly id: string;
  readonly question: string;
  readonly options: readonly string[];
  readonly counts: readonly number[];
  readonly open: boolean;
}

export type ClientMessage =
  /** Host / driver only, first frame after every open; welcome follows, wrong key closes 4401. Keeps keys out of URLs/logs. */
  | { readonly t: 'auth'; readonly k: string }
  /** NTP-style probe: c0 = client performance.now() at send. */
  | { readonly t: 'sync'; readonly c0: number }
  /** Presence: what this viewer is running now. */
  | { readonly t: 'pick'; readonly vehicleId: string; readonly suspensionId: string }
  /** Host only. */
  | { readonly t: 'ctl'; readonly set: PresenterControls }
  /** Host only. */
  | { readonly t: 'cue'; readonly cue: PresenterCue }
  /** Host only: open a poll (null closes the open poll, or clears a closed one). */
  | { readonly t: 'poll'; readonly poll: { readonly question: string; readonly options: readonly string[] } | null }
  /** Audience/viewer: one vote per client id per poll (re-vote replaces). */
  | { readonly t: 'vote'; readonly pollId: string; readonly choice: number }
  /**
   * Driver only (M2), ~30 Hz + on pedal edges: n = sequence (u32, wraps), s = steer -1000..1000 (+ LEFT, after the
   * phone's dead zone and curve), th / br = throttle / brake 0..1000, f = flags (1 drive wanted, 2 handbrake, 4 touch).
   */
  | { readonly t: 'in'; readonly n: number; readonly s: number; readonly th: number; readonly br: number; readonly f: number }
  /** Screen only (M2), <= telemetryPerSecond: speed km/h (integer), gear, drive mode index (DriveMode order
   * auto, manual, returning, replay), k = haptic pulse bits (1 kerb/bump stop, 2 grip limit). Relayed to the driver. */
  | { readonly t: 'tel'; readonly v: number; readonly g: number; readonly m: number; readonly k: number }
  /** Viewer (M2 stretch, live ghosts), <= ghostPerSecond: world x, y (dm, integers), yaw (mrad), speed (cm/s). */
  | { readonly t: 'gst'; readonly x: number; readonly y: number; readonly h: number; readonly v: number };
// Heartbeat: the literal text frame "ping" (answered "pong" by the runtime without waking the DO).

export interface PresenceSnapshot {
  readonly viewers: number;
  /** Authenticated hosts (phone remotes) connected; never counted in `viewers`. */
  readonly hosts: number;
  /** Authenticated phone drivers connected (M2; 0 or 1); never counted in `viewers`. */
  readonly drivers?: number;
  readonly dist: Readonly<Record<string, number>>;
}

export type ServerMessage =
  | {
      readonly t: 'welcome';
      readonly id: string;
      readonly role: RoomRole;
      readonly serverNow: number;
      readonly presence: PresenceSnapshot;
      readonly ctl: PresenterState;
      readonly poll: PollState | null;
    }
  | { readonly t: 'sync'; readonly c0: number; readonly s1: number }
  /** Coalesced to <= 1 Hz. */
  | ({ readonly t: 'presence' } & PresenceSnapshot)
  | { readonly t: 'ctl'; readonly state: PresenterState }
  | { readonly t: 'cue'; readonly seq: number; readonly cue: PresenterCue }
  /** Coalesced to <= 2 Hz. */
  | { readonly t: 'poll'; readonly poll: PollState | null }
  | { readonly t: 'err'; readonly code: 'rate' | 'too-big' | 'bad-message' | 'forbidden' }
  /** To screens only (M2): a driver input frame plus r = the room's receive time (Date.now()) for link-age estimates. */
  | { readonly t: 'in'; readonly n: number; readonly s: number; readonly th: number; readonly br: number; readonly f: number; readonly r: number }
  /** To the driver only (M2): the screen's latest telemetry. */
  | { readonly t: 'tel'; readonly v: number; readonly g: number; readonly m: number; readonly k: number }
  /** M2 stretch: other viewers' cars, aggregated <= 10 Hz: [slot, x dm, y dm, yaw mrad, speed cm/s]. */
  | { readonly t: 'gsts'; readonly c: readonly (readonly [slot: number, x: number, y: number, h: number, v: number])[] };
