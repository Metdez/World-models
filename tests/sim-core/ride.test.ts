import { describe, expect, it } from 'vitest';
import { G, SIM_DT } from '../../src/contracts/units';
import { createRng } from '../../src/sim-core/math/rng';
import { createRideModel, rollCentreFromCurves, type RideInput } from '../../src/sim-core/ride/ride7dof';
import { GT, cornerSprungMass, rideInput, rideParams, run, syntheticCurves, weight } from '../fixtures/02-03-ride';

const P = rideParams(GT);
const sum = (a: Float64Array) => a.reduce((s, x) => s + x, 0);

describe('ride7dof: static equilibrium', () => {
  it('reset gives the static loads: sum = weight, lever-rule front/rear split, spring = sprung corner weight', () => {
    const m = createRideModel(P);
    m.reset(rideInput());
    const s = m.state;
    expect(sum(s.load) / weight(GT)).toBeCloseTo(1, 12);
    const b = GT.wheelbase - GT.cgToFront;
    const frontExpected = (GT.sprungMass * b) / GT.wheelbase * G + 2 * GT.front.unsprungMass * G;
    expect((s.load[0]! + s.load[1]!) / frontExpected).toBeCloseTo(1, 12);
    expect(s.load[0]).toBeCloseTo(s.load[1]!, 9);
    expect(s.load[2]).toBeCloseTo(s.load[3]!, 9);
    for (let i = 0; i < 4; i++) {
      expect(s.travel[i]).toBeCloseTo(0, 12);
      expect(s.springForce[i]! / (cornerSprungMass(GT, i < 2) * G)).toBeCloseTo(1, 12);
      expect(s.stop[i]).toBe(0);
    }
    expect([s.heave, s.roll, s.pitch]).toEqual([expect.closeTo(0, 12), expect.closeTo(0, 12), expect.closeTo(0, 12)]);
  });

  it('released on a raised road it settles back to static deflection: tyre = load/kt, spring = load/rate (±1 %)', () => {
    const m = createRideModel(P);
    const input = rideInput();
    m.reset(input);
    input.road.fill(0.03); // car dropped 30 mm too low relative to the road
    run(m, input, 6);
    const s = m.state;
    expect(s.heave).toBeCloseTo(0.03, 5);
    for (let i = 0; i < 4; i++) {
      const c = P.corners[i]!;
      const sprung = cornerSprungMass(GT, i < 2) * G;
      const total = sprung + c.unsprungMass * G;
      expect(Math.abs(s.load[i]! / total - 1)).toBeLessThan(0.01);
      // spring deflection from free length = load / wheel rate
      const deflection = sprung / c.wheelRate + s.travel[i]!;
      expect(Math.abs((s.springForce[i]! / c.wheelRate) / deflection - 1)).toBeLessThan(0.01);
      expect(Math.abs(s.travel[i]!)).toBeLessThan(1e-5);
    }
  });

  it('reset under a static road warp equals the dynamically settled state', () => {
    const input = rideInput();
    input.road.set([0.02, 0, -0.01, 0.015]);
    const a = createRideModel(P);
    a.reset(input);
    const b = createRideModel(P);
    b.reset(rideInput());
    run(b, input, 10);
    for (let i = 0; i < 4; i++) {
      expect(a.state.load[i]).toBeCloseTo(b.state.load[i]!, 1);
      expect(a.state.travel[i]).toBeCloseTo(b.state.travel[i]!, 6);
    }
  });
});

describe('ride7dof: limits', () => {
  it('lift-off: a wheel over a deep hole carries zero load (never negative), hits the droop stop, then lands', () => {
    // Without ARB (a stiff bar alone holds a hanging wheel above the droop stop).
    const m = createRideModel({ ...P, arbRate: { front: 0, rear: 0 } });
    const input = rideInput();
    m.reset(input);
    let minLoad = Infinity;
    let airborneSteps = 0;
    let minStop = 0;
    input.road[0] = -0.2; // FL drops into a 200 mm hole
    run(m, input, 0.3, () => {
      minLoad = Math.min(minLoad, ...m.state.load);
      if (m.state.load[0] === 0) airborneSteps++;
      minStop = Math.min(minStop, m.state.stop[0]!);
    });
    expect(minLoad).toBeGreaterThanOrEqual(0);
    expect(airborneSteps).toBeGreaterThan(10);
    expect(minStop).toBeLessThan(0); // droop stop engaged
    input.road[0] = 0;
    run(m, input, 4);
    expect(m.state.load[0]! / (sum(m.state.load) / 4)).toBeGreaterThan(0.8);
  });

  it('lift-off under extreme cornering: inner tyres clamp at 0, total stays the weight', () => {
    // 1.55 g is below the static rollover threshold t/(2h) = 1.66 g; small-angle model, no rollover handling.
    const m = createRideModel({ ...P, arbRate: { front: 3 * P.arbRate.front, rear: P.arbRate.rear } });
    const input = rideInput({ ay: 1.55 * G, rcHeight: { front: 0.25, rear: 0.25 } });
    m.reset(rideInput());
    let minLoad = Infinity;
    run(m, input, 3, () => (minLoad = Math.min(minLoad, ...m.state.load)));
    expect(minLoad).toBe(0);
    expect(m.state.load[0]).toBe(0); // inner front lifts, the rear keeps it on three wheels
    expect(m.state.load[2]).toBeGreaterThan(0);
    expect(sum(m.state.load) / weight(GT)).toBeCloseTo(1, 2);
  });

  it('bump stop engages progressively and keeps the travel bounded', () => {
    const m = createRideModel(P);
    const input = rideInput();
    m.reset(input);
    input.road[1] = 0.15; // 150 mm step under FR
    let maxTravel = 0;
    let maxStop = 0;
    run(m, input, 1, () => {
      maxTravel = Math.max(maxTravel, m.state.travel[1]!);
      maxStop = Math.max(maxStop, m.state.stop[1]!);
    });
    expect(maxStop).toBeGreaterThan(0.5);
    expect(maxTravel).toBeLessThan(P.corners[1].bump + 0.04);
  });

  it('asymmetric damping: bump coefficient while compressing, rebound while extending', () => {
    const m = createRideModel(P);
    const input = rideInput();
    m.reset(input);
    const c = P.corners[0];
    let seenBump = 0;
    let seenRebound = 0;
    let t = 0;
    run(m, input, 2, () => {
      t += SIM_DT;
      input.road[0] = 0.03 * Math.sin(2 * Math.PI * 3 * t);
      input.roadRate[0] = 0.03 * 2 * Math.PI * 3 * Math.cos(2 * Math.PI * 3 * t);
      const r = m.state.travelRate[0]!;
      const f = m.state.damperForce[0]!;
      if (r > 1e-4) {
        expect(f / r).toBeCloseTo(c.damping.bump, 9);
        seenBump++;
      } else if (r < -1e-4) {
        expect(f / r).toBeCloseTo(c.damping.rebound, 9);
        seenRebound++;
      }
    });
    expect(seenBump).toBeGreaterThan(100);
    expect(seenRebound).toBeGreaterThan(100);
    expect(c.damping.rebound / c.damping.bump).toBeCloseTo(0.58 / 0.32, 9);
  });
});

describe('ride7dof: determinism, allocation, cost', () => {
  const drive = (seed: number) => {
    const rng = createRng(seed);
    const m = createRideModel(P);
    const input = rideInput();
    m.reset(input);
    const trace: number[] = [];
    for (let k = 0; k < 2400; k++) {
      for (let i = 0; i < 4; i++) {
        const prev = input.road[i]!;
        input.road[i] = 0.98 * prev + 0.004 * rng.normal();
        input.roadRate[i] = (input.road[i]! - prev) / SIM_DT;
      }
      input.ay = 6 * Math.sin(k * 0.003);
      input.ax = -4 * Math.cos(k * 0.002);
      m.step(SIM_DT, input);
      trace.push(m.state.heave, m.state.roll, m.state.pitch, ...m.state.load, ...m.state.travel);
    }
    return trace;
  };

  it('same inputs give bitwise-identical trajectories', () => {
    const a = drive(7);
    const b = drive(7);
    expect(a.length).toBe(2400 * 11);
    expect(a.every((x, i) => Object.is(x, b[i]))).toBe(true);
    expect(a.every(Number.isFinite)).toBe(true);
  });

  it('steps without allocating; state arrays are identity-stable', () => {
    const m = createRideModel(P);
    const input = rideInput({ ay: 3, ax: -2 });
    m.reset(input);
    const refs = [m.state, m.state.load, m.state.travel, m.state.stop];
    const loop = (n: number) => {
      for (let k = 0; k < n; k++) {
        input.road[k & 3] = 0.001 * Math.sin(k * 0.01);
        m.step(SIM_DT, input);
      }
    };
    loop(200000); // warm-up: JIT/OSR allocations are not per-step
    const gc = (globalThis as { gc?: () => void }).gc;
    expect(gc).toBeTypeOf('function');
    let delta = Infinity; // min of 3 runs: the worker's own background activity also shows up in heapUsed
    for (let r = 0; r < 3; r++) {
      gc!();
      const before = process.memoryUsage().heapUsed;
      loop(200000);
      delta = Math.min(delta, process.memoryUsage().heapUsed - before);
    }
    console.log(`[ride] heap delta over 200000 steps: ${delta} B`);
    expect(delta).toBeLessThan(64 * 1024);
    expect([m.state, m.state.load, m.state.travel, m.state.stop]).toEqual(refs);
    refs.forEach((r, i) => expect(r).toBe([m.state, m.state.load, m.state.travel, m.state.stop][i]));
  });

  it('step cost', () => {
    const m = createRideModel(P);
    const input = rideInput({ ay: 3, ax: -2 });
    m.reset(input);
    for (let k = 0; k < 50000; k++) m.step(SIM_DT, input);
    const n = 200000;
    const t0 = performance.now();
    for (let k = 0; k < n; k++) m.step(SIM_DT, input);
    const us = ((performance.now() - t0) * 1000) / n;
    console.log(`[ride] step cost: ${us.toFixed(3)} µs/step (${(us * 240).toFixed(0)} µs per simulated second)`);
    expect(us).toBeLessThan(50);
  });
});

describe('ride7dof: kinematic curves and helpers', () => {
  it('roll-centre height from per-type curves at mean travel', () => {
    const curves = syntheticCurves(-0.4 / 0.01 * (Math.PI / 180), 0.11);
    expect(rollCentreFromCurves(curves, 0, 0)).toBeCloseTo(0.11, 12);
    expect(rollCentreFromCurves(curves, 0.02, 0)).toBeCloseTo(0.11 - 1.5 * 0.01, 12);
  });

  it('rejects malformed parameters', () => {
    expect(() => createRideModel({ ...P, sprungMass: 0 })).toThrow();
    const swapped = [P.corners[2], P.corners[3], P.corners[0], P.corners[1]] as const;
    expect(() => createRideModel({ ...P, corners: swapped })).toThrow();
  });
});

export type { RideInput };
