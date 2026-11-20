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
} as const;

/** WebSocket upgrade path: `/ws/<CODE>?id=&role=&k=&v=&s=&pv=` */
export const WS_PREFIX = '/ws/';
/** Short audience link: GET /r/<CODE> -> 302 /remote.html?room=<CODE> */
export const REMOTE_PREFIX = '/r/';
export const REMOTE_PAGE = '/remote.html';
/** Public room everyone joins by default (cannot have a host; not producible by the code alphabet). */
export const PUBLIC_ROOM = 'LIVE';
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;
export const PROTOCOL_VERSION = 1;

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
}

/** POST /api/event -> 204. Anonymous; written to Analytics Engine. No ids, no IP stored. */
export type AnalyticsEvent =
  | { readonly type: 'suspension-picked'; readonly vehicle: string; readonly suspension: string }
  | { readonly type: 'view-changed'; readonly view: ViewMode }
  | { readonly type: 'engineer-asked'; readonly suspension: string }
  | { readonly type: 'session'; readonly quality: string; readonly fps: number };

export interface ErrorResponse {
  readonly error: string;
}

// ---------------------------------------------------------------- WebSocket rooms

/**
 * viewer   = normal app (presence only; ignores presenter commands)
 * screen   = presenter's big screen (applies `ctl` state and cues)
 * host     = phone remote with the host key (may send `ctl`)
 * audience = phone on /remote.html without key (may vote)
 */
export type RoomRole = 'viewer' | 'screen' | 'host' | 'audience';

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
  /** NTP-style probe: c0 = client performance.now() at send. */
  | { readonly t: 'sync'; readonly c0: number }
  /** Presence: what this viewer is running now. */
  | { readonly t: 'pick'; readonly vehicleId: string; readonly suspensionId: string }
  /** Host only. */
  | { readonly t: 'ctl'; readonly set: PresenterControls }
  /** Host only. */
  | { readonly t: 'cue'; readonly cue: PresenterCue }
  /** Host only: open a poll (null closes the current one). */
  | { readonly t: 'poll'; readonly poll: { readonly question: string; readonly options: readonly string[] } | null }
  /** Audience/viewer: one vote per client id per poll (re-vote replaces). */
  | { readonly t: 'vote'; readonly pollId: string; readonly choice: number };
// Heartbeat: the literal text frame "ping" (answered "pong" by the runtime without waking the DO).

export interface PresenceSnapshot {
  readonly viewers: number;
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
  | { readonly t: 'err'; readonly code: 'rate' | 'too-big' | 'bad-message' | 'forbidden' };
