/**
 * Manual plant v0 on the loop (ARCHITECTURE-M2 §7.2, §7.10, ROADMAP-M2 08-02): scripted drive, launch, 0-100 km/h,
 * 100-0 km/h, constant-radius lateral grip, fuzz, release/reset sequencing, suspension swap, the Auto frame fields,
 * no allocation and the step cost. Measured values are printed ([plant] lines) for the SUMMARY.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_AIDS, type DriveEvent } from '../../src/contracts/drive';
import type { Simulation } from '../../src/contracts/sim';
import type { TelemetryFrame } from '../../src/contracts/telemetry';
import { G, SIM_DT } from '../../src/contracts/units';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { runDriveScript } from '../../src/sim-core/index';
import { createRng } from '../../src/sim-core/math/rng';
import { finiteFrame, intent, makeSim, manualAtRest, steps, SUSPENSION_IDS } from '../fixtures/08-02-drive';

const events = (sim: Simulation): DriveEvent[] => {
  const out: DriveEvent[] = [];
  sim.drive!.drainEvents((e) => out.push(e));
  return out;
};

/** Test-only line keeper: steer from the offset to the driving line and the heading error (analog source). */
function keepLine(f: TelemetryFrame, kappa = 0): number {
  const e = Number.isFinite(f.drive.lineOffset) ? f.drive.lineOffset : 0;
  const he = Number.isFinite(f.drive.headingError) ? f.drive.headingError : 0;
  const delta = Math.atan(gtCoupe.wheelbase * kappa) - 0.08 * e - 0.8 * he;
  return Math.max(-1, Math.min(1, delta / gtCoupe.maxSteer));
}

describe('Manual plant v0', () => {
  it('scripted 60 s drive (runDriveScript): finite, deterministic, no faults', () => {
    const sim = makeSim();
    const a = runDriveScript(sim, 7, 60);
    const f = sim.sample(1);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(finiteFrame(f)).toBe(true);
    expect(f.drive.faults).toBe(0);
    expect(runDriveScript(makeSim(), 7, 60)).toBe(a);
    expect(runDriveScript(makeSim(), 8, 60)).not.toBe(a);
    console.log(`[plant] runDriveScript(seed 7, 60 s) = ${a}; final speed ${f.speed.toFixed(1)} m/s, zone ${f.drive.zone}`);
  });

  // ROADMAP-M2 asks for 15-35 m/s; a car meeting T15 (0-100 km/h in <= 4.8 s) is past 40 m/s after 10 s, so the upper
  // bound is 50 m/s here (deviation reported in the 08-02 SUMMARY).
  it('full throttle 10 s from rest on the loop: 15-50 m/s, gears go up', () => {
    const sim = makeSim();
    manualAtRest(sim);
    sim.drive!.setIntent(intent({ throttle: 1, digital: true, source: 'keyboard' }));
    const gears = new Set<number>();
    for (let k = 0; k < steps(10); k++) {
      sim.step(SIM_DT);
      gears.add(sim.sample(1).drive.gear);
    }
    const f = sim.sample(1);
    console.log(`[plant] 10 s full throttle from rest (no steering, loop): ${f.drive.u.toFixed(1)} m/s, gears ${[...gears].sort().join(',')}, zone ${f.drive.zone}`);
    expect(f.drive.u).toBeGreaterThan(15);
    expect(f.drive.u).toBeLessThan(50);
    expect(Math.max(...gears)).toBeGreaterThanOrEqual(2);
    expect(finiteFrame(f)).toBe(true);
  });

  it('0-100 km/h (traction aid on) and 100-0 km/h braking on a straight', () => {
    const sim = makeSim('test-strip', 'double-wishbone', 0);
    manualAtRest(sim);
    const d = sim.drive!;
    let t = 0;
    let f = sim.sample(1);
    while (f.drive.u < 100 / 3.6 && t < 15) {
      d.setIntent(intent({ throttle: 1, steer: keepLine(f) }));
      sim.step(SIM_DT);
      t += SIM_DT;
      f = sim.sample(1);
    }
    const accel = t;
    // brake from exactly the speed reached (a fraction above 100 km/h), distance scaled to 100 km/h
    const v0 = f.drive.u;
    const x0 = f.drive.x;
    const y0 = f.drive.y;
    let tb = 0;
    while (f.drive.u > 0.05 && tb < 10) {
      d.setIntent(intent({ brake: 1, steer: keepLine(f) }));
      sim.step(SIM_DT);
      tb += SIM_DT;
      f = sim.sample(1);
    }
    const dist = Math.hypot(f.drive.x - x0, f.drive.y - y0) * (100 / 3.6 / v0) ** 2;
    console.log(`[plant] 0-100 km/h ${accel.toFixed(2)} s (TCS on); 100-0 km/h ${dist.toFixed(1)} m in ${tb.toFixed(2)} s (default assists: ABS on since 09-04), lateral drift ${f.drive.lineOffset.toFixed(2)} m`);
    expect(accel).toBeGreaterThan(3.5);
    expect(accel).toBeLessThan(7);
    expect(dist).toBeGreaterThan(30);
    expect(dist).toBeLessThan(50);
  });

  it.each(SUSPENSION_IDS)('%s: steady lateral acceleration on a 60 m radius (slow speed ramp)', (id) => {
    const sim = makeSim('test-skidpad', id, 0);
    sim.drive!.setAids({ ...DEFAULT_AIDS, steering: false });
    manualAtRest(sim);
    let maxAy = 0;
    let vAt = 0;
    let lost = 0;
    for (let k = 0; k < steps(90); k++) {
      const f = sim.sample(1);
      const target = Math.min(40, 12 + k * SIM_DT * 0.3);
      const u = f.drive.u;
      const throttle = Math.max(0, Math.min(1, 0.3 * (target - u) + 0.1));
      sim.drive!.setIntent(intent({ throttle, steer: keepLine(f, 1 / 60) }));
      sim.step(SIM_DT);
      if (k > steps(5) && Math.abs(f.drive.lineOffset) < 1 && f.ay / G > maxAy) {
        maxAy = f.ay / G;
        vAt = u;
      }
      if (Math.abs(f.drive.lineOffset) > 4) {
        lost = u;
        break;
      }
      expect(finiteFrame(f)).toBe(true);
    }
    console.log(`[plant] ${id}: max steady a_y on R 60 m ${maxAy.toFixed(3)} g at ${vAt.toFixed(1)} m/s (line lost at ${lost.toFixed(1)} m/s)`);
    expect(maxAy).toBeGreaterThan(0.85);
    expect(maxAy).toBeLessThan(1.15);
  });

  it('request(auto) returns (10-01), request(auto, immediate) releases at once: a cut, back on the rails, live seek clears detached', () => {
    const sim = makeSim('proving-loop', 'double-wishbone', 20);
    const d = sim.drive!;
    expect(d.available).toBe(true);
    d.request('manual');
    d.reset(); // the kernel sends a reset right after the request: both apply at the next step, in order
    sim.step(SIM_DT);
    let ev = events(sim);
    expect(ev.map((e) => e.kind)).toEqual(['mode', 'reset']);
    expect(sim.sample(1).drive.mode).toBe('manual');
    expect(sim.sample(1).drive.detached).toBe(true);
    expect(sim.sample(1).drive.u).toBe(0);
    d.request('auto');
    expect(d.mode).toBe('manual'); // applied at the next step
    sim.step(SIM_DT);
    ev = events(sim);
    expect(ev).toEqual([expect.objectContaining({ kind: 'mode', mode: 'returning', previous: 'manual', cut: false })]);
    expect(sim.sample(1).drive.source).toBe('autopilot');
    d.request('auto', true);
    sim.step(SIM_DT);
    ev = events(sim);
    expect(ev).toEqual([expect.objectContaining({ kind: 'mode', mode: 'auto', previous: 'returning', cut: true })]);
    const f = sim.sample(1);
    expect(f.drive.mode).toBe('auto');
    expect(f.drive.detached).toBe(true);
    sim.seek(40);
    expect(sim.sample(1).drive.detached).toBe(false);
    // a reset requested in auto is ignored
    d.reset();
    sim.step(SIM_DT);
    expect(events(sim)).toEqual([]);
  });

  it('seek and setVehicle while driving release first (a cut)', () => {
    const sim = makeSim();
    sim.drive!.request('manual');
    sim.step(SIM_DT);
    events(sim);
    sim.seek(12);
    expect(events(sim)).toEqual([expect.objectContaining({ kind: 'mode', mode: 'auto', cut: true })]);
    sim.drive!.request('manual');
    sim.step(SIM_DT);
    sim.setVehicle('gt-coupe');
    expect(sim.drive!.mode).toBe('auto');
  });

  it('the Auto frame fills the M2 fields (§7.3 (4))', () => {
    const sim = makeSim('proving-loop', 'double-wishbone', 30);
    sim.step(SIM_DT);
    const f = sim.sample(1);
    const path = sim.stateAt(sim.lapTime, { lapTime: 0, s: 0, l: 0, v: 0, ax: 0, ay: 0, curvature: 0, heading: 0, x: 0, y: 0, z: 0, bank: 0, grade: 0, sectionIndex: 0 });
    expect(f.drive).toMatchObject({ mode: 'auto', available: true, source: null, gear: 0, engineRpm: 0, v: 0, beta: 0, zone: 'loop' });
    expect(f.drive.x).toBeCloseTo(path.x, 9);
    expect(f.drive.u).toBeCloseTo(path.v, 9);
    for (const c of f.corners) {
      expect(c.capacity).toBeGreaterThan(c.load * 0.5);
      expect(Math.hypot(c.fx, c.fy) / c.capacity).toBeCloseTo(c.gripUse, 9);
      expect(c.omega).toBeCloseTo((path.v * (1 - path.curvature * (c.side * 0.86))) / gtCoupe.rear.tyre.radius, 0);
      expect(c.slipAngle).toBe(0);
      expect(c.slipRatio).toBe(0);
    }
    expect(f.corners.map((c) => c.surface)).toContain('pave');
  });

  it('fuzz: minutes of random intents, resets, swaps, aids and mode toggles stay finite', () => {
    const rng = createRng(99);
    const sim = makeSim();
    const d = sim.drive!;
    d.request('manual');
    let faults = 0;
    let worstSpeed = 0;
    const minutes = 6;
    const ids = SUSPENSION_IDS;
    let i = intent();
    for (let k = 0; k < steps(minutes * 60); k++) {
      if (k % 30 === 0 || rng.next() < 0.002) {
        const digital = rng.next() < 0.5;
        i = intent({
          steer: rng.next() < 0.3 ? (rng.next() < 0.5 ? -1 : 1) : rng.uniform(-1, 1),
          throttle: rng.next() < 0.5 ? 0 : rng.next() < 0.5 ? 1 : rng.next(),
          brake: rng.next() < 0.7 ? 0 : rng.next(),
          handbrake: rng.next() < 0.9 ? 0 : 1,
          digital,
          source: digital ? 'keyboard' : 'gamepad',
        });
        d.setIntent(i);
      }
      const roll = rng.next();
      if (roll < 0.0005) d.reset();
      else if (roll < 0.0008) sim.setSuspension(ids[Math.floor(rng.next() * ids.length)]!);
      else if (roll < 0.001) d.setAids({ abs: rng.next() < 0.5, traction: rng.next() < 0.5, stability: rng.next() < 0.5, steering: rng.next() < 0.5 });
      else if (roll < 0.0011) d.request('auto');
      else if (roll < 0.0013) d.request('manual');
      sim.step(SIM_DT);
      if (k % 24 === 0) {
        const f = sim.sample(0.5, 1);
        if (!finiteFrame(f)) throw new Error(`non-finite frame at step ${k}`);
        worstSpeed = Math.max(worstSpeed, f.speed);
        faults = f.drive.faults;
      }
      d.drainEvents(() => {});
      sim.drainEvents(() => {});
    }
    console.log(`[plant] fuzz ${minutes} min sim time (${steps(minutes * 60)} steps): all frames finite, faults recovered ${faults}, max speed ${worstSpeed.toFixed(1)} m/s`);
    expect(faults).toBe(0);
  }, 300_000);

  it('no allocation in the plant step; step cost printed', () => {
    const gc = (globalThis as { gc?: () => void }).gc;
    expect(gc, 'vitest must run with --expose-gc').toBeTypeOf('function');
    const sim = makeSim('proving-loop', 'double-wishbone', 10);
    const d = sim.drive!;
    d.request('manual');
    sim.step(SIM_DT);
    const steer = [intent({ throttle: 0.6, steer: 0.2 }), intent({ throttle: 0.4, steer: -0.2 })];
    const frame = sim.sample(0);
    const block = (n: number) => {
      for (let k = 0; k < n; k++) {
        if (k % 480 === 0) d.setIntent(steer[(k / 480) & 1]!);
        sim.step(SIM_DT);
        if (k % 4 === 0) sim.sample(0.5, k & 4 ? 2 : 1);
        if (k % 240 === 0) {
          // keep it on the loop: back to the line every second
          d.reset();
        }
        d.drainEvents(() => {});
        sim.drainEvents(() => {});
      }
    };
    block(4800);
    let retained = Infinity;
    let churn = Infinity;
    for (let r = 0; r < 3; r++) {
      gc!();
      const before = process.memoryUsage().heapUsed;
      block(9600);
      churn = Math.min(churn, process.memoryUsage().heapUsed - before);
      gc!();
      retained = Math.min(retained, process.memoryUsage().heapUsed - before);
    }
    // cost: driving the loop's line at about 12 m/s (the line keeper runs every 4th step, outside the timing)
    d.setAids({ ...DEFAULT_AIDS, steering: false });
    d.reset();
    sim.step(SIM_DT);
    const drive = intent();
    const fr = { s: 0, l: 0, heading: 0, curvature: 0, converged: true };
    let us = 0;
    const n = 24_000;
    for (let k = 0; k < n; k += 4) {
      const f = sim.sample(1);
      sim.world!.project(f.drive.x, f.drive.y, f.s, fr);
      drive.steer = keepLine(f, fr.curvature);
      drive.throttle = Math.max(0, Math.min(1, 0.2 * (12 - f.drive.u)));
      d.setIntent(drive);
      const t0 = performance.now();
      for (let j = 0; j < 4; j++) sim.step(SIM_DT);
      us += performance.now() - t0;
    }
    us = (us * 1000) / n;
    console.log(`[plant] cost run: ${sim.sample(1).drive.zone}, line offset ${sim.sample(1).drive.lineOffset.toFixed(2)} m`);
    console.log(`[plant] no-alloc: 9 600 plant steps + 2 400 samples: retained ${retained} B, churn ${churn} B (${(churn / 9600).toFixed(0)} B/step); plant step ${us.toFixed(2)} us (incl. driver, ground, ride)`);
    expect(retained).toBeLessThan(64 * 1024);
    expect(churn / 9600).toBeLessThan(1500);
    expect(sim.sample(0)).toBe(frame);
  });
});
