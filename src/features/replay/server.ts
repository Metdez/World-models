/**
 * Saved replays (ARCHITECTURE-M2 §12.1, plan 12-05): `POST /api/replays` stores the deflate-raw-compressed encoded
 * replay (input log + start state; nothing about the visitor) for REPLAY_API.ttlMs; `#rid=<id>` links fetch it with
 * `GET /api/replays/<id>`. Every failure is a typed value, never an exception. fetch and the platform are injectable.
 */
import { REPLAY_LIMITS, type DecodedReplay } from '../../contracts/drive';
import { API, REPLAY_API, ROOM_CODE_ALPHABET, type ReplayGetResponse, type ReplaySaveRequest, type ReplaySaveResponse } from '../../contracts/net';
import { SIM_HZ } from '../../contracts/units';
import { decodeReplayResult, encodeReplay } from '../../sim-core/replay/format';
import { detectPlatform, type LinkError, type Platform } from './link';

export const SAVED_KEY = '#rid=';
const ID = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${REPLAY_API.idLength}}$`);
export const isReplayId = (s: string): boolean => ID.test(s);

/** The id after `#rid=` (as written; check it with isReplayId), or null when the hash is not a saved-run link. */
export function ridOf(hash: string): string | null {
  return hash.startsWith(SAVED_KEY) ? decodeURIComponent(hash.slice(SAVED_KEY.length)).trim().toUpperCase() : null;
}
export function savedUrl(loc: { readonly origin: string; readonly pathname: string }, id: string): string {
  return `${loc.origin}${loc.pathname}${SAVED_KEY}${id}`;
}

/** base64url(deflate-raw(encodeReplay(r))), the request's `data`; null without a compressor. */
export async function saveData(r: DecodedReplay, p: Platform = detectPlatform()): Promise<string | null> {
  if (!p.compress) return null;
  return p.toBase64(await p.compress(encodeReplay(r)));
}

/** Spans tried when a run does not fit: whole minutes, longest first (a span starts on a whole second, so ask one less). */
export const SAVE_MINUTES = [10, 5, 2, 1] as const;

export interface SaveSpan {
  readonly replay: DecodedReplay;
  readonly data: string;
  /** Whole minutes when only the newest part is saved, else null (the whole run). */
  readonly minutes: number | null;
}

/**
 * The run to save: the whole recording when it is within the server's limits (≤ REPLAY_LIMITS.maxSeconds, compressed
 * ≤ REPLAY_API.maxBytes), else the newest SAVE_MINUTES span that fits. null: nothing fits or no compressor.
 */
export async function saveSpan(
  source: { recording(): DecodedReplay | null; last(seconds: number): DecodedReplay | null },
  p: Platform = detectPlatform(),
): Promise<SaveSpan | null> {
  const fits = (data: string) => Math.floor((data.length * 3) / 4) <= REPLAY_API.maxBytes;
  const whole = source.recording();
  if (!whole) return null;
  const seconds = whole.header.ticks / SIM_HZ;
  if (seconds <= REPLAY_LIMITS.maxSeconds - 1) {
    const data = await saveData(whole, p);
    if (data === null) return null;
    if (fits(data)) return { replay: whole, data, minutes: null };
  }
  for (const m of SAVE_MINUTES) {
    if (m * 60 - 1 >= seconds) continue; // not shorter than what we have
    const r = source.last(m * 60 - 1);
    if (!r) return null;
    const data = await saveData(r, p);
    if (data === null) return null;
    if (fits(data)) return { replay: r, data, minutes: m };
  }
  return null;
}

export type SaveError = 'offline' | 'challenge' | 'busy' | 'daily_cap' | 'storage' | 'disabled' | 'too_large' | 'failed';
export type SaveResult = { readonly id: string; readonly expiresAt: number } | { readonly error: SaveError };

/** A labelled server answer → what to tell the visitor (12-01 status codes). */
export function saveErrorOf(status: number, error: string | undefined): SaveError {
  if (status === 403) return 'challenge';
  if (status === 429) return 'busy';
  if (status === 413) return 'too_large';
  if (status === 400) return error === 'bad_replay' ? 'too_large' : 'failed';
  if (status === 503) return error === 'not_configured' ? 'disabled' : error === 'daily_cap' ? 'daily_cap' : 'storage';
  return 'failed';
}

async function errorField(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : undefined;
  } catch {
    return undefined;
  }
}

const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

export async function saveReplay(token: string, data: string, f: typeof fetch = fetch): Promise<SaveResult> {
  if (offline()) return { error: 'offline' };
  const body: ReplaySaveRequest = { token, data };
  let res: Response;
  try {
    res = await f(API.replays, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    return { error: 'offline' };
  }
  if (res.status !== 201) return { error: saveErrorOf(res.status, await errorField(res)) };
  try {
    const ok = (await res.json()) as ReplaySaveResponse;
    return isReplayId(ok.id) ? { id: ok.id, expiresAt: ok.expiresAt } : { error: 'failed' };
  } catch {
    return { error: 'failed' };
  }
}

export type LoadError = LinkError | 'invalid' | 'missing' | 'offline' | 'failed';
export type LoadResult = { readonly replay: DecodedReplay } | { readonly error: LoadError };

/** Fetches and decodes a saved run; never throws. */
export async function loadSaved(id: string, f: typeof fetch = fetch, p: Platform = detectPlatform()): Promise<LoadResult> {
  if (!isReplayId(id)) return { error: 'invalid' };
  let res: Response;
  try {
    res = await f(`${API.replays}/${id}`, { headers: { accept: 'application/json' } });
  } catch {
    return { error: 'offline' };
  }
  if (res.status === 404) return { error: 'missing' };
  if (!res.ok) return { error: 'failed' };
  let bytes: Uint8Array;
  try {
    const body = (await res.json()) as ReplayGetResponse;
    bytes = p.fromBase64(body.data);
  } catch {
    return { error: 'damaged' };
  }
  if (!p.decompress) return { error: 'unsupported' };
  try {
    return decodeReplayResult(await p.decompress(bytes));
  } catch {
    return { error: 'damaged' };
  }
}
