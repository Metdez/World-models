/** Free-response checks: ride / hop / roll frequencies, damping ratios, energy, stiff-configuration stability. */
import { describe, expect, it } from 'vitest';
import { G, SIM_DT } from '../../src/contracts/units';
import { createRideModel, type RideParams, type RideState } from '../../src/sim-core/ride/ride7dof';
import { GT, energy, hubHeight, rideInput, rideParams, run, type AxleSpec, type CarSpec } from '../fixtures/02-03-ride';

/** Times and values of local extrema of a sampled signal. */
function extrema(ts: number[], xs: number[]): { t: number; x: number }[] {
  const out: { t: number; x: number }[] = [];
  for (let k = 1; k < xs.length - 1; k++) {
    const a = xs[k - 1]!;
    const b = xs[k]!;
    const c = xs[k + 1]!;
    if ((b > a && b >= c) || (b < a && b <= c)) out.push({ t: ts[k]!, x: b });
  }
  return out;
}

/** Undamped natural frequency and damping ratio from the first two half-cycles after `from`. */
function fit(ex: { t: number; x: number }[]): { f: number; zeta: number } {
  const [a, b, c] = ex;
  const halfPeriod = (c!.t - a!.t) / 2;
  const dh = Math.log(Math.abs(a!.x / b!.x)) / 2 + Math.log(Math.abs(b!.x / c!.x)) / 2; // half-cycle decrement
  const zeta = dh / Math.sqrt(Math.PI ** 2 + dh ** 2);
  return { f: 1 / (2 * halfPeriod) / Math.sqrt(1 - zeta ** 2), zeta };
}

function record(p: RideParams, seconds: number, setup: (input: ReturnType<typeof rideInput>) => void, probe: (s: RideState) => number) {
  const m = createRideModel(p);
  const input = rideInput();
  m.reset(input);
  setup(input);
  const ts: number[] = [];
  const xs: number[] = [];
  run(m, input, seconds, (t) => {
    ts.push(t);
    xs.push(probe(m.state));
  });
  return { ts, xs, m, input };
}

const symmetric = (a: AxleSpec, zeta: number): AxleSpec => ({ ...a, damping: { bump: zeta, rebound: zeta }, friction: 0, antiRollStiffness: 0 });

describe('ride7dof: modes', () => {
  // Dynamic index 1 (Iyy = ms*a*b) decouples the front and rear ends, so each axle shows its own ride frequency.
  const a = GT.cgToFront;
  const b = GT.wheelbase - GT.cgToFront;
  const flat = (zeta: number): CarSpec => ({ ...GT, inertiaPitch: GT.sprungMass * a * b, front: symmetric(GT.front, zeta), rear: symmetric(GT.rear, zeta) });

  it('ride frequency and damping ratio per axle from the free response (decoupled ends)', () => {
    const zeta = 0.25;
    const p = rideParams(flat(zeta));
    const lines: string[] = [];
    for (const front of [true, false]) {
      const x = front ? p.corners[0].x : p.corners[2].x;
      const r = record(
        p,
        3,
        (input) => input.road.set(front ? [0.02, 0.02, 0, 0] : [0, 0, 0.02, 0.02]),
        (s) => s.heave - x * s.pitch - 0.02,
      );
      const ex = extrema(r.ts, r.xs).filter((e) => e.t > 0.15);
      const m = fit(ex);
      const target = front ? GT.front.rideFrequency : GT.rear.rideFrequency;
      // ζ is configured at the wheel (c = 2ζ·sqrt(k·m)); the tyre in series shortens the damper stroke, so the body
      // mode sees ζ·r^1.5 with r = kt/(k + kt).
      const c = p.corners[front ? 0 : 2];
      const ratio = c.tyreRate / (c.wheelRate + c.tyreRate);
      const zetaBody = zeta * ratio ** 1.5;
      lines.push(`${front ? 'front' : 'rear'} ${m.f.toFixed(3)} Hz (target ${target}) ζ ${m.zeta.toFixed(3)} (wheel ${zeta}, predicted body ${zetaBody.toFixed(3)})`);
      expect(Math.abs(m.f / target - 1)).toBeLessThan(0.03);
      expect(Math.abs(m.zeta - zetaBody)).toBeLessThan(0.015);
      expect(m.f).toBeGreaterThan(1.2);
      expect(m.f).toBeLessThan(1.8);
    }
    console.log(`[ride] decoupled ride modes: ${lines.join('; ')}`);
  });

  it('GT fixture (asymmetric damping, coupled ends): body modes 1.2–1.8 Hz, hop 10–15 Hz from the impulse response', () => {
    const p = rideParams(GT);
    // Heave/pitch: front road step.
    const front = record(p, 3, (input) => input.road.set([0.02, 0.02, 0, 0]), (s) => s.heave - p.corners[0].x * s.pitch - 0.02);
    const fm = fit(extrema(front.ts, front.xs).filter((e) => e.t > 0.15));
    // Roll: released from a steady 4 m/s² corner.
    const rr = (() => {
      const m = createRideModel(p);
      const input = rideInput({ ay: 4 });
      m.reset(input);
      input.ay = 0;
      const ts: number[] = [];
      const xs: number[] = [];
      run(m, input, 2, (t) => {
        ts.push(t);
        xs.push(m.state.roll);
      });
      return fit(extrema(ts, xs));
    })();
    // Hop: 10 mm road impulse (one step) under FL; wheel travel shows the hop mode.
    const hop = (() => {
      const m = createRideModel(p);
      const input = rideInput();
      m.reset(input);
      input.road[0] = 0.01;
      input.roadRate[0] = 0.01 / SIM_DT;
      m.step(SIM_DT, input);
      input.road[0] = 0;
      input.roadRate[0] = 0;
      const ts: number[] = [];
      const xs: number[] = [];
      run(m, input, 0.3, (t) => {
        ts.push(t);
        xs.push(hubHeight(p, m.state, 0));
      });
      // Hub damping is high here (rebound-biased), so use the first half-cycle only: peak -> trough.
      const [a, b] = extrema(ts, xs);
      const dh = Math.log(Math.abs(a!.x / b!.x));
      const zeta = dh / Math.sqrt(Math.PI ** 2 + dh ** 2);
      return { f: 1 / (2 * (b!.t - a!.t)) / Math.sqrt(1 - zeta ** 2), zeta };
    })();
    const c = p.corners[0];
    const hopAnalytic = Math.sqrt((c.tyreRate + c.wheelRate + p.arbRate.front) / c.unsprungMass) / (2 * Math.PI);
    console.log(
      `[ride] GT fixture: front-end body mode ${fm.f.toFixed(3)} Hz ζ ${fm.zeta.toFixed(3)} (bump 0.32 / rebound 0.58); ` +
        `roll mode ${rr.f.toFixed(3)} Hz ζ ${rr.zeta.toFixed(3)}; hop ${hop.f.toFixed(2)} Hz ζ ${hop.zeta.toFixed(3)} (impulse response, damping-corrected; analytic ${hopAnalytic.toFixed(2)} Hz)`,
    );
    expect(fm.f).toBeGreaterThan(1.2);
    expect(fm.f).toBeLessThan(1.8);
    expect(hop.f).toBeGreaterThan(10);
    expect(hop.f).toBeLessThan(15);
    expect(Math.abs(hop.f / hopAnalytic - 1)).toBeLessThan(0.05);
    expect(rr.f).toBeGreaterThan(1);
  });
});

describe('ride7dof: energy and stability', () => {
  const undamped = (car: CarSpec): RideParams => {
    const p = rideParams(car);
    const corners = p.corners.map((c) => ({ ...c, damping: { bump: 0, rebound: 0 }, friction: 0, tyreDamping: 0 })) as unknown as RideParams['corners'];
    return { ...p, corners };
  };

  it('undamped: energy is conserved (bounded, no growth) over 60 s', () => {
    const p = undamped(GT);
    const m = createRideModel(p);
    const input = rideInput({ ay: 3, ax: -2 });
    m.reset(input); // released from a cornering + braking steady state
    input.ay = 0;
    input.ax = 0;
    const e: number[] = [];
    run(m, input, 60, () => e.push(energy(p, m.state, input)));
    const e0 = e[0]!;
    const maxDev = Math.max(...e.map((x) => Math.abs(x / e0 - 1)));
    const avg = (from: number, to: number) => e.slice(from, to).reduce((s, x) => s + x, 0) / (to - from);
    const early = avg(0, 2400);
    const late = avg(e.length - 2400, e.length);
    console.log(`[ride] undamped 60 s: max |E/E0 - 1| ${maxDev.toFixed(4)}, late/early mean energy ${(late / early).toFixed(5)}`);
    expect(maxDev).toBeLessThan(0.05);
    expect(late / early).toBeLessThan(1.01);
    expect(late / early).toBeGreaterThan(0.99);
  });

  it('damped: energy never grows without input and decays to rest', () => {
    const p = rideParams(GT);
    const m = createRideModel(p);
    const input = rideInput({ ay: 4, ax: -3 });
    m.reset(input);
    input.ay = 0;
    input.ax = 0;
    const e0 = energy(p, m.state, input);
    let maxE = e0;
    let prev = e0;
    let maxRise = 0;
    run(m, input, 10, () => {
      const e = energy(p, m.state, input);
      maxE = Math.max(maxE, e);
      maxRise = Math.max(maxRise, (e - prev) / e0);
      prev = e;
    });
    console.log(`[ride] damped release: max E/E0 ${(maxE / e0).toFixed(6)}, largest single-step rise ${maxRise.toExponential(2)} E0, final ${(prev / e0).toExponential(2)} E0`);
    expect(maxE / e0).toBeLessThan(1.001);
    expect(prev / e0).toBeLessThan(1e-6);
  });

  // Stiffest plausible configuration: 2.5 Hz ride, 400 kN/m tyres, 25 kg hubs, very stiff ARB, high friction, short stops.
  const stiffAxle = (a: AxleSpec): AxleSpec => ({ ...a, rideFrequency: 2.5, tyreRate: 400e3, unsprungMass: 25, antiRollStiffness: 400e3, friction: 300, stops: 0.03 });
  const STIFF: CarSpec = { ...GT, front: stiffAxle(GT.front), rear: stiffAxle(GT.rear) };

  it('stiffest configuration stays stable under harsh input and settles', () => {
    const p = rideParams(STIFF);
    const m = createRideModel(p);
    const input = rideInput();
    m.reset(input);
    let maxAbs = 0;
    run(m, input, 6, (t) => {
      const k = Math.floor(t / 0.25);
      for (let i = 0; i < 4; i++) {
        const prev = input.road[i]!;
        input.road[i] = (k + i) % 3 === 0 ? 0.06 : (k + i) % 3 === 1 ? -0.06 : 0;
        input.roadRate[i] = (input.road[i]! - prev) / SIM_DT;
      }
      input.ay = (k % 2 ? 1 : -1) * 1.2 * G;
      input.ax = (k % 3 ? -1 : 0.5) * G;
      for (let i = 0; i < 4; i++) maxAbs = Math.max(maxAbs, Math.abs(m.state.travel[i]!));
      expect(Number.isFinite(m.state.heave + m.state.roll + m.state.pitch)).toBe(true);
    });
    input.road.fill(0);
    input.roadRate.fill(0);
    input.ay = 0;
    input.ax = 0;
    run(m, input, 5);
    expect(maxAbs).toBeLessThan(0.15);
    expect(Math.abs(m.state.heave)).toBeLessThan(1e-4);
    for (let i = 0; i < 4; i++) expect(Math.abs(m.state.travel[i]!)).toBeLessThan(2e-3); // Coulomb friction holds a small offset
  });

  it('stiffness margin: scale the stiff tyre rate until the model no longer settles at SIM_DT', () => {
    // Unstable explicit stiffness shows as chatter (the lift-off clamp bounds it), so "unstable" = not at rest after 3 s.
    const diverges = (scale: number) => {
      const car: CarSpec = { ...STIFF, front: { ...STIFF.front, tyreRate: STIFF.front.tyreRate * scale }, rear: { ...STIFF.rear, tyreRate: STIFF.rear.tyreRate * scale } };
      const m = createRideModel(rideParams(car));
      const input = rideInput();
      m.reset(input);
      input.road[0] = 0.002;
      try {
        run(m, input, 3);
      } catch {
        return true;
      }
      const s = m.state;
      return !(Math.abs(s.travelRate[0]!) < 1e-4 && Math.abs(s.heaveRate) < 1e-4 && s.load.every((x) => x > 0));
    };
    let lo = 1;
    let hi = 1;
    while (!diverges(hi)) {
      lo = hi;
      hi *= 2;
    }
    for (let k = 0; k < 12; k++) {
      const mid = Math.sqrt(lo * hi);
      if (diverges(mid)) hi = mid;
      else lo = mid;
    }
    const p = rideParams(STIFF);
    const c = p.corners[0];
    const omega = Math.sqrt((c.tyreRate + c.wheelRate + 2 * p.arbRate.front) / c.unsprungMass);
    console.log(
      `[ride] stiffest config: hub ω·dt ≈ ${(omega * SIM_DT).toFixed(3)} (undamped explicit limit 2 → ${(2 / (omega * SIM_DT)).toFixed(2)}x frequency margin); ` +
        `measured: tyre rate can be scaled ${lo.toFixed(2)}x (${((STIFF.front.tyreRate * lo) / 1e3).toFixed(0)} kN/m) before it stops settling`,
    );
    expect(lo).toBeGreaterThan(4);
  });
});
