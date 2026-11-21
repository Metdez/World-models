/**
 * Returning (ARCHITECTURE-M2 §7.10 B/C/D, §11 H2): Enter while driving hands the SAME plant to the PathDriver, which
 * brings it back from any state and latches onto the Auto lap.
 * H2: 500 seeded starts within 12 m of the driving line, any heading, -5..40 m/s, spinning (yaw rate up to 1 rad/s)
 * -> latch within RETURN_TIMEOUT (20 s), the CG never more than 30 m from the line, every frame finite; 50 starts off
 * the loop (20-55 m from the centreline, on the terrain the loop-only world provides until 10-02's zones) -> latch
 * within 60 s. Printed: worst and percentile rejoin times, and over the returns that never needed BRAKE (taken over on
 * the road at speed): max deceleration, max lateral acceleration, max steer rate (road-wheel actuator).
 * Latch continuity (§7.10 C) at 20 starts vs the step-to-step change just before the latch.
 */
import { describe, expect, it } from 'vitest';
import { G } from '../../src/contracts/units';
import { RETURN_TIMEOUT } from '../../src/sim-core/drive/control';
import { createRng } from '../../src/sim-core/math/rng';
import { makeSim } from '../fixtures/08-02-drive';
import { begin, runReturn, type ReturnResult, type Start } from '../fixtures/10-01-returning';

const DEG = Math.PI / 180;

const pct = (xs: number[], p: number): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;

describe('Returning (H2)', () => {
  it('500 seeded starts near the line latch within 20 s inside a 30 m corridor, all finite', () => {
    const sim = makeSim('proving-loop', 'double-wishbone', 0);
    const rng = createRng(1001);
    const times: number[] = [];
    const failures: string[] = [];
    let worstDist = 0;
    const gentle = { decel: 0, lat: 0, steerRate: 0, n: 0 };
    for (let i = 0; i < 500; i++) {
      const start: Start = {
        lapTime: rng.uniform(0, sim.lapDuration),
        offset: rng.uniform(-12, 12),
        psi: rng.uniform(-180, 180) * DEG,
        v: rng.uniform(-5, 40),
        yawRate: rng.uniform(-1, 1),
      };
      begin(sim, start);
      let r: ReturnResult;
      try {
        r = runReturn(sim, RETURN_TIMEOUT);
      } catch (err) {
        throw new Error(`#${i} ${JSON.stringify(start)}: ${String(err)}`);
      }
      times.push(r.latched ? r.time : Infinity);
      worstDist = Math.max(worstDist, r.maxLineDistance);
      if (!r.latched || !r.finite || r.maxLineDistance > 30)
        failures.push(`#${i} t ${start.lapTime.toFixed(1)} e ${start.offset.toFixed(1)} psi ${(start.psi / DEG).toFixed(0)} v ${start.v.toFixed(1)} r ${start.yawRate.toFixed(2)}: latched ${r.latched} in ${r.time.toFixed(1)} s, dist ${r.maxLineDistance.toFixed(1)}, finite ${r.finite}; ${r.last}`);
      if (!r.braked) {
        gentle.n++;
        gentle.decel = Math.max(gentle.decel, r.maxDecel);
        gentle.lat = Math.max(gentle.lat, r.maxLat);
        gentle.steerRate = Math.max(gentle.steerRate, r.maxSteerRate);
      }
    }
    const ok = times.filter((t) => t < Infinity);
    console.log(
      `[H2] 500 starts: latched ${ok.length}; rejoin time median ${pct(ok, 0.5).toFixed(1)} s, p90 ${pct(ok, 0.9).toFixed(1)} s, worst ${Math.max(...ok).toFixed(1)} s; max distance from the line ${worstDist.toFixed(1)} m\n` +
        `[H2] ${gentle.n} returns without BRAKE: max decel ${(gentle.decel / G).toFixed(2)} g, max lateral ${(gentle.lat / G).toFixed(2)} g, max steer rate ${gentle.steerRate.toFixed(2)} rad/s`,
    );
    if (failures.length) console.log(failures.slice(0, 20).join('\n'));
    expect(failures).toEqual([]);
  }, 600_000);
});

