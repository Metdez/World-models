import { describe, expect, it } from 'vitest';
import { driverKeyFromHash, readRemoteTarget, statusForClose } from '../../src/remote/connection';
import { inFrame, learnSign, OneEuro, pedalStep, rawAngle, sliderSteer, steerFromAngle, TILT, wrap180 } from '../../src/remote/tilt';
import { createPhoneLink, deliberate, failsafeGain, LINK, linkLevel, phaseOf, seqNewer, telFrame, type LinkOutput } from '../../src/features/phone-drive/link';

const out = (): LinkOutput => ({ steer: 0, throttle: 0, brake: 0, handbrake: 0, wanted: false });
const frame = (n: number, r: number, s = 0, th = 0, br = 0, f: number = LINK.flagWanted) => ({ n, s, th, br, f, r });

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
    const walk = (from: number, to: number) => {
      for (let t = from; t < to; t += 50) link.sample(t, true, o); // a healthy 20 Hz screen
    };
    expect(link.sample(100, true, o)).toBe('live');
    expect(o.steer).toBeCloseTo(-0.6, 9);
    expect(o.throttle).toBeCloseTo(0.8, 9);
    walk(150, 400);
    expect(link.sample(400, true, o)).toBe('decay');
    expect(o.steer).toBeCloseTo(-0.3, 9);
    expect(o.throttle).toBeCloseTo(0.4, 9);
    expect(o.brake).toBeCloseTo(LINK.brakeOnLoss * 0.5, 9);
    link.sample(400, false, o);
    expect(o.brake).toBe(0); // at a standstill a held brake would select reverse
    walk(450, 600);
    expect(link.sample(600, true, o)).toBe('decay');
    expect([o.steer, o.throttle]).toEqual([-0, 0]);
    walk(650, 1000);
    expect(link.sample(1000, true, o)).toBe('lost');
    expect([o.steer, o.throttle, o.brake, o.wanted]).toEqual([0, 0, 0, false]);
  });

  it('a stall of the screen itself (one long frame) is not counted as phone silence', () => {
    const link = createPhoneLink();
    const o = out();
    link.receive(frame(1, 0, 500), 0);
    expect(link.sample(2000, true, o)).toBe('live');
    expect(link.silentMs).toBe(LINK.stallStepMs);
    expect(o.steer).toBeCloseTo(0.5, 9);
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

  it('a newer phone starting elsewhere in the sequence space is a new stream, not stale', () => {
    const link = createPhoneLink();
    const o = out();
    link.receive(frame(5000, 0, 100), 0);
    expect(link.receive(frame(4990, 30, 200), 30)).toBe(false); // a short step back: a duplicate/replay
    expect(link.receive(frame(17, 60, 300), 60)).toBe(true); // far back: another sender
    expect(link.receive(frame(18, 90, 400), 90)).toBe(true);
    link.sample(200, true, o);
    expect(o.steer).toBeCloseTo(0.4, 9);
  });

  it('first frame after a loss ramps from neutral, not from the old state', () => {
    const link = createPhoneLink();
    const o = out();
    link.receive(frame(1, 0, 1000), 0);
    for (let t = 50; t < 3000; t += 50) link.sample(t, true, o); // 3 s of a running screen without frames: lost
    expect(link.sample(3000, true, o)).toBe('lost');
    link.receive(frame(2, 3000, -1000), 3000);
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

// ---------------------------------------------------------------- phone side (src/remote/tilt.ts): synthetic gravity

const G = 9.81;
/**
 * Gravity as a device reports it when its screen plane is upright and the device is rolled by `roll` degrees about
 * its screen normal, starting from a base hold (`base` = where gravity points at rest: 0 portrait, ±90 landscape).
 * `flipX` / `flipAll` model engines that report the axes with other signs (MDN: Chrome vs Firefox; iOS vs Android).
 */
function gravity(base: number, roll: number, opts: { flipX?: boolean; flipAll?: boolean } = {}): [number, number] {
  const a = ((base - roll) * Math.PI) / 180; // rolling the device clockwise turns gravity counter-clockwise in its frame
  let x = G * Math.sin(a);
  let y = G * Math.cos(a);
  if (opts.flipX) x = -x;
  if (opts.flipAll) [x, y] = [-x, -y];
  return [x, y];
}

/** Calibrate (Centre at rest, Done after turning right by 20°) and return the steer (+ = right) for a roll. */
function calibratedSteer(base: number, roll: number, opts: { flipX?: boolean; flipAll?: boolean } = {}): number {
  const neutral = rawAngle(...gravity(base, 0, opts))!;
  const dir = learnSign(neutral, rawAngle(...gravity(base, 20, opts))!);
  expect(dir).not.toBe(0);
  return steerFromAngle(dir * wrap180(rawAngle(...gravity(base, roll, opts))! - neutral));
}

describe('tilt maths (synthetic gravity vectors)', () => {
  it('wraps angles to (-180, 180]', () => {
    expect([0, 180, -180, 190, -190, 540, 359].map(wrap180)).toEqual([0, 180, 180, -170, 170, 180, -1]);
  });

  it('reads the wheel angle in portrait, both landscapes and upside down; holds when the phone lies flat', () => {
    expect(rawAngle(0, G)).toBeCloseTo(0, 9);
    expect(rawAngle(G, 0)).toBeCloseTo(90, 9);
    expect(rawAngle(-G, 0)).toBeCloseTo(-90, 9);
    expect(Math.abs(rawAngle(0, -G)!)).toBeCloseTo(180, 9);
    expect(rawAngle(1, 2)).toBeNull(); // gravity mostly along z: flat on a table
  });

  it('after Centre + Turn right, turning right steers right and left steers left in every hold and sign convention', () => {
    for (const base of [0, 90, -90, 180])
      for (const opts of [{}, { flipX: true }, { flipAll: true }]) {
        const right = calibratedSteer(base, 20, opts);
        const left = calibratedSteer(base, -20, opts);
        expect(right, `base ${base} ${JSON.stringify(opts)}`).toBeGreaterThan(0.3);
        expect(left).toBeCloseTo(-right, 9);
        expect(calibratedSteer(base, 2, opts)).toBe(0); // inside the dead zone
        expect(calibratedSteer(base, 50, opts)).toBe(1); // past full lock
      }
  });

  it('neutral capture makes a tilted resting hold read as straight ahead', () => {
    const base = 90;
    const tiltedRest = 12; // the visitor holds the "wheel" a bit crooked
    const neutral = rawAngle(...gravity(base, tiltedRest))!;
    expect(wrap180(rawAngle(...gravity(base, tiltedRest))! - neutral)).toBeCloseTo(0, 9);
    const dir = learnSign(neutral, rawAngle(...gravity(base, tiltedRest + 20))!);
    expect(steerFromAngle(dir * wrap180(rawAngle(...gravity(base, tiltedRest + 10))! - neutral))).toBeGreaterThan(0);
  });

  it('does not learn a sign from a turn that is too small; the curve has the dead zone, lock and exponent', () => {
    expect(learnSign(90, 95)).toBe(0);
    expect(learnSign(90, 110)).toBe(1);
    expect(learnSign(-170, 175)).toBe(-1); // across the ±180 seam
    expect(steerFromAngle(TILT.deadZone)).toBe(0);
    expect(steerFromAngle(TILT.lock)).toBe(1);
    const mid = (TILT.deadZone + TILT.lock) / 2;
    expect(steerFromAngle(mid)).toBeCloseTo(0.5 ** TILT.exponent, 9);
    expect(steerFromAngle(-mid)).toBeCloseTo(-(0.5 ** TILT.exponent), 9);
  });
});

describe('One-Euro filter', () => {
  it('smooths tremor at rest and follows a deliberate turn with little lag', () => {
    const f = new OneEuro();
    let maxRest = 0;
    for (let i = 0; i < 120; i++) maxRest = Math.max(maxRest, Math.abs(f.filter(Math.sin(i * 1.9) * 1.5, i * 16))); // ±1.5° at ~19 Hz
    expect(maxRest).toBeLessThan(0.75);
    // a 30° turn over 200 ms: within a few degrees 100 ms after it ends
    let y = 0;
    for (let t = 0; t <= 300; t += 16) y = f.filter(Math.min(30, (t / 200) * 30), 2000 + t);
    expect(y).toBeGreaterThan(26);
    f.reset();
    expect(f.filter(10, 0)).toBe(10);
  });
});

describe('touch controls and the input frame', () => {
  it('slider: relative drag with a dead band, full lock before the track end; pedals bite then ramp', () => {
    expect(sliderSteer(3, 200)).toBe(0);
    expect(sliderSteer(100, 200)).toBeGreaterThan(0.5);
    expect(sliderSteer(-400, 200)).toBe(-1);
    expect(pedalStep(0, true, 0)).toBe(0.25);
    expect(pedalStep(0.25, true, 0.1)).toBeCloseTo(0.85, 9);
    expect(pedalStep(0.9, true, 1)).toBe(1);
    expect(pedalStep(1, false, 0.05)).toBeCloseTo(0.4, 9);
    expect(pedalStep(0.1, false, 0.05)).toBe(0);
  });

  it('packs integer frames in the contract ranges, steer + = LEFT on the wire, small enough for the room', () => {
    expect(inFrame(0xffffffff + 1, 0.5, 1, 0, 5)).toEqual({ t: 'in', n: 0, s: -500, th: 1000, br: 0, f: 5 });
    expect(inFrame(7, -2, 2, -1, 15)).toEqual({ t: 'in', n: 7, s: 1000, th: 1000, br: 0, f: 7 });
    expect(inFrame(1, Number.NaN, 0, 0, 1).s).toBe(0);
    expect(Object.is(inFrame(1, 0, 0, 0, 1).s, -0)).toBe(false);
    expect(JSON.stringify(inFrame(0xfffffffe, -1, 1, 1, 7)).length).toBeLessThan(128);
  });
});

describe('driver link on the phone', () => {
  it('takes the key from #d=, keeps it per room in sessionStorage, and one role replaces the other', () => {
    const m = new Map<string, string>();
    const storage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } as unknown as Storage;
    const d = 'D'.repeat(32);
    const k = 'K'.repeat(32);
    expect(driverKeyFromHash(`#d=${d}`)).toBe(d);
    expect(driverKeyFromHash(`#k=${d}`)).toBeNull();
    expect(driverKeyFromHash('#d=short')).toBeNull();
    const loc = (hash: string) => ({ search: '?room=ab2cd', hash, pathname: '/remote' });
    expect(readRemoteTarget(loc(`#k=${k}`), storage)).toEqual({ code: 'AB2CD', hostKey: k });
    expect(readRemoteTarget(loc(`#d=${d}`), storage)).toEqual({ code: 'AB2CD', hostKey: null, driverKey: d });
    expect(readRemoteTarget(loc(''), storage)).toEqual({ code: 'AB2CD', hostKey: null, driverKey: d }); // reload: still the driver
    expect(m.has('sl-remote-host:AB2CD')).toBe(false);
  });

  it('4409 (another phone took the wheel) and 4401 are final; network closes reconnect', () => {
    expect(statusForClose(4409)).toBe('replaced');
    expect(statusForClose(4401)).toBe('denied');
    expect(statusForClose(4404)).toBe('gone');
    expect(statusForClose(1006)).toBeNull();
    expect(statusForClose(1008)).toBeNull();
  });
});
