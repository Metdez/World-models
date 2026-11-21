/** Deterministic kernels vs the engine's Math.* (ARCHITECTURE-M2 §7.12, D1): <= 1 ulp on 10^5-point grids + edge cases. */
import { describe, expect, it } from 'vitest';
import { dacos, dasin, datan, datan2, dcos, dexp, dhypot, dlog, dpow, dsin, dsincos, dtan, dtanh, dwrapPi, SINCOS } from '../../src/sim-core/math/det';
import { provingLoop } from '../../src/sim-core/content/proving-loop';
import { buildTrack, planPoseOf } from '../../src/sim-core/track/build';
import { createRng } from '../../src/sim-core/math/rng';

const f64 = new Float64Array(1);
const i64 = new BigInt64Array(f64.buffer);
/** Monotone integer ordering of doubles (ulp distance = difference). */
function ord(x: number): bigint {
  f64[0] = x;
  const v = i64[0]!;
  return v < 0n ? -(v & 0x7fffffffffffffffn) : v;
}
function ulps(a: number, b: number): number {
  if (Number.isNaN(a) && Number.isNaN(b)) return 0;
  if (Number.isNaN(a) || Number.isNaN(b)) return Infinity;
  if (a === b) return Object.is(a, b) || a !== 0 ? 0 : 1;
  const d = ord(a) - ord(b);
  return Number(d < 0n ? -d : d);
}

const N = 100_000;
const EDGES = [0, -0, 1e-300, -1e-300, 5e-324, 1e-9, -1e-9, 0.5, -0.5, 1, -1, Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI, -Math.PI, 2 * Math.PI, 100, -100, 2 ** 20, -(2 ** 20), NaN, Infinity, -Infinity];
const rng = createRng(7);
/** Log-uniform magnitude in [10^lo, 10^hi], random sign. */
const logGrid = (lo: number, hi: number): number[] =>
  Array.from({ length: N }, () => (rng.next() < 0.5 ? -1 : 1) * 10 ** rng.uniform(lo, hi));
const uniform = (lo: number, hi: number): number[] => Array.from({ length: N }, () => rng.uniform(lo, hi));

function worst(fn: (x: number) => number, ref: (x: number) => number, xs: readonly number[]): { ulp: number; at: number } {
  let w = { ulp: 0, at: 0 };
  for (const x of xs) {
    const u = ulps(fn(x), ref(x));
    if (u > w.ulp) w = { ulp: u, at: x };
  }
  return w;
}

const TRIG_MAX = 2 ** 20; // the medium reduction covers |x| < 2^20 * pi/2
const cases: [string, (x: number) => number, (x: number) => number, number[]][] = [
  ['dsin', dsin, Math.sin, [...logGrid(-12, Math.log10(TRIG_MAX)), ...uniform(-10, 10), ...EDGES.filter((x) => !(Math.abs(x) >= TRIG_MAX * 2))]],
  ['dcos', dcos, Math.cos, [...logGrid(-12, Math.log10(TRIG_MAX)), ...uniform(-10, 10), ...EDGES.filter((x) => !(Math.abs(x) >= TRIG_MAX * 2))]],
  ['dtan', dtan, Math.tan, [...logGrid(-12, Math.log10(TRIG_MAX)), ...uniform(-1.6, 1.6), ...EDGES.filter((x) => !(Math.abs(x) >= TRIG_MAX * 2))]],
  ['datan', datan, Math.atan, [...logGrid(-12, 20), ...uniform(-3, 3), ...EDGES]],
  ['dasin', dasin, Math.asin, [...uniform(-1, 1), ...logGrid(-12, 0), -1, 1, 1.0000001, ...EDGES]],
  ['dacos', dacos, Math.acos, [...uniform(-1, 1), ...logGrid(-12, 0), -1, 1, -1.0000001, ...EDGES]],
  ['dexp', dexp, Math.exp, [...uniform(-745, 709), ...uniform(-2, 2), ...EDGES, 709.78, -745.2]],
  ['dlog', dlog, Math.log, [...logGrid(-300, 300).map(Math.abs), ...uniform(0.5, 2), ...EDGES]],
  ['dtanh', dtanh, Math.tanh, [...logGrid(-12, 2), ...uniform(-3, 3), ...EDGES]],
];

describe('det kernels', () => {
  it.each(cases)('%s is within 1 ulp of Math.* (10^5 grid + edge cases incl. +-0, NaN, +-Inf)', (_name, fn, ref, xs) => {
    expect(worst(fn, ref, xs).ulp).toBeLessThanOrEqual(1);
  });

  it('dsin/dcos/dtan keep the sign of zero and give NaN for +-Inf / NaN', () => {
    expect(Object.is(dsin(-0), -0)).toBe(true);
    expect(Object.is(dtan(-0), -0)).toBe(true);
    expect(dcos(-0)).toBe(1);
    for (const f of [dsin, dcos, dtan]) for (const x of [NaN, Infinity, -Infinity]) expect(f(x)).toBeNaN();
  });

  it('dsin throws beyond the medium reduction (never passed by the plant)', () => {
    expect(() => dsin(2 ** 21 * Math.PI)).toThrow();
  });

  it('datan2 is within 1 ulp of Math.atan2 incl. quadrants, zeros and infinities', () => {
    const ys = uniform(-200, 200);
    const xs = uniform(-200, 200);
    let w = 0;
    for (let i = 0; i < N; i++) w = Math.max(w, ulps(datan2(ys[i]!, xs[i]!), Math.atan2(ys[i]!, xs[i]!)));
    const special = [0, -0, 1, -1, 1e-300, Infinity, -Infinity, NaN];
    for (const y of special) for (const x of special) w = Math.max(w, ulps(datan2(y, x), Math.atan2(y, x)));
    expect(w).toBeLessThanOrEqual(1);
  });

  it('dpow: exact repeated squaring for small integer exponents, dexp(y dlog x) otherwise (few ulp)', () => {
    let w = 0;
    for (let i = 0; i < N; i++) {
      const x = rng.uniform(0.1, 4);
      const y = rng.uniform(-1.5, 1.5);
      w = Math.max(w, ulps(dpow(x, y), Math.pow(x, y)));
    }
    expect(w).toBeLessThanOrEqual(4); // |y ln x| <= 2.1 on this grid: the product's rounding is amplified
    expect(dpow(3, 2)).toBe(9);
    expect(dpow(2, -3)).toBe(0.125);
    expect(dpow(1.1, 16)).toBeCloseTo(1.1 ** 16, 14);
  });

  it('dhypot and dwrapPi', () => {
    expect(dhypot(3, 4)).toBe(5);
    for (const a of [0, Math.PI, -Math.PI, 3 * Math.PI, -3 * Math.PI, 7, -7, 1e5]) {
      const r = dwrapPi(a);
      expect(r).toBeGreaterThan(-Math.PI);
      expect(r).toBeLessThanOrEqual(Math.PI);
      expect(Math.abs(Math.sin(r) - Math.sin(a))).toBeLessThan(1e-9);
    }
    expect(dwrapPi(-Math.PI)).toBe(Math.PI);
  });
});

describe('allocation-free variants are the same bits (13-01)', () => {
  it('dsincos(x) = [dsin(x), dcos(x)] bit for bit, incl. zeros, tiny, reduced and non-finite arguments', () => {
    const rng = createRng(1301);
    const xs = [0, -0, 1e-300, -1e-12, 0.785398163, 0.7853981634, 2.356, 1e5, -1e6, Infinity, -Infinity, NaN];
    for (let i = 0; i < 200_000; i++) xs.push((rng.next() - 0.5) * (i % 4 === 0 ? 20 : i % 4 === 1 ? 2000 : i % 4 === 2 ? 2e6 : 2));
    let bad = 0;
    for (const x of xs) {
      dsincos(x);
      if (!Object.is(SINCOS[0], dsin(x)) || !Object.is(SINCOS[1], dcos(x))) bad++;
    }
    expect(bad).toBe(0);
  });
  it('planPoseOf(track) = track.sample x, y, heading, curvature bit for bit', () => {
    const track = buildTrack(provingLoop);
    const plan = planPoseOf(track)!;
    const a = { s: 0, x: 0, y: 0, z: 0, heading: 0, curvature: 0, bank: 0, grade: 0 };
    const b = { ...a };
    let bad = 0;
    for (let i = 0; i < 20_000; i++) {
      const s = (i * 0.1371) % (track.length * 1.3) - 50;
      track.sample(s, a);
      plan(s, b);
      if (!Object.is(a.x, b.x) || !Object.is(a.y, b.y) || !Object.is(a.heading, b.heading) || !Object.is(a.curvature, b.curvature)) bad++;
    }
    expect(bad).toBe(0);
  });
});

