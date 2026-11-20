/**
 * Deterministic pseudo-random numbers (identical on every device for the same seed).
 * mulberry32 by Tommy Ettinger (public domain); hash32 is a lowbias32-style integer mix (C. Wellons, public domain).
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [a, b). */
  uniform(a: number, b: number): number;
  /** Integer in [0, n). */
  int(n: number): number;
  /** Standard normal (Box-Muller). */
  normal(): number;
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  let spare = Number.NaN;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    uniform: (a, b) => a + (b - a) * next(),
    int: (n) => Math.floor(next() * n),
    normal() {
      if (!Number.isNaN(spare)) {
        const v = spare;
        spare = Number.NaN;
        return v;
      }
      const u = 1 - next(); // (0, 1]: log is finite
      const r = Math.sqrt(-2 * Math.log(u));
      const phi = 2 * Math.PI * next();
      spare = r * Math.sin(phi);
      return r * Math.cos(phi);
    },
  };
}

/** Stateless 32-bit integer hash. */
export function hash32(x: number): number {
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d);
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

/** Stateless uniform [0, 1) for integer coordinates (e.g. pave stone (i, j)): order-independent lookups. */
export const hashFloat = (seed: number, i: number, j = 0): number => hash32(hash32(hash32(seed) ^ i) ^ j) / 4294967296;
