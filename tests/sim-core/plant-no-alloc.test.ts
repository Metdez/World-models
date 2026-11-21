/**
 * S3 (ARCHITECTURE-M2 §11, §14; MD-20): the full plant step (driver, aids, compliance, jacking, ground, ride) does not
 * allocate (heap tripwire as M1) and its median cost is printed and <= 25 us in Node.
 */
import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/contracts/units';
import { intent, makeSim } from '../fixtures/08-02-drive';

describe('plant cost and allocation (S3)', () => {
  it('no per-step allocation; median step <= 25 us', () => {
    const gc = (globalThis as { gc?: () => void }).gc;
    expect(gc, 'vitest must run with --expose-gc').toBeTypeOf('function');
    const sim = makeSim('proving-loop', 'multilink', 10);
    const d = sim.drive!;
    d.request('manual');
    sim.step(SIM_DT);
    const inputs = [intent({ throttle: 0.7, steer: 0.25, digital: true, source: 'keyboard' }), intent({ brake: 0.6, steer: -0.3, digital: true, source: 'keyboard' })];
    const block = (n: number, times?: number[]) => {
      for (let k = 0; k < n; k++) {
        if (k % 360 === 0) d.setIntent(inputs[(k / 360) & 1]!);
        if (k % 720 === 0) d.reset();
        if (times && k % 120 === 0) {
          const t0 = performance.now();
          for (let j = 0; j < 120; j++) sim.step(SIM_DT);
          times.push(((performance.now() - t0) * 1000) / 120);
          k += 119;
        } else sim.step(SIM_DT);
        if (k % 4 === 0) sim.sample(0.5, 1);
        d.drainEvents(() => {});
        sim.drainEvents(() => {});
      }
    };
    block(9600);
    let churn = Infinity;
    let retained = Infinity;
    for (let r = 0; r < 3; r++) {
      gc!();
      const before = process.memoryUsage().heapUsed;
      block(9600);
      churn = Math.min(churn, process.memoryUsage().heapUsed - before);
      gc!();
      retained = Math.min(retained, process.memoryUsage().heapUsed - before);
    }
    const times: number[] = [];
    for (let r = 0; r < 3; r++) block(9600, times);
    times.sort((a, b) => a - b);
    const median = times[times.length >> 1]!;
    console.log(`[S3] plant step (manual, multilink, keyboard intents, aids on): median ${median.toFixed(2)} us, p90 ${times[Math.floor(times.length * 0.9)]!.toFixed(2)} us over ${times.length} blocks of 120 steps; heap churn ${(churn / 9600).toFixed(0)} B/step, retained ${retained} B`);
    expect(retained).toBeLessThan(64 * 1024);
    expect(churn / 9600).toBeLessThan(1500);
    expect(median).toBeLessThanOrEqual(25);
  }, 120_000);
});
