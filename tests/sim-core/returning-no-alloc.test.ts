/**
 * Returning step cost and allocation (ARCHITECTURE-M2 §11 S3, MD-20; was in path-driver.test.ts until 13-01): the plant +
 * PathDriver step under the M1 heap tripwire, and its median cost printed and <= 25 us in Node.
 *
 * Its own file on purpose, like no-alloc.test.ts (M1) and plant-no-alloc.test.ts: the tripwire reads the heap delta of
 * a block after a full GC, so what it can see depends on the young generation the worker has grown; after the heavier
 * T9/lap tests in the same worker the measured "churn" was a lottery over scavenge timing (13-01). What the tripwire
 * does and does not show: retained growth and large regressions, yes; V8's short-lived boxed doubles at non-inlined
 * calls, no (13-01 measured them with a sampling heap profile: Returning ~13.6 KB/step, Manual ~11.5, Auto ~3.7).
 */
import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/contracts/units';
import { makeSim } from '../fixtures/08-02-drive';
import { begin } from '../fixtures/10-01-returning';

describe('Returning cost and allocation', () => {
  it('no per-step allocation in returning; median step printed and <= 25 us', () => {
    const gc = (globalThis as { gc?: () => void }).gc;
    expect(gc).toBeTypeOf('function');
    const sim = makeSim('proving-loop', 'multilink', 0);
    const d = sim.drive!;
    // start well off the line so the autopilot works (recover / resume / track) for the whole measurement
    const restart = (i: number) => begin(sim, { lapTime: 10 + 7 * i, offset: 6, psi: 0.6, v: 15, yawRate: 0 });
    const block = (n: number, times?: number[]) => {
      for (let k = 0; k < n; k += 120) {
        const t0 = performance.now();
        for (let j = 0; j < 120; j++) sim.step(SIM_DT);
        times?.push(((performance.now() - t0) * 1000) / 120);
        sim.sample(0.5, 1);
        d.drainEvents(() => {});
        sim.drainEvents(() => {});
      }
    };
    for (let r = 0; r < 4; r++) {
      restart(r);
      block(2400); // warm-up through every recovery path (JIT)
    }
    let churn = Infinity;
    // best of 5 rounds (the first after a restart can still carry JIT work)
    for (let r = 0; r < 5; r++) {
      restart(r + 1);
      block(240); // the restart's own allocation (seek, events) settles
      gc!();
      const before = process.memoryUsage().heapUsed;
      block(2400);
      churn = Math.min(churn, process.memoryUsage().heapUsed - before);
    }
    // the same machine's manual plant step, measured interleaved: the full suite runs files in parallel workers, so the
    // absolute budget is asserted only when the manual step shows an uncontended machine (09-04 measured 17.1-17.6 us)
    const manual = makeSim('proving-loop', 'multilink', 10);
    manual.drive!.request('manual');
    manual.step(SIM_DT);
    manual.drive!.setIntent({ steer: 0, throttle: 0.3, brake: 0, handbrake: 0, digital: false, source: 'gamepad' });
    const manualBlock = (times: number[]) => {
      manual.drive!.reset(); // on the line (the road, not the costlier terrain blend)
      for (let k = 0; k < 2400; k += 120) {
        const t0 = performance.now();
        for (let j = 0; j < 120; j++) manual.step(SIM_DT);
        times.push(((performance.now() - t0) * 1000) / 120);
        manual.drainEvents(() => {});
        manual.drive!.drainEvents(() => {});
      }
    };
    const med = (xs: number[]) => [...xs].sort((x, y) => x - y)[xs.length >> 1]!;
    let best = { ret: Infinity, man: Infinity };
    for (let r = 0; r < 8 && best.ret > 20; r++) {
      restart(r + 6);
      const tr: number[] = [];
      const tm: number[] = [];
      block(2400, tr);
      manualBlock(tm);
      if (med(tr) < best.ret) best = { ret: med(tr), man: med(tm) };
    }
    expect(d.mode).toBe('returning');
    console.log(`[S3-returning] plant + PathDriver step median ${best.ret.toFixed(2)} us (manual plant step at the same time ${best.man.toFixed(2)} us, ratio ${(best.ret / best.man).toFixed(2)}); heap churn ${(churn / 2400).toFixed(0)} B/step`);
    expect(churn / 2400).toBeLessThan(1500);
    expect(best.ret / best.man).toBeLessThan(1.3);
    if (best.man <= 18) expect(best.ret).toBeLessThanOrEqual(25);
  }, 120_000);
});
