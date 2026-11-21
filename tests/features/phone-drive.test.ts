import { describe, expect, it } from 'vitest';
import { createPhoneLink, deliberate, failsafeGain, LINK, linkLevel, phaseOf, seqNewer, telFrame, type LinkOutput } from '../../src/features/phone-drive/link';

const out = (): LinkOutput => ({ steer: 0, throttle: 0, brake: 0, handbrake: 0, wanted: false });
const frame = (n: number, r: number, s = 0, th = 0, br = 0, f = LINK.flagWanted) => ({ n, s, th, br, f, r });

describe('sequence order (u32, wrapping)', () => {
  it('accepts newer, drops equal / older, survives the wrap', () => {
    expect(seqNewer(2, 1)).toBe(true);
    expect(seqNewer(1, 1)).toBe(false);
    expect(seqNewer(1, 2)).toBe(false);
    expect(seqNewer(0, 0xffffffff)).toBe(true);
    expect(seqNewer(5, 0xfffffff0)).toBe(true);
    expect(seqNewer(0xfffffff0, 5)).toBe(false);
  });
});

describe('failsafe timeline', () => {
  it('holds for 250 ms, decays to neutral over 300 ms, is lost at 1 s', () => {
    expect(failsafeGain(0)).toBe(1);
    expect(failsafeGain(250)).toBe(1);
    expect(failsafeGain(400)).toBeCloseTo(0.5, 9);
    expect(failsafeGain(550)).toBe(0);
    expect(failsafeGain(900)).toBe(0);
    expect([100, 300, 999, 1000, 5000].map(phaseOf)).toEqual(['live', 'decay', 'decay', 'lost', 'lost']);
  });

  it('link badge levels: amber > 150 ms, red > 250 ms', () => {
    expect([20, 150, 151, 250, 251, Infinity].map(linkLevel)).toEqual(['ok', 'ok', 'amber', 'amber', 'red', 'red']);
  });

  it('a silent phone decays (braking only when moving) and is then lost', () => {
    const link = createPhoneLink();
    const o = out();
    expect(link.sample(0, true, o)).toBe('idle');
    link.receive(frame(1, 1000, -600, 800, 0), 0);
    expect(link.sample(100, true, o)).toBe('live');
    expect(o.steer).toBeCloseTo(-0.6, 9);
    expect(o.throttle).toBeCloseTo(0.8, 9);
    expect(link.sample(400, true, o)).toBe('decay');
    expect(o.steer).toBeCloseTo(-0.3, 9);
    expect(o.throttle).toBeCloseTo(0.4, 9);
    expect(o.brake).toBeCloseTo(LINK.brakeOnLoss * 0.5, 9);
    link.sample(400, false, o);
    expect(o.brake).toBe(0); // at a standstill a held brake would select reverse
    expect(link.sample(600, true, o)).toBe('decay');
    expect([o.steer, o.throttle]).toEqual([-0, 0]);
    expect(link.sample(1000, true, o)).toBe('lost');
    expect([o.steer, o.throttle, o.brake, o.wanted]).toEqual([0, 0, 0, false]);
  });

  it('presence drop = lost at once, until the next frame', () => {
    const link = createPhoneLink();
    const o = out();
    link.receive(frame(1, 0, 500), 0);
    link.drop();
    expect(link.sample(10, true, o)).toBe('lost');
    link.receive(frame(2, 30, 500), 30);
    expect(link.sample(30, true, o)).toBe('live');
  });
});

describe('interpolation over one packet period', () => {
  it('moves from the value at arrival to the new target over the r spacing, then holds (no extrapolation)', () => {
    const link = createPhoneLink();
    const o = out();
    link.receive(frame(1, 1000, 0), 0);
    link.sample(100, true, o); // settled at 0
    link.receive(frame(2, 1040, 1000, 1000), 100); // 40 ms after the previous frame at the room
    link.sample(120, true, o);
    expect(o.steer).toBeCloseTo(0.5, 9);
    expect(o.throttle).toBeCloseTo(0.5, 9);
    link.sample(140, true, o);
    expect(o.steer).toBeCloseTo(1, 9);
    link.sample(170, true, o);
    expect(o.steer).toBeCloseTo(1, 9); // held, not extrapolated
  });

  it('downlink jitter does not stretch the ramp: the period comes from the room stamps', () => {
    const link = createPhoneLink();
    const o = out();
    link.receive(frame(1, 1000, 0), 0);
    link.sample(50, true, o);
    // the frame was sent 33 ms after the previous one, but reached the screen 90 ms later (bunched)
    link.receive(frame(2, 1033, 1000), 90);
    link.sample(90 + 33, true, o);
    expect(o.steer).toBeCloseTo(1, 9);
  });

  it('a burst keeps only the newest frame; stale and duplicate frames are dropped', () => {
    const link = createPhoneLink();
    const o = out();
    expect(link.receive(frame(10, 0, 100), 0)).toBe(true);
    expect(link.receive(frame(9, 1, 900), 1)).toBe(false);
    expect(link.receive(frame(10, 2, 900), 2)).toBe(false);
    link.sample(100, true, o);
    expect(o.steer).toBeCloseTo(0.1, 9);
  });

  it('first frame after a loss ramps from neutral, not from the old state', () => {
    const link = createPhoneLink();
    const o = out();
    link.receive(frame(1, 0, 1000), 0);
    link.sample(50, true, o);
    link.receive(frame(2, 3000, -1000), 3000); // 3 s later
    link.sample(3000 + 1000 / 60, true, o);
    expect(o.steer).toBeCloseTo(-0.5, 2);
  });
});

describe('arbiter input and tel', () => {
  it('deliberate only when the phone wants to drive and shows input', () => {
    expect(deliberate({ steer: 0.5, throttle: 0, brake: 0, handbrake: 0, wanted: false })).toBe(false);
    expect(deliberate({ steer: 0.01, throttle: 0, brake: 0, handbrake: 0, wanted: true })).toBe(false);
    expect(deliberate({ steer: 0, throttle: 0.3, brake: 0, handbrake: 0, wanted: true })).toBe(true);
    const link = createPhoneLink();
    const o = out();
    link.receive(frame(1, 0, 0, 1000, 0, LINK.flagWanted | LINK.flagHandbrake), 0);
    link.sample(50, true, o);
    expect([o.wanted, o.handbrake]).toEqual([true, 1]);
  });

  it('packs tel within the contract ranges', () => {
    expect(telFrame(27.8, 4, 'manual', 3)).toEqual({ t: 'tel', v: 100, g: 4, m: 1, k: 3 });
    expect(telFrame(400, 20, 'returning', 7)).toEqual({ t: 'tel', v: 999, g: 12, m: 2, k: 3 });
    expect(telFrame(Number.NaN, -3, 'auto', 0)).toEqual({ t: 'tel', v: 0, g: -1, m: 0, k: 0 });
  });
});
