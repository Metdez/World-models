/** 11-03 replay feature: `#r=` links (deflate-raw + base64url, fallback encoder), errors, share limits, copy. */
import { describe, expect, it } from 'vitest';
import { REPLAY_LIMITS, type DecodedReplay } from '../../src/contracts/drive';
import { COPY, LINK_ERROR, REFUSAL, shareSeconds, statusNote } from '../../src/features/replay/copy';
import { decodeFragment, detectPlatform, encodeFragment, fragmentOf, fromBase64Fallback, shareUrl, toBase64Fallback, type Platform } from '../../src/features/replay/link';
import type { ReplayStatus } from '../../src/sim-core/drive/control';
import { encodeReplay } from '../../src/sim-core/replay/format';
import { manualSim, scriptedDriver } from '../fixtures/11-03-replay';

const run = (() => {
  const sim = manualSim(10);
  scriptedDriver(4, false)(sim, 8);
  return sim.drive!.recording()!;
})();
const same = (a: DecodedReplay, b: DecodedReplay) => expect(encodeReplay(a)).toEqual(encodeReplay(b));

const fallback: Platform = { compress: null, decompress: null, toBase64: toBase64Fallback, fromBase64: fromBase64Fallback };

describe('links', () => {
  it('round trip with CompressionStream (deflate-raw) and with the fallback encoder (no compression, btoa)', async () => {
    const native = detectPlatform();
    expect(native.compress).not.toBeNull();
    const z = await encodeFragment(run, native);
    expect(z).toMatch(/^[A-Za-z0-9_-]+$/);
    const back = await decodeFragment(z, native);
    same((back as { replay: DecodedReplay }).replay, run);
    const raw = await encodeFragment(run, fallback);
    expect(raw.length).toBeGreaterThan(z.length * 3);
    same(((await decodeFragment(raw, fallback)) as { replay: DecodedReplay }).replay, run);
    // a browser without streams still opens an uncompressed link; a compressed one says it cannot
    same(((await decodeFragment(raw, native)) as { replay: DecodedReplay }).replay, run);
    expect(await decodeFragment(z, fallback)).toEqual({ error: 'unsupported' });
  });

  it('the fallback base64url codec equals the standard one on every byte value', () => {
    const bytes = new Uint8Array(1000).map((_, i) => (i * 37 + 11) & 255);
    const s = toBase64Fallback(bytes);
    expect(s).toBe(Buffer.from(bytes).toString('base64url'));
    expect(Array.from(fromBase64Fallback(s))).toEqual(Array.from(bytes));
    for (let n = 0; n < 5; n++) expect(Array.from(fromBase64Fallback(toBase64Fallback(bytes.subarray(0, n))))).toEqual(Array.from(bytes.subarray(0, n)));
  });

  it('damaged, truncated, foreign or future links are error values, never exceptions', async () => {
    const z = await encodeFragment(run);
    expect(await decodeFragment(z.slice(0, z.length - 6))).toEqual({ error: 'damaged' });
    expect(await decodeFragment(`${z.slice(0, 40)}A${z.slice(41)}`)).toHaveProperty('error');
    expect(await decodeFragment('not a replay!')).toEqual({ error: 'damaged' });
    expect(await decodeFragment('')).toEqual({ error: 'damaged' });
    expect(await decodeFragment(toBase64Fallback(new Uint8Array([7, 1, 2, 3])))).toEqual({ error: 'newer-format' });
    const raw = encodeReplay(run);
    const newer = raw.slice();
    newer[3] = 0x32;
    expect(await decodeFragment(toBase64Fallback(new Uint8Array([0, ...newer])))).toEqual({ error: 'newer-format' });
    for (const e of ['damaged', 'newer-format', 'unsupported'] as const) expect(LINK_ERROR[e].length).toBeGreaterThan(10);
  });

  it('the run lives in the fragment, never the query string', () => {
    const url = shareUrl({ origin: 'https://lab.example', pathname: '/' }, 'abc_-');
    expect(url).toBe('https://lab.example/#r=abc_-');
    expect(new URL(url).search).toBe('');
    expect(fragmentOf('#r=abc')).toBe('abc');
    expect(fragmentOf('#r=')).toBeNull();
    expect(fragmentOf('#rid=xyz')).toBeNull();
  });
});

describe('share limits and honesty lines', () => {
  it('runs up to the fragment limit share whole; longer runs share their last minute (<= limit)', () => {
    expect(shareSeconds(240 * 30)).toEqual({ seconds: 30, truncated: false });
    expect(shareSeconds(240 * REPLAY_LIMITS.fragmentSeconds)).toEqual({ seconds: REPLAY_LIMITS.fragmentSeconds, truncated: false });
    const long = shareSeconds(240 * 125);
    expect(long.truncated).toBe(true);
    // the recorder rounds a window's start down to a whole second: + 1 s at most
    expect(long.seconds + 1).toBeLessThanOrEqual(REPLAY_LIMITS.fragmentSeconds);
  });

  it('labels another model version, other parameters and drift; silent when exact', () => {
    const s = { sameModel: true, sameVersion: true, mismatches: 0, resyncs: 0 } as ReplayStatus;
    expect(statusNote(s)).toBeNull();
    expect(statusNote({ ...s, sameVersion: false })).toMatch(/older model/);
    expect(statusNote({ ...s, sameModel: false })).toMatch(/may differ/);
    expect(statusNote({ ...s, mismatches: 1 })).toMatch(/may differ/);
    expect(statusNote({ ...s, mismatches: 1, resyncs: 1 })).toMatch(/approximate from here/);
  });

  it('copy carries no digits', () => {
    const all = [...Object.values(COPY), ...Object.values(LINK_ERROR), ...Object.values(REFUSAL)];
    for (const text of all) expect(text, text).not.toMatch(/\d/);
  });
});
