/**
 * Seeded scripted drive + state hash (ARCHITECTURE-M2 §6.6): the determinism probe behind `__app.driveHash` and CI.
 * Contracts-only code (Simulation, DriveControl), so it works on any simulation that exposes `drive`.
 */
import { CONTROL_TICKS, neutralIntent } from '../../contracts/drive';
import type { Simulation } from '../../contracts/sim';
import { SIM_DT } from '../../contracts/units';
import { createRng } from '../math/rng';

/** Steps between hashed samples (10 Hz). */
const HASH_TICKS = 24;
/** Seconds between new steer / throttle targets, and between brake-pulse draws. */
const TARGET_S = 1.5;
const BRAKE_S = 0.5;
/** Per control tick, the share of the remaining distance to a target that is closed (piecewise-smooth demands). */
const SMOOTH = 0.08;

/** Drives `sim` in manual for `seconds` with seeded intents; returns 8 hex chars, or 'no-drive' without a plant. */
export function runDriveScript(sim: Simulation, seed: number, seconds: number): string {
  const drive = sim.drive;
  if (!drive?.available) return 'no-drive';
  sim.seek(10);
  drive.request('manual');

  const rng = createRng(seed);
  const intent = { ...neutralIntent('keyboard'), digital: false };
  const targetTicks = Math.round(TARGET_S / SIM_DT);
  const brakeTicks = Math.round(BRAKE_S / SIM_DT);
  let steerTarget = 0;
  let throttleTarget = 0.5;
  let braking = false;

  let h = 0x811c9dc5;
  const mix = (v: number) => {
    const q = Math.round(v * 1e6);
    for (const part of [q | 0, Math.floor(q / 4294967296) | 0]) {
      h ^= part;
      h = Math.imul(h, 0x01000193);
    }
  };

  const steps = Math.round(seconds / SIM_DT);
  for (let i = 0; i < steps; i++) {
    if (i % targetTicks === 0) {
      steerTarget = rng.uniform(-0.6, 0.6);
      throttleTarget = rng.uniform(0.2, 0.8);
    }
    if (i % brakeTicks === 0) braking = rng.next() < 0.1;
    if (i % CONTROL_TICKS === 0) {
      intent.steer += (steerTarget - intent.steer) * SMOOTH;
      intent.throttle += ((braking ? 0 : throttleTarget) - intent.throttle) * SMOOTH;
      intent.brake += ((braking ? 0.5 : 0) - intent.brake) * SMOOTH;
      drive.setIntent(intent);
    }
    sim.step(SIM_DT);
    if ((i + 1) % HASH_TICKS === 0) {
      const f = sim.sample(1, 1);
      const d = f.drive;
      mix(d.x);
      mix(d.y);
      mix(d.yaw);
      mix(d.u);
      mix(d.v);
      for (const c of f.corners) {
        mix(c.travel);
        mix(c.load);
        mix(c.omega);
      }
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
