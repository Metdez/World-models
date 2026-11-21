/**
 * S2 and the safety net (ARCHITECTURE-M2 §7.2 step 13, §11; MD-18): a 200 000-step fuzz of random intents, suspension
 * swaps, aids, resets and mode toggles stays finite; NaN containment restores the newest good snapshot and counts it;
 * compliance off (maxAngle 0) is the kinematics-only arithmetic exactly; a car placed off the loop corridor runs.
 */
import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/contracts/units';
import type { CarDefinition } from '../../src/contracts/vehicle';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { provingLoop } from '../../src/sim-core/content/proving-loop';
import { createRng } from '../../src/sim-core/math/rng';
import { finiteFrame, intent, makeSim, plantRig, SUSPENSION_IDS } from '../fixtures/08-02-drive';
import { rig, speedHold } from '../fixtures/09-04-handling';

describe('plant safety (S2)', () => {
  it('fuzz 200 000 steps: random intents, swaps, aids, resets, mode toggles: all finite, faults reported', () => {
    const rng = createRng(2024);
    const sim = makeSim();
    const d = sim.drive!;
    d.request('manual');
    let faults = 0;
    let maxSpeed = 0;
    let i = intent();
    const N = 200_000;
    for (let k = 0; k < N; k++) {
      if (k % 24 === 0 || rng.next() < 0.003) {
        const digital = rng.next() < 0.6;
        i = intent({
          steer: rng.next() < 0.4 ? (rng.next() < 0.5 ? -1 : 1) : rng.uniform(-1, 1),
          throttle: rng.next() < 0.4 ? 0 : rng.next() < 0.6 ? 1 : rng.next(),
          brake: rng.next() < 0.7 ? 0 : rng.next() < 0.5 ? 1 : rng.next(),
          handbrake: rng.next() < 0.92 ? 0 : 1,
          digital,
          source: digital ? 'keyboard' : 'gamepad',
        });
        d.setIntent(i);
      }
      const roll = rng.next();
      if (roll < 0.0004) d.reset();
      else if (roll < 0.0008) sim.setSuspension(SUSPENSION_IDS[Math.floor(rng.next() * 3)]!);
      else if (roll < 0.001) d.setAids({ abs: rng.next() < 0.5, traction: rng.next() < 0.5, stability: rng.next() < 0.5, steering: rng.next() < 0.5 });
      else if (roll < 0.00105) d.request('auto');
      else if (roll < 0.0012) d.request('manual');
      sim.step(SIM_DT);
      if (k % 24 === 0) {
        const f = sim.sample(0.5, 1);
        if (!finiteFrame(f)) throw new Error(`non-finite frame at step ${k}`);
        maxSpeed = Math.max(maxSpeed, f.speed);
        if (f.drive.mode !== 'auto') faults = f.drive.faults;
      }
      d.drainEvents(() => {});
      sim.drainEvents(() => {});
    }
    console.log(`[S2] fuzz ${N} steps (${(N * SIM_DT).toFixed(0)} s): all frames finite, faults ${faults}, max speed ${maxSpeed.toFixed(1)} m/s`);
    expect(faults).toBe(0);
  }, 300_000);

  it('NaN containment: a non-finite command restores the newest good snapshot, counts it, keeps driving', () => {
    const r = rig();
    r.launch(20);
    const hold = speedHold(20);
    for (let k = 0; k < 240; k++) {
      hold(r);
      r.step();
    }
    r.cmd.steer = NaN;
    const f = r.step();
    expect(r.plant.faults).toBe(1);
    expect(r.driveEvents.filter((e) => e.kind === 'fault')).toHaveLength(1);
    expect(finiteFrame(f)).toBe(true);
    expect(f.drive.faults).toBe(1);
    r.cmd.steer = 0;
    for (let k = 0; k < 480; k++) {
      hold(r);
      expect(finiteFrame(r.step())).toBe(true);
    }
    expect(r.plant.faults).toBe(1);
    expect(r.plant.view.u).toBeGreaterThan(5);
  });

  it('compliance off (maxAngle 0): no compliance angle ever; compliance on: the multilink rear steers (control)', () => {
    // maxAngle 0 skips the compliance arithmetic entirely (plant.ts corners()): the kinematics-only plant.
    const h = gtCoupe.handling!;
    const off: CarDefinition = { ...gtCoupe, handling: { ...h, compliance: { ...h.compliance, maxAngle: 0 } } };
    const wa = new Float64Array(12);
    const run = (vehicle: CarDefinition): number[] => {
      const r = rig({ vehicle, suspension: 'multilink' });
      r.launch(22, 1 / 80);
      const hold = speedHold(22);
      const trace: number[] = [];
      for (let k = 0; k < 960; k++) {
        r.cmd.steer = 0.04 * Math.sin(k / 60);
        hold(r);
        r.step();
        r.plant.wheelAngles(wa);
        for (let i = 4; i < 12; i++) expect(vehicle === off ? wa[i] : 0).toBe(0);
        trace.push(r.plant.view.r);
      }
      return trace;
    };
    const a = run(off);
    const b = run(off);
    expect(a).toEqual(b);
    const on = rig({ suspension: 'multilink' });
    on.launch(22, 1 / 80);
    for (let k = 0; k < 240; k++) on.step();
    on.plant.wheelAngles(wa);
    expect(Math.abs(wa[4 + 3]!)).toBeGreaterThan(1e-4);
  });

  it('a car placed off the loop corridor (on the terrain) runs without faults', () => {
    const r = plantRig(provingLoop, 'macpherson');
    r.plant.place(60, 40, 0.3); // 40 m north of the launch straight
    r.cmd.throttle = 0.3;
    for (let k = 0; k < 480; k++) expect(finiteFrame(r.step(1))).toBe(true);
    expect(r.plant.faults).toBe(0);
    expect(r.frame.drive.u).toBeGreaterThan(1);
  });
});
