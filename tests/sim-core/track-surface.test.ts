/** roadHeight(s, l): determinism, continuity, feature shapes and bands, banking, crest, ISO 8608 roughness. */
import { describe, expect, it } from 'vitest';
import type { TrackDefinition, TrackSample } from '../../src/contracts/track';
import { DEG_TO_RAD, G } from '../../src/contracts/units';
import { provingLoop } from '../../src/sim-core/content/proving-loop';
import { buildTrack } from '../../src/sim-core/track/build';
import { classScale, createRoughness, N_MAX, N_MIN, UNIT_GD0 } from '../../src/sim-core/track/iso8608';

const track = buildTrack(provingLoop);
// Same plan, seed and roughness, no closed-form bumps: the difference isolates each feature exactly.
const smoothDef: TrackDefinition = {
  ...provingLoop,
  segments: provingLoop.segments.map((s) => ({ ...s, features: (s.features ?? []).filter((f) => f.kind === 'vertical-curve') })),
};
const smooth = buildTrack(smoothDef);
const feature = (s: number, l: number): number => track.roadHeight(s, l) - smooth.roadHeight(s, l);
const sec = (id: string) => track.sections.find((x) => x.id === id)!;
const newSample = (): TrackSample => ({ s: 0, x: 0, y: 0, z: 0, heading: 0, curvature: 0, bank: 0, grade: 0 });

function maxAbs(f: (s: number) => number, s0: number, s1: number, ds = 0.005): number {
  let m = 0;
  for (let s = s0; s <= s1; s += ds) m = Math.max(m, Math.abs(f(s)));
  return m;
}

describe('roadHeight', () => {
  it('is finite everywhere across asphalt, kerbs and runoff', () => {
    const half = provingLoop.width / 2 + provingLoop.kerbWidth + provingLoop.runoff;
    for (let s = 0; s < track.length; s += 0.37)
      for (let l = -half; l <= half; l += 0.9) expect(Number.isFinite(track.roadHeight(s, l))).toBe(true);
  });

  it('is deterministic (same definition -> identical heights) and periodic in s', () => {
    const again = buildTrack(provingLoop);
    for (let i = 0; i < 500; i++) {
      const s = (i * 3.3170001) % track.length;
      const l = ((i * 0.731) % 12) - 6;
      expect(again.roadHeight(s, l)).toBe(track.roadHeight(s, l));
      expect(track.roadHeight(s + track.length, l)).toBeCloseTo(track.roadHeight(s, l), 12);
    }
    for (const l of [-5, -0.8, 0, 0.8, 5]) expect(Math.abs(track.roadHeight(track.length - 1e-7, l) - track.roadHeight(0, l))).toBeLessThan(1e-6);
  });

  it('has no steps at section boundaries (bank ramps, roughness class blend)', () => {
    for (const b of track.sections)
      for (const l of [-5.5, -0.8, 0, 0.8, 5.5]) expect(Math.abs(track.roadHeight(b.s0 + 1e-6, l) - track.roadHeight(b.s0 - 1e-6, l))).toBeLessThan(1e-4);
  });

  it('is smooth on featureless class A/B sections (slope < 0.1, centreline within 15 mm of the macro elevation)', () => {
    const p = newSample();
    for (const id of ['brake-zone', 'hairpin', 'sweeper', 'chicane', 'carousel', 'dlc']) {
      // Skip the 5 m class blends at the ends (a neighbour may be class C/D).
      const s0 = sec(id).s0 + 5;
      const s1 = sec(id).s1 - 5;
      for (const l of [-0.8, 0, 0.8]) expect(maxAbs((s) => (track.roadHeight(s + 0.01, l) - track.roadHeight(s, l)) / 0.01, s0, s1 - 0.01, 0.01)).toBeLessThan(0.1);
      expect(maxAbs((s) => track.roadHeight(s, 0) - track.sample(s, p).z, s0, s1, 0.05)).toBeLessThan(0.015);
    }
  });

  it('puts the one-sided bump only on the left wheel path, at full height', () => {
    const b = sec('bump-strip').s0 + 40;
    expect(feature(b + 0.4, 0.85)).toBeCloseTo(0.05, 9);
    for (const l of [-0.85, 0, 0.39, 1.31, 3]) expect(maxAbs((s) => feature(s, l), b - 0.1, b + 0.9)).toBe(0);
  });

  it('cuts the pothole on the right wheel path, 60 mm deep, nothing beyond its radius', () => {
    const c = sec('bump-strip').s0 + 70;
    expect(feature(c, -0.8)).toBeCloseTo(-0.06, 9);
    expect(feature(c + 0.31, -0.8)).toBe(0);
    expect(feature(c, -0.8 + 0.31)).toBe(0);
    expect(feature(c, 0.8)).toBe(0);
  });

  it('raises the kerb strike only in the right kerb band', () => {
    const k = sec('bump-strip').s0 + 100;
    expect(feature(k + 6, -5.25)).toBeCloseTo(0.06, 9);
    for (const l of [-6.01, -4.49, -0.8, 0, 4.8, 5.25]) expect(maxAbs((s) => feature(s, l), k - 1, k + 13, 0.05)).toBe(0);
  });

  it('sweeps the washboard at 12 mm amplitude and builds the pave and humps as specified', () => {
    const w = sec('launch').s0;
    const amp = maxAbs((s) => feature(s, 0), w, w + 80, 0.002);
    expect(amp).toBeLessThanOrEqual(0.012 + 1e-12);
    expect(amp).toBeGreaterThan(0.0119);
    expect(maxAbs((s) => feature(s, 0), w + 80, w + 100)).toBe(0);

    const p = sec('pave').s0;
    let lo = 0;
    let hi = 0;
    for (let s = p; s < p + 45; s += 0.013)
      for (let l = -4; l <= 4; l += 0.37) {
        const h = feature(s, l);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
    expect(lo).toBeGreaterThanOrEqual(-0.013 - 1e-12);
    expect(lo).toBeLessThan(-0.005);
    expect(hi).toBeLessThanOrEqual(0.008);
    expect(hi).toBeGreaterThan(0.006);
    for (let k = 0; k < 3; k++) expect(feature(p + 55 + 16 * k + 1.85, 0)).toBeCloseTo(0.08, 9);
    expect(feature(p + 55 + 3.7 + 1, 0)).toBe(0);
  });

  it('shapes the crest and dip with vertical radius >= 120 m (|a_z| <= 0.6 g at target speed)', () => {
    const c = sec('crest');
    const p = newSample();
    const h = 0.05;
    const zpp = maxAbs((s) => (track.sample(s + h, p).grade - track.sample(s - h, p).grade) / (2 * h), c.s0, c.s1, 0.1);
    const v = c.def.targetSpeed!;
    console.log(`crest: min vertical radius ${(1 / zpp).toFixed(1)} m, |a_z| at ${v} m/s = ${((v * v * zpp) / G).toFixed(3)} g`);
    expect(1 / zpp).toBeGreaterThanOrEqual(120);
    expect(v * v * zpp).toBeLessThanOrEqual(0.6 * G);
    const mid = c.s0 + 15;
    expect(track.sample(mid, p).z - smooth.sample(mid, p).z).toBe(0); // vertical curves are macro elevation
    const chord = 0.5 * (track.sample(c.s0, p).z + track.sample(c.s0 + 30, p).z); // removes the gentle swell
    expect(track.sample(mid, p).z - chord).toBeCloseTo(0.35, 2);
  });

  it('banks the corners with the §4 sign (+ = left edge up), ramped over the clothoids', () => {
    const p = newSample();
    const bankAt = (id: string, f: number): number => {
      const x = sec(id);
      return track.sample(x.s0 + f * (x.s1 - x.s0), p).bank;
    };
    expect(bankAt('carousel', 0.5)).toBeCloseTo(8 * DEG_TO_RAD, 12);
    expect(bankAt('sweeper', 0.5)).toBeCloseTo(-3 * DEG_TO_RAD, 12);
    expect(bankAt('off-camber', 0.5)).toBeCloseTo(-5 * DEG_TO_RAD, 12);
    expect(bankAt('carousel', 0)).toBe(0);
    expect(bankAt('chicane', 0.5)).toBe(0);
    // Carousel (right turn): the left (outside) edge is higher.
    const mid = (sec('carousel').s0 + sec('carousel').s1) / 2;
    expect(smooth.roadHeight(mid, 4) - smooth.roadHeight(mid, -4)).toBeGreaterThan(8 * Math.tan(8 * DEG_TO_RAD) - 0.03);
  });

  it('generates ISO 8608 roughness with the class RMS and exact lap periodicity', () => {
    const r = createRoughness(track.length, 42);
    // sigma^2 = Gd(n0) n0^2 (1/nMin - 1/nMax) for w = 2.
    const sigma = Math.sqrt(UNIT_GD0 * 0.01 * (1 / N_MIN - 1 / N_MAX));
    expect(r.unitRms / sigma).toBeGreaterThan(0.95);
    expect(r.unitRms / sigma).toBeLessThan(1.05);
    let sum = 0;
    const n = Math.round(track.length / 0.02);
    for (let i = 0; i < n; i++) sum += r.at((i * track.length) / n, 0.8) ** 2;
    expect(Math.sqrt(sum / n) / r.unitRms).toBeCloseTo(1, 6);
    expect(r.at(track.length - 1e-9, 0.3)).toBeCloseTo(r.at(0, 0.3), 9);
    console.log(`ISO 8608 RMS: class B ${((r.unitRms * classScale('B')) * 1000).toFixed(2)} mm, class D ${((r.unitRms * classScale('D')) * 1000).toFixed(2)} mm`);
    // Left and right wheel paths differ (roll excitation exists).
    let diff = 0;
    for (let i = 0; i < n; i += 7) diff += Math.abs(r.at((i * track.length) / n, 0.8) - r.at((i * track.length) / n, -0.8));
    expect(diff / (n / 7)).toBeGreaterThan(0.1 * r.unitRms);
  });
});
