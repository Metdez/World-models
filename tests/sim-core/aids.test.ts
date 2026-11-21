/** Driver aids with fake io (ARCHITECTURE-M2 §7.8; ROADMAP-M2 09-02): ABS, traction curve, stability, steering helpers. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_AIDS, type DriveAids } from '../../src/contracts/drive';
import { G, SIM_DT } from '../../src/contracts/units';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { gtCoupeBrakes } from '../../src/sim-core/content/gt-coupe-powertrain';
import { assistedSteer, countersteerHelp, createAids, createAidsIo, peakSlipRatio, steeringLimit, tractionTarget } from '../../src/sim-core/drive/aids';
import { slipCurve } from '../../src/sim-core/drive/tyre';
import { brakeTorques } from '../../src/sim-core/drive/powertrain';
import type { PlantView } from '../../src/sim-core/drive/types';

const OFF: DriveAids = { abs: false, traction: false, stability: false, steering: false };
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
const make = () => createAids(gtCoupe, gtCoupe.front.track, gtCoupe.rear.track);

/**
 * One braked corner: quarter-car mass, a wheel with spin and the plant's longitudinal deflection lag (kappa = ux /
 * sigma), a saturating tyre (the 09-01 unit-slope curve with the content's shape/curvature, falls past its peak). The wheel
 * is sub-stepped (stiff); the aids run at SIM_DT on the previous step's slip ratio, as in the plant.
 */
function stop(axle: 'front' | 'rear', aids: DriveAids) {
  const spec = gtCoupe[axle];
  const h = gtCoupe.handling!.tyres[axle];
  const i = axle === 'front' ? 0 : 2;
  const load = axle === 'front' ? 4600 : 2600; // N: front static-ish (dry, light transfer), rear under braking
  const m = gtCoupe.mass / 4;
  const D = spec.tyre.mu * load;
  const ck = h.slipStiffness * load;
  const sigma = h.relaxationLongitudinal;
  const Rw = spec.tyre.radius;
  const I = h.wheelInertia;
  const fx = (kappa: number) => Math.sign(kappa) * D * slipCurve((ck * Math.abs(kappa)) / D, h.shape, h.curvature);
  const a = make();
  const io = createAidsIo();
  const full = new Float64Array(4);
  brakeTorques(gtCoupeBrakes, gtCoupe.front.brakeShare, gtCoupe.rear.brakeShare, 1, 0, full);
  let v = 25;
  let w = v / Rw;
  let ux = 0;
  let kMin = 0;
  let dist = 0;
  let absSeen = false;
  const sub = 20;
  const h2 = SIM_DT / sub;
  while (v > 1) {
    io.brakeTorque.set(full);
    io.slipRatio.fill(0);
    io.slipRatio[i] = ux / sigma;
    io.u = v;
    a.step(SIM_DT, io, aids, view({ u: v }));
    absSeen ||= io.absActive;
    const tb = io.brakeTorque[i]!;
    for (let k = 0; k < sub; k++) {
      ux = (ux + h2 * (Rw * w - v)) / (1 + (h2 * v) / sigma);
      const f = fx(ux / sigma);
      w += (h2 * -Rw * f) / I;
      w = Math.max(0, w - (h2 * tb) / I);
      v += (h2 * f) / m;
      dist += h2 * v;
    }
    if (v > 3) kMin = Math.min(kMin, ux / sigma);
  }
  return { kMin, dist, absSeen, peak: peakSlipRatio(spec.tyre, h) };
}

describe('ABS', () => {
  it.each(['front', 'rear'] as const)('%s wheel with a saturating tyre: kappa stays >= -0.2 with ABS; locks without', (axle) => {
    const on = stop(axle, { ...OFF, abs: true });
    const off = stop(axle, OFF);
    console.log(
      `[aids] ABS ${axle}: min kappa ${on.kMin.toFixed(3)} (target ${(-0.65 * on.peak).toFixed(3)}, tyre peak ${on.peak.toFixed(3)}), 25->1 m/s ${on.dist.toFixed(1)} m; ` +
        `off: min kappa ${off.kMin.toFixed(3)}, ${off.dist.toFixed(1)} m`,
    );
    expect(on.absSeen).toBe(true);
    expect(on.kMin).toBeGreaterThanOrEqual(-0.2);
    expect(off.kMin).toBeLessThan(-0.9);
    expect(on.dist).toBeLessThan(off.dist);
  });

  it('pressure drops while slipping, recovers after; no ABS on the rears with the handbrake pulled', () => {
    const a = make();
    const io = createAidsIo();
    const run = (slip: number, handbrake: number) => {
      io.brakeTorque.fill(1000);
      io.slipRatio.fill(slip);
      io.handbrake = handbrake;
      io.u = 20;
      a.step(SIM_DT, io, { ...OFF, abs: true }, view({ u: 20 }));
    };
    run(-0.3, 0);
    expect(io.absActive).toBe(true);
    expect(io.brakeTorque[0]).toBeCloseTo(1000 * (1 - SIM_DT / 0.02), 9); // fastest release
    for (let k = 0; k < 24; k++) run(-0.3, 0);
    expect(io.brakeTorque[0]).toBeCloseTo(100, 9); // floor 0.1
    run(-0.105, 0); // slip rate now positive (recovering): the lead re-applies early
    expect(io.brakeTorque[0]).toBeGreaterThan(100);
    for (let k = 0; k < 120; k++) run(-0.05, 0);
    expect(io.absActive).toBe(false);
    expect(io.brakeTorque[0]).toBe(1000);
    for (let k = 0; k < 24; k++) run(-0.3, 1);
    expect(io.brakeTorque[0]).toBeLessThan(1000);
    expect(io.brakeTorque[2]).toBe(1000);
    expect(io.brakeTorque[3]).toBe(1000);
  });
});

describe('traction curve', () => {
  it('scale 1 below the threshold, linear to the 0.15 floor, threshold tracks the tyre peak slip', () => {
    const kp = peakSlipRatio(gtCoupe.rear.tyre, gtCoupe.handling!.tyres.rear);
    expect(kp).toBeGreaterThan(0.12);
    expect(kp).toBeLessThan(0.2);
    for (const u of [0, 10, 30]) {
      const on = 0.3 + 0.5 * kp * u;
      const range = 0.6 + 0.5 * kp * u;
      expect(tractionTarget(0, u, kp)).toBe(1);
      expect(tractionTarget(on, u, kp)).toBe(1);
      expect(tractionTarget(on + range / 2, u, kp)).toBeCloseTo(0.5, 12);
      expect(tractionTarget(on + range * 0.85, u, kp)).toBeCloseTo(0.15, 12);
      expect(tractionTarget(50, u, kp)).toBe(0.15);
      expect(tractionTarget(on + range / 2, -u, kp)).toBeCloseTo(0.5, 12);
      for (let s = 0; s < 5; s += 0.05) expect(tractionTarget(s + 0.05, u, kp)).toBeLessThanOrEqual(tractionTarget(s, u, kp));
    }
    // a softer tyre (smaller peak slip) cuts earlier
    expect(tractionTarget(3, 20, kp / 2)).toBeLessThan(tractionTarget(3, 20, kp));
    const at = (u: number) => `${((0.3 + 0.5 * kp * u) / u).toFixed(3)}..${((0.81 + 0.925 * kp * u) / u).toFixed(3)}`;
    console.log(`[aids] rear peak slip ratio ${kp.toFixed(3)}; TCS cut over slip ratio ${at(10)} at 10 m/s, ${at(30)} at 30 m/s`);
  });
});

describe('stability', () => {
  const L = gtCoupe.wheelbase;
  /** steer giving the target yaw rate rt at speed u (below the cap). */
  const steerFor = (rt: number, u: number) => (rt * (L + 0.0018 * u * u)) / u;
  function run(o: { u: number; r: number; rt: number; beta?: number }, aids: DriveAids = DEFAULT_AIDS) {
    const a = make();
    const io = createAidsIo();
    io.brakeTorque.fill(0);
    io.u = o.u;
    io.r = o.r;
    io.beta = o.beta ?? 0;
    io.steerAct = steerFor(o.rt, o.u);
    a.step(SIM_DT, io, aids, view({ u: o.u, r: o.r }));
    return io;
  }

  it('oversteer brakes the outer front wheel, understeer the inner rear; mirrored left/right', () => {
    const cases = [
      { name: 'oversteer left', o: { u: 20, r: 0.6, rt: 0.3 }, wheel: 1 },
      { name: 'oversteer right', o: { u: 20, r: -0.6, rt: -0.3 }, wheel: 0 },
      { name: 'understeer left', o: { u: 20, r: 0.1, rt: 0.4 }, wheel: 2 },
      { name: 'understeer right', o: { u: 20, r: -0.1, rt: -0.4 }, wheel: 3 },
      { name: 'spinning against the steer', o: { u: 20, r: 0.4, rt: -0.1 }, wheel: 1 },
    ];
    const torques: number[] = [];
    for (const c of cases) {
      const io = run(c.o);
      expect(io.stabilityActive, c.name).toBe(true);
      expect(io.throttleScale).toBe(0.5);
      for (let k = 0; k < 4; k++) {
        if (k === c.wheel) expect(io.brakeTorque[k], c.name).toBeGreaterThan(0);
        else expect(io.brakeTorque[k], c.name).toBe(0);
      }
      expect(io.brakeTorque[c.wheel]).toBeLessThanOrEqual(1500);
      torques.push(io.brakeTorque[c.wheel]!);
    }
    expect(torques[0]).toBeCloseTo(torques[1]!, 9);
    expect(torques[2]).toBeCloseTo(torques[3]!, 9);
    // T = 4 Iz (|e| - 0.08) R / (t/2), oversteer at the front
    expect(torques[0]).toBeCloseTo(Math.min(1500, (4 * gtCoupe.inertia.yaw * 0.22 * gtCoupe.front.tyre.radius) / (gtCoupe.front.track / 2)), 6);
    console.log(`[aids] stability: oversteer e 0.3 rad/s -> ${torques[0]!.toFixed(0)} N m outer front; understeer -> ${torques[2]!.toFixed(0)} N m inner rear`);
  });

  it('sideslip against the yaw rate triggers the throttle cut without extra braking; slow or tracking: inactive', () => {
    const slide = run({ u: 15, r: 0.2, rt: 0.2, beta: -0.15 });
    expect(slide.stabilityActive).toBe(true);
    expect(slide.throttleScale).toBe(0.5);
    expect([...slide.brakeTorque]).toEqual([0, 0, 0, 0]);
    expect(run({ u: 4, r: 1, rt: 0 }).stabilityActive).toBe(false);
    const ok = run({ u: 20, r: 0.3, rt: 0.3 });
    expect(ok.stabilityActive).toBe(false);
    expect(ok.throttleScale).toBe(1);
  });

  it('the flag holds 0.25 s after the last trigger (no throttle chatter)', () => {
    const a = make();
    const io = createAidsIo();
    const step = (r: number) => {
      io.brakeTorque.fill(0);
      io.u = 20;
      io.r = r;
      io.steerAct = steerFor(0.3, 20);
      a.step(SIM_DT, io, DEFAULT_AIDS, view({ u: 20 }));
    };
    step(0.6);
    let t = 0;
    do {
      step(0.3);
      t += SIM_DT;
    } while (io.stabilityActive && t < 1);
    expect(t).toBeGreaterThan(0.25 - 2 * SIM_DT);
    expect(t).toBeLessThan(0.25 + 2 * SIM_DT);
  });
});

describe('aids off', () => {
  it('identity on brake torques, throttle scale 1, no flags', () => {
    const a = make();
    const io = createAidsIo();
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let k = 0; k < 2000; k++) {
      const bt = [0, 1, 2, 3].map(() => Math.abs(rnd()) * 3000);
      io.brakeTorque.set(bt);
      for (let w = 0; w < 4; w++) io.slipRatio[w] = rnd();
      io.u = rnd() * 40;
      io.r = rnd();
      io.beta = rnd() * 0.5;
      io.steerAct = rnd() * 0.5;
      io.handbrake = Math.abs(rnd());
      a.step(SIM_DT, io, OFF, view({ u: io.u, r: io.r, beta: io.beta }));
      expect([...io.brakeTorque]).toEqual(bt);
      expect(io.throttleScale).toBe(1);
      expect(io.absActive).toBe(false);
      expect(io.stabilityActive).toBe(false);
    }
  });
});

describe('steering helpers (aids.steering)', () => {
  it('speed-dependent cap near the grip limit, full lock when countersteering, countersteer help into the slide', () => {
    const v = view({ u: 100 / 3.6 });
    const lim = steeringLimit(v);
    expect(lim).toBeCloseTo(Math.atan((v.wheelbase * v.lateralLimit) / v.u ** 2) + 0.12, 12);
    expect(steeringLimit(view({ u: 0 }))).toBe(gtCoupe.maxSteer);
    expect(assistedSteer(1, v, true)).toBeCloseTo(lim, 12);
    expect(assistedSteer(1, v, false)).toBe(gtCoupe.maxSteer);
    // oversteer slide to the left (r > 0, beta < 0): steering right is countersteer -> full lock allowed
    const slide = view({ u: 20, r: 0.5, beta: -0.2 });
    expect(assistedSteer(-1, slide, true)).toBe(-gtCoupe.maxSteer);
    // hands off: the help steers into the slide (right), 0.6 beta
    expect(countersteerHelp(0, slide)).toBeCloseTo(0.6 * -0.2, 12);
    expect(assistedSteer(0, slide, true)).toBeLessThan(0);
    expect(Math.abs(assistedSteer(0, slide, false))).toBe(0);
    // mirrored
    expect(assistedSteer(0, view({ u: 20, r: -0.5, beta: 0.2 }), true)).toBeCloseTo(-assistedSteer(0, slide, true), 12);
    // fades out below 5 m/s and in reverse
    expect(Math.abs(countersteerHelp(0, view({ u: 4, beta: -0.2 })))).toBe(0);
    expect(Math.abs(countersteerHelp(0, view({ u: -6, beta: -0.2 })))).toBe(0);
    expect(Math.abs(countersteerHelp(1, slide))).toBe(0);
  });
});
