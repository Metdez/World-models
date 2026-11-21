import { describe, expect, it } from 'vitest';
import {
  ENGINE_GAIN_MAX,
  engineRevs,
  engineTone,
  RAMP_TAU,
  ramp,
  RATE_MAX,
  RATE_MIN,
  SKID_GAIN_MAX,
  skidTone,
  engineToneDrive,
  squealTone,
  SQUEAL_ONSET,
  surfaceTone,
  SURFACE_GAIN_MAX,
  tyreUse,
  PAVE_STONE,
  type SurfaceTone,
  THUMP_GAIN_MAX,
  THUMP_RATE,
  thumpGain,
  type Tone,
} from '../../src/features/audio/mix';

const CLASSES = ['car', 'motorcycle'] as const;
const tone = (): Tone => ({ rate: 0, gain: 0 });

describe('audio mapping (sim state -> rates and gains)', () => {
  it('engine rate and gain stay bounded for any input, NaN included', () => {
    const inputs = [-80, -5, 0, 0.5, 3, 12, 25, 40, 60, 95, 300, Number.NaN, Number.POSITIVE_INFINITY];
    for (const cls of CLASSES)
      for (const speed of inputs)
        for (const ax of [-30, -6, 0, 2, 4, 12, Number.NaN])
          for (const ts of [0, 0.25, 1, 3]) {
            const o = engineTone(tone(), cls, speed, ax, ts, false);
            expect(o.rate).toBeGreaterThanOrEqual(RATE_MIN);
            expect(o.rate).toBeLessThanOrEqual(RATE_MAX);
            expect(o.gain).toBeGreaterThanOrEqual(0);
            expect(o.gain).toBeLessThanOrEqual(ENGINE_GAIN_MAX);
          }
  });

  it('revs climb within a gear and drop on an upshift; the bike revs higher', () => {
    for (const cls of CLASSES) {
      expect(engineRevs(cls, 0)).toBe(0);
      expect(engineRevs(cls, 8)).toBeGreaterThan(engineRevs(cls, 4));
      expect(engineRevs(cls, 200)).toBe(1);
    }
    expect(engineRevs('car', 12.9)).toBeGreaterThan(0.95);
    expect(engineRevs('car', 13.1)).toBeLessThan(0.5); // 2nd gear
    const car = engineTone(tone(), 'car', 30, 0, 1, false);
    const bike = engineTone(tone(), 'motorcycle', 30, 0, 1, false);
    expect(bike.rate).toBeGreaterThan(car.rate);
  });

  it('throttle is louder than cruising, braking is quieter, pause is silent, slow motion lowers the pitch', () => {
    const cruise = engineTone(tone(), 'car', 30, 0, 1, false);
    const accel = engineTone(tone(), 'car', 30, 4, 1, false);
    const brake = engineTone(tone(), 'car', 30, -8, 1, false);
    expect(accel.gain).toBeGreaterThan(cruise.gain);
    expect(brake.gain).toBeLessThan(cruise.gain);
    expect(engineTone(tone(), 'car', 30, 4, 1, true).gain).toBe(0);
    expect(engineTone(tone(), 'car', 30, 0, 0.25, false).rate).toBeLessThan(cruise.rate);
  });

  it('tyre noise only near the grip limit and only when moving', () => {
    expect(skidTone(tone(), 0.5, 30, false).gain).toBe(0);
    expect(skidTone(tone(), 0.8, 30, false).gain).toBe(0);
    expect(skidTone(tone(), 0.95, 30, false).gain).toBeGreaterThan(0);
    expect(skidTone(tone(), 1.2, 30, false).gain).toBeCloseTo(SKID_GAIN_MAX, 6);
    expect(skidTone(tone(), 1.2, 0.5, false).gain).toBe(0);
    expect(skidTone(tone(), 1.2, 30, true).gain).toBe(0);
    for (const g of [-1, 0, 0.9, 1.1, 5, Number.NaN]) {
      const o = skidTone(tone(), g, 30, false);
      expect(o.gain).toBeGreaterThanOrEqual(0);
      expect(o.gain).toBeLessThanOrEqual(SKID_GAIN_MAX);
      expect(o.rate).toBeGreaterThanOrEqual(RATE_MIN);
      expect(o.rate).toBeLessThanOrEqual(RATE_MAX);
    }
  });

  it('thump gain grows with the travel-rate spike and a bump-stop hit is full scale', () => {
    expect(thumpGain(THUMP_RATE)).toBeLessThan(thumpGain(THUMP_RATE + 0.5));
    expect(thumpGain(-2)).toBe(thumpGain(2));
    expect(thumpGain(0, 1)).toBeCloseTo(THUMP_GAIN_MAX, 6);
    for (const r of [0, 0.5, 1, 10, 100]) expect(thumpGain(r)).toBeLessThanOrEqual(THUMP_GAIN_MAX);
  });

  it('ramps are exponential approaches (setTargetAtTime, tau >= 20 ms) and tiny changes are skipped', () => {
    const calls: [number, number, number][] = [];
    const param = { setTargetAtTime: (v: number, t: number, tau: number) => calls.push([v, t, tau]) };
    const last = { v: 0 };
    ramp(param, last, 0.5, 1);
    ramp(param, last, 0.5004, 1.01); // below eps: no new automation event
    ramp(param, last, 0.2, 1.02);
    expect(calls).toEqual([
      [0.5, 1, RAMP_TAU],
      [0.2, 1.02, RAMP_TAU],
    ]);
    expect(RAMP_TAU).toBeGreaterThanOrEqual(0.02);
  });
});

describe('audio while driving (11-02): real engine speed and load, tyre cue, road noise', () => {
  const NUMS = [-1e9, -5, 0, 0.3, 0.75, 0.8, 1, 1.2, 900, 2200, 6500, 7000, 1e9, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  const surf = (): SurfaceTone => ({ gain: 0, freq: 0, mod: 0, depth: 0 });

  it('engine from rpm and throttle: bounded and finite for any input, pitch follows the revs, gain follows the load', () => {
    for (const cls of CLASSES)
      for (const rpm of NUMS)
        for (const thr of [-1, 0, 0.5, 1, 3, Number.NaN])
          for (const [idle, red] of [[900, 7000], [7000, 900], [Number.NaN, 7000], [900, 900]] as const) {
            const o = engineToneDrive(tone(), cls, rpm, idle, red, thr, 1, false);
            expect(Number.isFinite(o.rate) && Number.isFinite(o.gain)).toBe(true);
            expect(o.rate).toBeGreaterThanOrEqual(RATE_MIN);
            expect(o.rate).toBeLessThanOrEqual(RATE_MAX);
            expect(o.gain).toBeGreaterThanOrEqual(0);
            expect(o.gain).toBeLessThanOrEqual(ENGINE_GAIN_MAX);
          }
    const at = (rpm: number, thr = 0.5) => engineToneDrive(tone(), 'car', rpm, 900, 7000, thr, 1, false);
    expect(at(6000).rate).toBeGreaterThan(at(3000).rate);
    expect(at(900).rate).toBeLessThan(at(1500).rate);
    expect(at(3000, 1).gain).toBeGreaterThan(at(3000, 0).gain);
    expect(engineToneDrive(tone(), 'car', 3000, 900, 7000, 1, 1, true).gain).toBe(0);
    expect(engineToneDrive(tone(), 'car', 7000, 900, 7000, 1, 0.25, false).rate).toBeLessThan(at(7000).rate); // slow motion lowers it
  });

  it('tyre cue starts before the limit (onset 0.75), is full at the limit, silent at a standstill', () => {
    expect(SQUEAL_ONSET).toBe(0.75);
    expect(squealTone(tone(), 0.7, 20, false).gain).toBe(0);
    expect(squealTone(tone(), 0.8, 20, false).gain).toBeGreaterThan(0);
    expect(squealTone(tone(), 0.8, 20, false).gain).toBeLessThan(squealTone(tone(), 0.95, 20, false).gain);
    expect(squealTone(tone(), 1, 20, false).gain).toBeCloseTo(SKID_GAIN_MAX, 9);
    expect(squealTone(tone(), 1, 0.5, false).gain).toBe(0);
    expect(squealTone(tone(), 1, 20, true).gain).toBe(0);
    // earlier than the Auto skid noise (silent below 0.8)
    expect(skidTone(tone(), 0.78, 20, false).gain).toBe(0);
    expect(squealTone(tone(), 0.78, 20, false).gain).toBeGreaterThan(0);
    for (const u of NUMS)
      for (const v of NUMS) {
        const o = squealTone(tone(), u, v, false);
        expect(Number.isFinite(o.rate) && Number.isFinite(o.gain)).toBe(true);
        expect(o.gain).toBeGreaterThanOrEqual(0);
        expect(o.gain).toBeLessThanOrEqual(SKID_GAIN_MAX);
        expect(o.rate).toBeGreaterThanOrEqual(RATE_MIN);
        expect(o.rate).toBeLessThanOrEqual(RATE_MAX);
      }
  });

  it('tyre use: the model grip use, and over the limit when the slip is clearly past the peak', () => {
    expect(tyreUse(0.5, 0.01, 0.02)).toBe(0.5);
    expect(tyreUse(0.88, 0.3, 0)).toBeGreaterThan(1); // sliding sideways: the model force has fallen a little
    expect(tyreUse(0.9, 0, -0.6)).toBeGreaterThan(1); // locked
    expect(tyreUse(Number.NaN, 0, 0)).toBe(0);
    expect(tyreUse(5, 0, 0)).toBeLessThanOrEqual(1.2);
  });

  it('road noise: bounded and finite; level follows wheel travel rate; cobbles and kerbs add a texture at the stone rate', () => {
    for (const surface of ['asphalt', 'asphalt-wet', 'kerb', 'pave', 'grass', 'ceramic-wet', 'unknown'])
      for (const r of NUMS)
        for (const v of NUMS) {
          const o = surfaceTone(surf(), surface, r, v, false);
          for (const x of [o.gain, o.freq, o.mod, o.depth]) expect(Number.isFinite(x)).toBe(true);
          expect(o.gain).toBeGreaterThanOrEqual(0);
          expect(o.gain).toBeLessThanOrEqual(SURFACE_GAIN_MAX);
          expect(o.depth).toBeGreaterThanOrEqual(0);
          expect(o.depth).toBeLessThanOrEqual(1);
          expect(o.freq).toBeGreaterThan(20);
          expect(o.mod).toBeGreaterThanOrEqual(0);
          expect(o.mod).toBeLessThanOrEqual(80);
        }
    expect(surfaceTone(surf(), 'asphalt', 0.3, 15, false).gain).toBeGreaterThan(surfaceTone(surf(), 'asphalt', 0.02, 15, false).gain);
    expect(surfaceTone(surf(), 'asphalt', 0.3, 0, false).gain).toBe(0);
    expect(surfaceTone(surf(), 'asphalt', 0.3, 15, true).gain).toBe(0);
    expect(surfaceTone(surf(), 'asphalt', 0.3, 15, false).depth).toBe(0);
    const pave = surfaceTone(surf(), 'pave', 0, 6, false);
    expect(pave.gain).toBeGreaterThan(0);
    expect(pave.mod).toBeCloseTo(6 / PAVE_STONE, 9);
    expect(surfaceTone(surf(), 'kerb', 0, 10, false).mod).toBeGreaterThan(surfaceTone(surf(), 'kerb', 0, 5, false).mod);
  });
});
