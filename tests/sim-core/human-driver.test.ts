/** HumanDriver (ARCHITECTURE-M2 §7.9, 08-02 scope) and intent quantisation (§7.1). */
import { describe, expect, it } from 'vitest';
import { DEFAULT_AIDS, INTENT_QUANT, type DriveIntent } from '../../src/contracts/drive';
import { G, SIM_DT } from '../../src/contracts/units';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { createHumanDriver } from '../../src/sim-core/drive/human-driver';
import { createDriveCommand, createQuantIntent, quantiseIntent, type DriveCommand, type PlantView } from '../../src/sim-core/drive/types';

const view = (o: Partial<PlantView> = {}): PlantView => ({
  x: 0,
  y: 0,
  cosYaw: 1,
  sinYaw: 0,
  u: 0,
  v: 0,
  r: 0,
  steer: 0,
  beta: 0,
  wheelbase: gtCoupe.wheelbase,
  maxSteer: gtCoupe.maxSteer,
  lateralLimit: 0.9 * gtCoupe.front.tyre.mu * G,
  simTime: 0,
  ...o,
});
const intent = (o: Partial<DriveIntent>): DriveIntent => ({ steer: 0, throttle: 0, brake: 0, handbrake: 0, digital: true, source: 'keyboard', ...o });

function driver(aids = DEFAULT_AIDS) {
  const d = createHumanDriver(gtCoupe);
  d.setAids(aids);
  const q = createQuantIntent();
  const cmd = createDriveCommand();
  d.engage(view(), { steer: 0, throttle: 0, brake: 0, handbrake: 0, direction: 1 });
  let tick = 0;
  const h = {
    d,
    cmd,
    hold(i: DriveIntent, seconds: number, v: PlantView = view()): DriveCommand {
      for (let k = 0; k < Math.round(seconds / SIM_DT); k++) {
        if (tick++ % 4 === 0) d.latch(quantiseIntent(i, q));
        d.step(SIM_DT, v, cmd);
      }
      return cmd;
    },
  };
  h.hold(intent({}), 0.3); // past the engage blend
  return h;
}

describe('quantiseIntent', () => {
  it('maps to the INTENT_QUANT integers with clamps, flags and NaN safety', () => {
    const q = createQuantIntent();
    quantiseIntent(intent({ steer: -2, throttle: 0.5, brake: NaN, handbrake: 1, digital: false, source: 'touch' }), q);
    expect(q).toEqual({ steer: -INTENT_QUANT.steer, throttle: 128, brake: 0, handbrake: INTENT_QUANT.pedal, flags: 2 << 1 });
    quantiseIntent(intent({ steer: 0.25 }), q);
    expect(q.steer).toBe(256);
    expect(q.flags & 1).toBe(1);
  });
});

describe('HumanDriver', () => {
  it('ramps digital steer at 3 /s rising, 7 /s falling, snapping through zero on a reversal', () => {
    const h = driver({ ...DEFAULT_AIDS, steering: false });
    h.hold(intent({ steer: 1 }), 0.2);
    expect(h.cmd.steer / gtCoupe.maxSteer).toBeCloseTo(0.6, 1);
    h.hold(intent({ steer: 1 }), 0.3);
    expect(h.cmd.steer / gtCoupe.maxSteer).toBeCloseTo(1, 6);
    h.hold(intent({ steer: 0 }), 0.1);
    expect(h.cmd.steer / gtCoupe.maxSteer).toBeCloseTo(0.3, 1);
    h.hold(intent({ steer: 1 }), 0.1);
    h.hold(intent({ steer: -1 }), SIM_DT * 4); // reversal: snap to 0, then rise
    expect(h.cmd.steer).toBeLessThan(0);
    expect(h.cmd.steer / gtCoupe.maxSteer).toBeGreaterThan(-0.06);
  });

  it('ramps pedals (throttle 2.5 / 6, brake 4 / 10 per s), handbrake instant; analog passes through', () => {
    const h = driver();
    h.hold(intent({ throttle: 1 }), 0.2);
    expect(h.cmd.throttle).toBeCloseTo(0.5, 1);
    h.hold(intent({ throttle: 0, brake: 1, handbrake: 1 }), 0.1);
    expect(h.cmd.throttle).toBeCloseTo(0, 6);
    expect(h.cmd.brake).toBeCloseTo(0.4, 1);
    expect(h.cmd.handbrake).toBe(1);
    const a = driver();
    a.hold(intent({ throttle: 0.37, digital: false, source: 'gamepad' }), 0.4); // past the engage blend
    expect(a.cmd.throttle).toBeCloseTo(Math.round(0.37 * 255) / 255, 12);
  });

  it('limits steer near the grip limit at speed but not when countersteering; aids off = full lock', () => {
    const fast = view({ u: 30 });
    const h = driver();
    h.hold(intent({ steer: 1 }), 1, fast);
    const lim = Math.atan((gtCoupe.wheelbase * fast.lateralLimit) / 900) + 0.12;
    expect(h.cmd.steer).toBeCloseTo(Math.min(gtCoupe.maxSteer, lim), 6);
    expect(h.cmd.steer).toBeLessThan(gtCoupe.maxSteer);
    // oversteer to the left (r > 0, beta < 0): steering right is a countersteer, full lock allowed
    const slide = view({ u: 30, r: 0.5, beta: -0.2 });
    h.hold(intent({ steer: -1 }), 1, slide);
    expect(h.cmd.steer).toBeCloseTo(-gtCoupe.maxSteer, 6);
    const off = driver({ ...DEFAULT_AIDS, steering: false });
    off.hold(intent({ steer: 1 }), 1, fast);
    expect(off.cmd.steer).toBeCloseTo(gtCoupe.maxSteer, 6);
  });

  it('selects reverse after the brake is held 0.25 s at standstill, and forward after throttle 0.15 s', () => {
    const h = driver();
    h.hold(intent({ brake: 1 }), 0.2);
    expect(h.cmd.direction).toBe(1);
    h.hold(intent({ brake: 1 }), 0.1);
    expect(h.cmd.direction).toBe(-1);
    // in reverse the brake pedal drives backwards, the throttle pedal brakes
    h.hold(intent({ brake: 1 }), 0.5, view({ u: -2 }));
    expect(h.cmd.throttle).toBeCloseTo(1, 6);
    expect(h.cmd.brake).toBe(0);
    h.hold(intent({ throttle: 1 }), 0.1, view({ u: -2 }));
    expect(h.cmd.direction).toBe(-1); // u < -0.5: still reversing (the throttle brakes)
    expect(h.cmd.brake).toBeGreaterThan(0);
    h.hold(intent({ throttle: 1 }), 0.2, view({ u: -0.2 }));
    expect(h.cmd.direction).toBe(1);
    // never on the sign of u alone: rolling backwards with no pedal keeps the direction
    h.hold(intent({}), 1, view({ u: -1 }));
    expect(h.cmd.direction).toBe(1);
    // braking while moving never selects reverse
    h.hold(intent({ brake: 1 }), 1, view({ u: 10 }));
    expect(h.cmd.direction).toBe(1);
  });

  it('engages bumplessly from the command in force over 0.3 s (a harder brake applies at once)', () => {
    const d = createHumanDriver(gtCoupe);
    d.setAids({ ...DEFAULT_AIDS, steering: false });
    const q = createQuantIntent();
    const cmd = createDriveCommand();
    d.engage(view({ u: 20 }), { steer: 0.1, throttle: 0.6, brake: 0, handbrake: 0, direction: 1 });
    d.latch(quantiseIntent(intent({}), q));
    d.step(SIM_DT, view({ u: 20 }), cmd);
    expect(cmd.steer).toBeCloseTo(0.1 * (1 - SIM_DT / 0.3), 6);
    expect(cmd.throttle).toBeCloseTo(0.6 * (1 - SIM_DT / 0.3), 6);
    for (let k = 0; k < 80; k++) d.step(SIM_DT, view({ u: 20 }), cmd);
    expect(cmd.steer).toBe(0);
    expect(cmd.throttle).toBe(0);
    d.engage(view({ u: 20 }), { steer: 0, throttle: 0, brake: 0.2, handbrake: 0, direction: 1 });
    d.latch(quantiseIntent(intent({ brake: 1, digital: false, source: 'gamepad' }), q));
    d.step(SIM_DT, view({ u: 20 }), cmd);
    expect(cmd.brake).toBeCloseTo(1, 6);
  });

  it('counts idle seconds since the last non-neutral latch', () => {
    const h = driver();
    h.hold(intent({ steer: 0.5 }), 0.5);
    expect(h.d.idle).toBeLessThan(0.02);
    h.hold(intent({}), 2);
    expect(h.d.idle).toBeCloseTo(2, 1);
    expect(h.d.source).toBe('keyboard');
  });
});
