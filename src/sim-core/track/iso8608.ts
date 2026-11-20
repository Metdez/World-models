/**
 * ISO 8608 random road roughness (research 11 §A.6): displacement PSD Gd(n) = Gd(n0) (n/n0)^-w, w = 2,
 * n0 = 0.1 cycles/m, realised as a seeded sum of cosines baked into a 2 cm lookup table.
 * Every frequency is an integer number of cycles per lap, so the profile is exactly periodic over the closed loop.
 * Lateral variation: three rails cycling every RAIL_SPACING across the road, linearly interpolated; rail phases
 * are partially shared so long waves are coherent across the car and short waves are not (coherence heuristic [H]).
 */
import type { RoughnessClass } from '../../contracts/track';
import { createRng } from '../math/rng';

/** Gd(n0) geometric-mean class values, m^3 (ISO 8608). */
export const ISO_GD0: Readonly<Record<RoughnessClass, number>> = { A: 16e-6, B: 64e-6, C: 256e-6, D: 1024e-6 };
/** The LUT is generated at this Gd(n0); a class scales it by sqrt(ISO_GD0[class] / UNIT_GD0). */
export const UNIT_GD0 = 1e-6;
const N0 = 0.1;
export const N_MIN = 0.05;
export const N_MAX = 10;
const BINS = 200;
export const LUT_SPACING = 0.02;
const RAIL_SPACING = 0.8;
/** Distance at which the rail coherence exp(-pi n b) is evaluated (about one wheel track). */
const COHERENCE_DISTANCE = 1.6;

export interface Roughness {
  /** Nominal RMS of the unit profile (sqrt of the summed component variances), m. */
  readonly unitRms: number;
  /** Unit-class roughness height at (s, l); s in [0, length). Allocation-free. */
  at(s: number, l: number): number;
}

export const classScale = (c: RoughnessClass): number => Math.sqrt(ISO_GD0[c] / UNIT_GD0);

export function createRoughness(length: number, seed: number): Roughness {
  const n = Math.max(1, Math.round(length / LUT_SPACING));
  const ds = length / n;
  const cosT = new Float64Array(n);
  const sinT = new Float64Array(n);
  for (let m = 0; m < n; m++) {
    cosT[m] = Math.cos((2 * Math.PI * m) / n);
    sinT[m] = Math.sin((2 * Math.PI * m) / n);
  }
  const rails = [new Float64Array(n + 1), new Float64Array(n + 1), new Float64Array(n + 1)] as const;
  const rng = createRng(seed);
  let variance = 0;
  let prevK = 0;
  const ratio = N_MAX / N_MIN;
  for (let b = 0; b < BINS; b++) {
    const e0 = N_MIN * ratio ** (b / BINS);
    const e1 = N_MIN * ratio ** ((b + 1) / BINS);
    const k = Math.max(prevK + 1, Math.round(Math.sqrt(e0 * e1) * length));
    if (k >= n / 2) break; // never alias above the LUT Nyquist frequency
    prevK = k;
    const nk = k / length;
    const amp = Math.sqrt(2 * UNIT_GD0 * (nk / N0) ** -2 * (e1 - e0));
    variance += 0.5 * amp * amp;
    const common = rng.uniform(0, 2 * Math.PI);
    const spread = Math.PI * (1 - Math.exp(-Math.PI * nk * COHERENCE_DISTANCE));
    for (const rail of rails) {
      const phase = common + spread * rng.uniform(-1, 1);
      const re = amp * Math.cos(phase);
      const im = amp * Math.sin(phase);
      for (let m = 0; m < n; m++) {
        const idx = (k * m) % n; // exact phase index: periodic to the last bit
        rail[m] = rail[m]! + re * cosT[idx]! - im * sinT[idx]!;
      }
    }
  }
  for (const rail of rails) rail[n] = rail[0]!;
  const unitRms = Math.sqrt(variance);

  return {
    unitRms,
    at(s, l) {
      const xs = s / ds;
      let i = Math.floor(xs);
      if (i >= n) i = n - 1;
      const t = xs - i;
      const r = l / RAIL_SPACING;
      const j = Math.floor(r);
      const u = r - j;
      const a = rails[((j % 3) + 3) % 3]!;
      const c = rails[(((j + 1) % 3) + 3) % 3]!;
      const va = a[i]! + (a[i + 1]! - a[i]!) * t;
      const vc = c[i]! + (c[i + 1]! - c[i]!) * t;
      return va + (vc - va) * u;
    },
  };
}
