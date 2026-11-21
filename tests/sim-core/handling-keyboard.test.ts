/**
 * Drivability on a digital throttle/steer (09-04; MD-22, research m2/06 §5, m2/07): the whole Manual chain (control
 * latch -> HumanDriver ramps, steering limit and countersteer help -> aids -> plant) driven by a scripted "clumsy
 * keyboard" driver. With the aids on it stays controllable: full throttle from rest, full-lock stabs at speed, a panic
 * brake mid-corner. With the aids off power oversteer is expected and only reported.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_AIDS, type DriveAids } from '../../src/contracts/drive';
import type { Simulation } from '../../src/contracts/sim';
import type { TelemetryFrame } from '../../src/contracts/telemetry';
import { SIM_DT } from '../../src/contracts/units';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { intent, makeSim, manualAtRest, steps } from '../fixtures/08-02-drive';

const OFF: DriveAids = { abs: false, traction: false, stability: false, steering: false };
const deg = (r: number): number => (r * 180) / Math.PI;
const key = (o: { steer?: number; throttle?: number; brake?: number }) => intent({ ...o, digital: true, source: 'keyboard' });

/** Analog line keeper (test driver) to bring the car to a state before the clumsy inputs. */
function keepLine(f: TelemetryFrame, kappa = 0): number {
  const e = Number.isFinite(f.drive.lineOffset) ? f.drive.lineOffset : 0;
  const he = Number.isFinite(f.drive.headingError) ? f.drive.headingError : 0;
  return Math.max(-1, Math.min(1, (Math.atan(gtCoupe.wheelbase * kappa) - 0.08 * e - 0.8 * he) / gtCoupe.maxSteer));
}
function upTo(sim: Simulation, u: number, kappa = 0): void {
  const d = sim.drive!;
  for (let k = 0; k < steps(30); k++) {
    const f = sim.sample(1);
    if (f.drive.u >= u) return;
    d.setIntent(intent({ throttle: Math.max(0, Math.min(1, 0.4 * (u + 0.5 - f.drive.u))), steer: keepLine(f, kappa) }));
    sim.step(SIM_DT);
  }
}
/** Runs `n` steps of the given intent schedule; returns max |beta| (rad), max |yaw rate|, whether a spin happened. */
function watch(sim: Simulation, seconds: number, schedule: (t: number, f: TelemetryFrame) => ReturnType<typeof intent>) {
  const d = sim.drive!;
  let beta = 0;
  let r = 0;
  let abs = false;
  let tcs = false;
  let esc = false;
  for (let k = 0; k < steps(seconds); k++) {
    const f = sim.sample(1);
    d.setIntent(schedule(k * SIM_DT, f));
    sim.step(SIM_DT);
    const g = sim.sample(1);
    // the CG of a slow car on full lock has a large kinematic sideslip (b tan(delta) / L): count slides above 8 m/s
    if (g.speed > 8) beta = Math.max(beta, Math.abs(g.drive.beta));
    r = Math.max(r, Math.abs(g.yawRate));
    abs ||= g.drive.absActive;
    tcs ||= g.drive.tractionActive;
    esc ||= g.drive.stabilityActive;
  }
  return { beta, r, abs, tcs, esc, spin: beta > (30 * Math.PI) / 180, final: sim.sample(1) };
}

describe('clumsy keyboard driver (aids on: controllable; aids off: reported)', () => {
  it('full throttle from rest, steering untouched', () => {
    const out: string[] = [];
    for (const aids of [DEFAULT_AIDS, OFF]) {
      const sim = makeSim('test-strip', 'double-wishbone', 0);
      sim.drive!.setAids(aids);
      manualAtRest(sim);
      const w = watch(sim, 5, () => key({ throttle: 1 }));
      out.push(`aids ${aids.traction ? 'on' : 'off'}: ${w.final.drive.u.toFixed(1)} m/s after 5 s, max |beta| ${deg(w.beta).toFixed(1)} deg, traction lamp ${w.tcs}, spin ${w.spin}`);
      if (aids.traction) {
        expect(w.spin).toBe(false);
        expect(w.beta).toBeLessThan((3 * Math.PI) / 180);
        expect(w.tcs).toBe(true);
        expect(w.final.drive.u).toBeGreaterThan(20);
      }
    }
    console.log(`[keyboard] full throttle from rest: ${out.join('; ')}`);
  }, 60_000);

  it('full-lock stabs at 25 m/s (left, right, left, right), then hands off', () => {
    const out: string[] = [];
    for (const aids of [DEFAULT_AIDS, OFF]) {
      const sim = makeSim('test-strip', 'multilink', 0);
      sim.drive!.setAids(aids);
      manualAtRest(sim);
      upTo(sim, 25);
      const w = watch(sim, 4, (t) => {
        const phase = Math.floor(t / 0.45);
        const on = t % 0.45 < 0.25 && phase < 4;
        return key({ steer: on ? (phase % 2 === 0 ? 1 : -1) : 0, throttle: 0.4 });
      });
      out.push(`aids ${aids.steering ? 'on' : 'off'}: max |beta| ${deg(w.beta).toFixed(1)} deg, max |r| ${w.r.toFixed(2)} rad/s, |r| at the end ${Math.abs(w.final.yawRate).toFixed(3)} rad/s, stability lamp ${w.esc}, spin ${w.spin}`);
      if (aids.steering) {
        expect(w.spin).toBe(false);
        expect(w.beta).toBeLessThan((8 * Math.PI) / 180);
        expect(Math.abs(w.final.yawRate)).toBeLessThan(0.1);
      }
    }
    console.log(`[keyboard] full-lock stabs: ${out.join('; ')}`);
  }, 60_000);

  it('panic brake mid-corner (R 60 m skidpad at ~0.8 g), steering held', () => {
    const out: string[] = [];
    for (const aids of [DEFAULT_AIDS, OFF]) {
      const sim = makeSim('test-skidpad', 'macpherson', 0);
      sim.drive!.setAids(aids);
      manualAtRest(sim);
      upTo(sim, 21.5, 1 / 60);
      for (let k = 0; k < steps(3); k++) {
        const f = sim.sample(1);
        sim.drive!.setIntent(intent({ throttle: Math.max(0, Math.min(1, 0.4 * (21.5 - f.drive.u) + 0.2)), steer: keepLine(f, 1 / 60) }));
        sim.step(SIM_DT);
      }
      const ay0 = sim.sample(1).ay;
      let steer = 0;
      const w = watch(sim, 4, (t, f) => {
        if (t === 0) steer = keepLine(f, 1 / 60);
        return key({ brake: 1, steer: Math.sign(steer) * 1 });
      });
      out.push(`aids ${aids.abs ? 'on' : 'off'} (from ${(ay0 / 9.81).toFixed(2)} g): max |beta| ${deg(w.beta).toFixed(1)} deg, speed at the end ${w.final.drive.u.toFixed(1)} m/s, ABS lamp ${w.abs}, stability lamp ${w.esc}, spin ${w.spin}`);
      if (aids.abs) {
        expect(w.spin).toBe(false);
        expect(w.beta).toBeLessThan((10 * Math.PI) / 180);
        expect(w.abs).toBe(true);
        expect(w.final.drive.u).toBeLessThan(1);
      }
    }
    console.log(`[keyboard] panic brake mid-corner: ${out.join('; ')}`);
  }, 60_000);
});
