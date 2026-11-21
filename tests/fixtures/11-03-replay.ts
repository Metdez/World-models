/** Scripted drives for the 11-03 replay tests (test-only). */
import { CONTROL_TICKS, type DriveIntent } from '../../src/contracts/drive';
import type { Simulation } from '../../src/contracts/sim';
import { SIM_DT } from '../../src/contracts/units';
import type { DriveHost } from '../../src/sim-core/drive/control';
import { createRng } from '../../src/sim-core/math/rng';
import { makeSim, type SuspensionId } from './08-02-drive';

export const host = (sim: Simulation): DriveHost => sim.drive as DriveHost;

/** Manual from `lapTime` on the loop (one step: the engage). */
export function manualSim(lapTime = 10, suspension: SuspensionId = 'double-wishbone'): Simulation {
  const sim = makeSim('proving-loop', suspension, lapTime);
  sim.drive!.request('manual');
  sim.step(SIM_DT);
  return sim;
}

/**
 * A seeded driver: `analog` = smoothed gamepad-like demands with noise; otherwise keyboard taps (digital on/off keys
 * held for random spans, the typical desktop drive). Returns a stepper that drives `seconds`.
 */
export function scriptedDriver(seed: number, analog: boolean) {
  const rng = createRng(seed);
  const intent: DriveIntent = { steer: 0, throttle: 0, brake: 0, handbrake: 0, digital: !analog, source: analog ? 'gamepad' : 'keyboard' };
  let steerT = 0;
  let thrT = 0.6;
  let brakeT = 0;
  let hold = 0;
  return (sim: Simulation, seconds: number, each?: (k: number) => void) => {
    const n = Math.round(seconds / SIM_DT);
    for (let k = 0; k < n; k++) {
      if (k % CONTROL_TICKS === 0) {
        if (--hold <= 0) {
          hold = Math.round(rng.uniform(10, 60)); // control ticks (60 Hz)
          const r = rng.next();
          steerT = r < 0.3 ? 0 : r < 0.65 ? 1 : -1;
          steerT *= analog ? rng.uniform(0.2, 0.8) : 1;
          const p = rng.next();
          thrT = p < 0.6 ? (analog ? rng.uniform(0.3, 1) : 1) : 0;
          brakeT = p > 0.85 ? (analog ? rng.uniform(0.2, 0.7) : 1) : 0;
        }
        if (analog) {
          intent.steer += (steerT - intent.steer) * 0.15 + rng.uniform(-0.01, 0.01);
          intent.throttle = Math.max(0, Math.min(1, intent.throttle + (thrT - intent.throttle) * 0.2 + rng.uniform(-0.005, 0.005)));
          intent.brake = Math.max(0, Math.min(1, intent.brake + (brakeT - intent.brake) * 0.3));
        } else {
          intent.steer = steerT;
          intent.throttle = thrT;
          intent.brake = brakeT;
        }
        sim.drive!.setIntent(intent);
      }
      sim.step(SIM_DT);
      each?.(k);
    }
  };
}
