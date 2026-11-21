/** Powertrain, gearbox and brakes with a fake io (ARCHITECTURE-M2 §7.7; ROADMAP-M2 09-02 P1). */
import { describe, expect, it } from 'vitest';
import { DEFAULT_AIDS, type DriveAids } from '../../src/contracts/drive';
import { SIM_DT } from '../../src/contracts/units';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { gtCoupeBrakes, gtCoupePowertrain as P } from '../../src/sim-core/content/gt-coupe-powertrain';
import { brakeTorques, createPowertrain, createPowertrainIo, STALL_RPM } from '../../src/sim-core/drive/powertrain';

const R = gtCoupe.rear.tyre.radius;
const IW = gtCoupe.handling!.tyres.rear.wheelInertia;
const RPM = 60 / (2 * Math.PI);
const NO_AIDS: DriveAids = { abs: false, traction: false, stability: false, steering: false };
const ratio = (g: number): number => (g < 0 ? P.reverse : P.gears[g - 1]!) * P.finalDrive;
const rpmIdeal = (u: number, g: number): number => (Math.abs(u) / R) * ratio(g) * RPM;

function rig(speed = 0, direction: 1 | -1 = 1) {
  const pt = createPowertrain(P, R, IW);
  const io = createPowertrainIo();
  pt.reset(speed, direction);
  return {
    pt,
    io,
    /** One step at road speed u with rolling (no-slip) wheels unless omega is given. */
    step(u: number, throttle: number, o: { direction?: 1 | -1; omegaL?: number; omegaR?: number; slipSpeed?: number; driveSlip?: number; aids?: DriveAids } = {}) {
      io.speed = u;
      io.throttle = throttle;
      io.direction = o.direction ?? 1;
      io.omegaL = o.omegaL ?? u / R;
      io.omegaR = o.omegaR ?? u / R;
      io.slipSpeed = o.slipSpeed ?? 0;
      io.driveSlip = o.driveSlip ?? 0;
      pt.step(SIM_DT, io, o.aids ?? NO_AIDS);
      return io;
    },
  };
}

/** Gear sequence over a slow linear speed ramp at constant throttle. */
function ramp(from: number, to: number, throttle: number, seconds: number) {
  const r = rig(from);
  const gears: number[] = [];
  const shiftsAt: { from: number; to: number; rpmBefore: number }[] = [];
  const n = Math.round(seconds / SIM_DT);
  let last = r.pt.state[0]!;
  for (let k = 0; k <= n; k++) {
    const u = from + ((to - from) * k) / n;
    r.step(u, throttle);
    if (r.io.gear !== last) shiftsAt.push({ from: last, to: r.io.gear, rpmBefore: rpmIdeal(u, last) });
    last = r.io.gear;
    gears.push(r.io.gear);
  }
  return { gears, shiftsAt };
}

describe('gearbox', () => {
  it('upshifts at the light-throttle rpm and at the full-throttle rpm', () => {
    for (const [throttle, expected] of [
      [0.1, P.upshiftRpm[0] + 0.1 * (P.upshiftRpm[1] - P.upshiftRpm[0])],
      [1, P.upshiftRpm[1]],
    ] as const) {
      const { shiftsAt } = ramp(0, 120, throttle, 200);
      const ups = shiftsAt.filter((s) => s.to === s.from + 1);
      console.log(`[powertrain] throttle ${throttle}: upshift rpm ${ups.map((s) => s.rpmBefore.toFixed(0)).join(', ')}`);
      expect(ups.length).toBe(P.gears.length - 1);
      for (const s of ups) expect(Math.abs(s.rpmBefore - expected)).toBeLessThan(0.01 * expected);
    }
  });

  it.each([0.05, 0.3, 0.6, 1])('no hunting on slow speed ramps up and down (throttle %s)', (throttle) => {
    const up = ramp(0.5, 75, throttle, 150);
    const down = ramp(75, 0.5, throttle, 150);
    for (let k = 1; k < up.gears.length; k++) expect(up.gears[k]).toBeGreaterThanOrEqual(up.gears[k - 1]!);
    for (let k = 1; k < down.gears.length; k++) expect(down.gears[k]).toBeLessThanOrEqual(down.gears[k - 1]!);
    expect(down.gears[down.gears.length - 1]).toBe(1);
  });

  it('kick-down: full throttle drops to the lowest gear below 0.92 x the upshift rpm, then holds', () => {
    const r = rig(25);
    for (let k = 0; k < 480; k++) r.step(25, 0.15);
    const cruise = r.io.gear;
    r.step(25, 1);
    const kicked = r.io.gear;
    let lowest = cruise;
    while (lowest > 1 && rpmIdeal(25, lowest - 1) < 0.92 * P.upshiftRpm[1]) lowest--;
    console.log(`[powertrain] 25 m/s cruise gear ${cruise} -> kick-down to ${kicked} (${rpmIdeal(25, kicked).toFixed(0)} rpm)`);
    expect(kicked).toBeLessThan(cruise);
    expect(kicked).toBe(lowest);
    for (let k = 0; k < 480; k++) r.step(25, 1);
    expect(r.io.gear).toBe(kicked);
    // no kick-down below the threshold throttle
    const r2 = rig(25);
    for (let k = 0; k < 480; k++) r2.step(25, 0.15);
    for (let k = 0; k < 480; k++) r2.step(25, 0.85);
    expect(r2.io.gear).toBe(cruise);
  });

  it('a stop downshifts straight to 1st; reset picks the gear for the speed', () => {
    const r = rig(30);
    for (let k = 0; k < 120; k++) r.step(30, 0);
    expect(r.io.gear).toBeGreaterThan(4);
    r.step(0, 0);
    for (let k = 0; k < 200; k++) r.step(0, 0);
    expect(r.io.gear).toBe(1);
    for (const u of [0, 3, 10, 20, 40]) {
      const g = rig(u).pt.state[0]!;
      if (u < 3) expect(g).toBe(1);
      else expect(rpmIdeal(u, g)).toBeLessThanOrEqual(P.upshiftRpm[0]);
      if (g > 1) expect(rpmIdeal(u, g)).toBeGreaterThan(P.downshiftRpm);
    }
    expect(rig(0, -1).pt.state[0]).toBe(-1);
  });

  it('shift cut, ramp back and lockout timing', () => {
    const r = rig(0);
    let u = 10;
    r.step(u, 1);
    // drive 1st just over the full-throttle upshift rpm
    u = (P.upshiftRpm[1] + 50) / RPM / ratio(1) * R;
    r.step(u, 1);
    expect(r.io.gear).toBe(2);
    const torque: number[] = [];
    const steps = Math.round((P.shift.cut + P.shift.ramp + 0.05) / SIM_DT);
    for (let k = 0; k < steps; k++) torque.push(r.step(u, 1).torqueL + r.io.torqueR);
    const full = torque[torque.length - 1]!;
    const cutSteps = Math.round(P.shift.cut / SIM_DT);
    const rampSteps = Math.round(P.shift.ramp / SIM_DT);
    for (let k = 0; k < cutSteps - 1; k++) expect(torque[k]).toBe(0);
    // linear ramp: the middle of the ramp carries about half the torque
    const mid = torque[cutSteps + Math.round(rampSteps / 2)]! / full;
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
    expect(torque[cutSteps + rampSteps + 2]).toBeCloseTo(full, 6);
    // lockout: a downshift condition right after the shift waits for the lockout
    const r2 = rig(0);
    r2.step(u, 1);
    expect(r2.io.gear).toBe(2);
    let t = 0;
    while (r2.io.gear === 2 && t < 2) {
      r2.step(1, 0.1);
      t += SIM_DT;
    }
    expect(t).toBeGreaterThan(P.shift.lockout - 2 * SIM_DT);
    expect(t).toBeLessThan(P.shift.lockout + 2 * SIM_DT);
  });
});

describe('engine and driveline', () => {
  it('limited-slip split follows the Jolt formula', () => {
    const r = rig(0);
    for (let k = 0; k < 10; k++) r.step(5, 1);
    const at = (wl: number, wr: number) => {
      const io = r.step(5, 1, { omegaL: wl, omegaR: wr });
      return { l: io.torqueL / (io.torqueL + io.torqueR), r: io.torqueR / (io.torqueL + io.torqueR) };
    };
    expect(at(14, 14).l).toBeCloseTo(0.5, 12);
    const a = (16 / 14 - 1) / (P.limitedSlipRatio - 1);
    expect(at(14, 16).l).toBeCloseTo((1 - a) * 0.5 + a, 12);
    expect(at(16, 14).r).toBeCloseTo((1 - a) * 0.5 + a, 12);
    expect(at(14, 14 * P.limitedSlipRatio * 1.1).l).toBeCloseTo(1, 12);
  });

  it('closed-throttle engine braking at 4000 rpm = a + b rpm through the driveline', () => {
    const r = rig(0);
    for (let k = 0; k < 10; k++) r.step(1, 0);
    const g = 3;
    r.pt.state[0] = g;
    r.pt.state[4] = 10; // lockout: hold the gear (light throttle would upshift at 4000 rpm)
    const w = 4000 / RPM / ratio(g);
    const io = r.step(w * R, 0, { omegaL: w, omegaR: w });
    expect(io.gear).toBe(g);
    expect(io.engineRpm).toBeCloseTo(4000, 9);
    const expected = -(P.frictionTorque[0] + P.frictionTorque[1] * 4000) * ratio(g) * P.efficiency;
    expect(io.torqueL + io.torqueR).toBeCloseTo(expected, 9);
  });

  it('no creep at zero throttle; converter-like launch torque with throttle', () => {
    const r = rig(0);
    for (let k = 0; k < 240; k++) {
      expect(r.step(0, 0).torqueL).toBe(0);
      expect(r.io.torqueR).toBe(0);
    }
    for (let k = 0; k < 10; k++) r.step(0, 0.04);
    expect(r.io.torqueL + r.io.torqueR).toBe(0);
    r.step(0, 1);
    const curveAt = (rpm: number) => {
      const xs = P.torqueCurve.rpm;
      const ys = P.torqueCurve.torque;
      for (let k = 1; k < xs.length; k++) if (rpm <= xs[k]!) return ys[k - 1]! + ((ys[k]! - ys[k - 1]!) * (rpm - xs[k - 1]!)) / (xs[k]! - xs[k - 1]!);
      return ys[ys.length - 1]!;
    };
    expect(r.io.torqueL + r.io.torqueR).toBeCloseTo(curveAt(STALL_RPM) * ratio(1) * P.efficiency, 6);
  });

  it('rev limiter: no drive torque at the redline', () => {
    const r = rig(10);
    r.pt.state[0] = 1;
    const w = (P.redlineRpm + 10) / RPM / ratio(1);
    r.pt.state[4] = 10; // hold the gear (lockout)
    expect(r.step(w * R, 1, { omegaL: w, omegaR: w }).torqueL).toBeLessThanOrEqual(0);
  });

  it('reverse: torque backwards at the reverse throttle scale, faded to 0 at the speed cap', () => {
    const r = rig(0, -1);
    for (let k = 0; k < 120; k++) r.step(-1, 1, { direction: -1 });
    expect(r.io.gear).toBe(-1);
    const rev = r.io.torqueL + r.io.torqueR;
    expect(rev).toBeLessThan(0);
    const f = rig(0);
    for (let k = 0; k < 120; k++) f.step(1, 1);
    // same launch-floor rpm (full pedal): torque ratio = reverseThrottle x reverse ratio / 1st ratio
    const fwd = f.io.torqueL + f.io.torqueR;
    expect(fwd).toBeGreaterThan(0);
    expect(-rev / fwd).toBeCloseTo((P.reverseThrottle * ratio(-1)) / ratio(1), 9);
    expect(Math.abs(r.step(-P.reverseSpeedCap, 1, { direction: -1 }).torqueL)).toBe(0);
    expect(Math.abs(r.step(-P.reverseSpeedCap - 1, 1, { direction: -1 }).torqueL)).toBe(0);
    const half = r.step(-P.reverseSpeedCap + 0.5, 1, { direction: -1 });
    expect(half.torqueL + half.torqueR).toBeLessThan(0);
    expect(-(half.torqueL + half.torqueR)).toBeLessThan(-rev);
    // a forward command switches back to 1st through a cut
    expect(r.step(0, 0.5).gear).toBe(1);
    expect(r.io.torqueL).toBe(0);
  });

  it('reflected engine inertia switches with the clutch', () => {
    const r = rig(0);
    r.step(1, 0.5);
    expect(r.io.inertia).toBeCloseTo(IW + (P.engineInertia * ratio(1) ** 2) / 2, 9);
    r.step((P.upshiftRpm[1] + 50) / RPM / ratio(1) * R, 1);
    expect(r.io.gear).toBe(2);
    expect(r.io.inertia).toBe(IW);
  });

  it('traction scale: cuts torque on driven-wheel slip with the aid on, identity with it off', () => {
    const on = rig(0);
    const off = rig(0);
    for (let k = 0; k < 120; k++) {
      on.step(3, 1, { slipSpeed: 4, aids: DEFAULT_AIDS });
      off.step(3, 1, { slipSpeed: 4 });
    }
    expect(on.io.tractionActive).toBe(true);
    expect(off.io.tractionActive).toBe(false);
    expect((on.io.torqueL + on.io.torqueR) / (off.io.torqueL + off.io.torqueR)).toBeCloseTo(0.15, 3);
    for (let k = 0; k < 240; k++) on.step(3, 1, { slipSpeed: 0, aids: DEFAULT_AIDS });
    expect(on.io.tractionActive).toBe(false);
    expect((on.io.torqueL + on.io.torqueR) / (off.io.torqueL + off.io.torqueR)).toBeCloseTo(1, 4);
  });
});

describe('brakes', () => {
  it('pedal x maxTorque x brakeShare / 2 per wheel, handbrake on the rears', () => {
    const out = new Float64Array(4);
    brakeTorques(gtCoupeBrakes, gtCoupe.front.brakeShare, gtCoupe.rear.brakeShare, 1, 0, out);
    expect(gtCoupe.front.brakeShare).toBe(0.62);
    expect(out[0]).toBeCloseTo((7300 * 0.62) / 2, 9);
    expect(out[1]).toBe(out[0]);
    expect(out[2]).toBeCloseTo((7300 * 0.38) / 2, 9);
    expect(out[0]! + out[1]! + out[2]! + out[3]!).toBeCloseTo(gtCoupeBrakes.maxTorque, 9);
    brakeTorques(gtCoupeBrakes, 0.62, 0.38, 0, 1, out);
    expect([...out]).toEqual([0, 0, 750, 750]);
  });
});
