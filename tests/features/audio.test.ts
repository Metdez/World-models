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
