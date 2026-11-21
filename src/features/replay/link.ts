/**
 * Share links (ARCHITECTURE-M2 §7.13, research m2/24 §c, m2/15 §1): `#r=` + base64url(codec byte + payload), codec 1 =
 * deflate-raw (CompressionStream), 0 = the encoded replay uncompressed (fallback when the platform has no
 * CompressionStream). Fragment only: it never reaches the server. Uint8Array.toBase64/fromBase64 when present, else a
 * btoa/atob fallback. Pure apart from the platform APIs it detects (injectable for tests).
 */
import { REPLAY_LIMITS, type DecodedReplay } from '../../contracts/drive';
import { decodeReplayResult, encodeReplay, type ReplayDecodeError } from '../../sim-core/replay/format';

export const FRAGMENT_KEY = '#r=';
/** Fragment budget (chars after `#r=`): research m2/24 §c, "<= ~8 000 mostly survives" messengers and browsers. */
export const MAX_FRAGMENT_CHARS = 8000;

const CODEC_RAW = 0;
const CODEC_DEFLATE = 1;

export interface Platform {
  readonly compress: ((bytes: Uint8Array) => Promise<Uint8Array>) | null;
  readonly decompress: ((bytes: Uint8Array) => Promise<Uint8Array>) | null;
  readonly toBase64: (bytes: Uint8Array) => string;
  readonly fromBase64: (text: string) => Uint8Array;
}

async function pipe(bytes: Uint8Array, stream: GenericTransformStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** base64url without padding, btoa-based (the fallback encoder). */
export function toBase64Fallback(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromBase64Fallback(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('not base64url');
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

type B64Ctor = { fromBase64?: (s: string, o: object) => Uint8Array };
type B64Proto = { toBase64?: (o: object) => string };

export function detectPlatform(g: typeof globalThis = globalThis): Platform {
  const hasStreams = typeof g.CompressionStream === 'function' && typeof g.DecompressionStream === 'function';
  const native = typeof (Uint8Array as unknown as B64Ctor).fromBase64 === 'function' && typeof (Uint8Array.prototype as unknown as B64Proto).toBase64 === 'function';
  return {
    compress: hasStreams ? (b) => pipe(b, new g.CompressionStream('deflate-raw')) : null,
    decompress: hasStreams ? (b) => pipe(b, new g.DecompressionStream('deflate-raw')) : null,
    toBase64: native ? (b) => (b as unknown as Required<B64Proto>).toBase64({ alphabet: 'base64url', omitPadding: true }) : toBase64Fallback,
    fromBase64: native ? (t) => (Uint8Array as unknown as Required<B64Ctor>).fromBase64(t, { alphabet: 'base64url', lastChunkHandling: 'loose' }) : fromBase64Fallback,
  };
}

/** Text after `#r=`. */
export async function encodeFragment(replay: DecodedReplay, p: Platform = detectPlatform()): Promise<string> {
  const raw = encodeReplay(replay);
  const body = p.compress ? await p.compress(raw) : raw;
  const out = new Uint8Array(body.length + 1);
  out[0] = p.compress ? CODEC_DEFLATE : CODEC_RAW;
  out.set(body, 1);
  return p.toBase64(out);
}

export type LinkError = ReplayDecodeError | 'unsupported';
export type FragmentResult = { readonly replay: DecodedReplay } | { readonly error: LinkError };

/** Never throws: a damaged, truncated or future link is an error value. */
export async function decodeFragment(text: string, p: Platform = detectPlatform()): Promise<FragmentResult> {
  let bytes: Uint8Array;
  try {
    bytes = p.fromBase64(text.trim());
  } catch {
    return { error: 'damaged' };
  }
  if (bytes.length < 2 || bytes.length > REPLAY_LIMITS.maxBytes + 1) return { error: 'damaged' };
  const codec = bytes[0]!;
  let raw: Uint8Array;
  if (codec === CODEC_RAW) raw = bytes.subarray(1);
  else if (codec === CODEC_DEFLATE) {
    if (!p.decompress) return { error: 'unsupported' };
    try {
      raw = await p.decompress(bytes.subarray(1));
    } catch {
      return { error: 'damaged' };
    }
  } else return { error: 'newer-format' };
  return decodeReplayResult(raw);
}

/** The fragment of a location hash (`#r=...`), or null. */
export function fragmentOf(hash: string): string | null {
  return hash.startsWith(FRAGMENT_KEY) && hash.length > FRAGMENT_KEY.length ? hash.slice(FRAGMENT_KEY.length) : null;
}

/** A link to this page that carries the replay in the fragment (never the query string). */
export function shareUrl(loc: { readonly origin: string; readonly pathname: string }, fragment: string): string {
  return `${loc.origin}${loc.pathname}${FRAGMENT_KEY}${fragment}`;
}
