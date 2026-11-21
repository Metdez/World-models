/**
 * 11-05: the plant runs the 11-02 drive-event detectors once per fixed step and queues what they find with its other
 * drive events (strike and hard-stop included). Observational only: the state does not depend on them.
 */
import { describe, expect, it } from 'vitest';
import type { DriveAids, DriveEvent } from '../../src/contracts/drive';
import { SIM_DT } from '../../src/contracts/units';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { intent, makeSim, manualAtRest, steps } from '../fixtures/08-02-drive';
import { rig } from '../fixtures/09-04-handling';

const OFF: Partial<DriveAids> = { abs: false, traction: false, stability: false, steering: false };
const kinds = (evs: readonly DriveEvent[]) => evs.map((e) => e.kind).filter((k) => k !== 'zone');

describe('detectors in the plant', () => {
  it('a full stop from 25 m/s with ABS off queues lock-ups on both fronts and one hard stop; with ABS on the aid instead', () => {
    const off = rig({ aids: OFF });
    off.launch(25);
    off.driveEvents.length = 0;
    off.cmd.brake = 1;
    for (let k = 0; k < steps(4); k++) off.step();
    const corners = off.driveEvents.flatMap((e) => (e.kind === 'lockup' ? [e.corner] : []));
    expect(corners).toContain(0);
    expect(corners).toContain(1);
    const stops = off.driveEvents.filter((e) => e.kind === 'hard-stop');
    expect(stops).toHaveLength(1);
    expect((stops[0] as { from: number }).from).toBeGreaterThan(24);

    const on = rig();
    on.launch(25);
    on.driveEvents.length = 0;
    on.cmd.brake = 1;
    for (let k = 0; k < steps(4); k++) on.step();
    expect(kinds(on.driveEvents).filter((k) => k === 'lockup')).toEqual([]);
    expect(on.driveEvents.filter((e) => e.kind === 'aid').map((e) => (e as { aid: string }).aid)).toEqual(['abs']);
    expect(kinds(on.driveEvents)).toContain('hard-stop');
  });

  it('a lift-off in a fast corner queues one rear slide with lift', () => {
    const r = rig({ aids: OFF });
    r.launch(18, 1 / 40);
    r.driveEvents.length = 0;
    for (let k = 0; k < steps(3); k++) {
      r.cmd.steer = Math.atan(gtCoupe.wheelbase / 40) * 1.6;
      r.cmd.throttle = k * SIM_DT < 1.2 ? 0.7 : 0;
      r.step();
    }
    const rear = r.driveEvents.filter((e) => e.kind === 'slide' && e.axle === 'rear');
    expect(rear).toHaveLength(1);
    expect((rear[0] as { lift: boolean }).lift).toBe(true);
  });

  it('the simulation forwards them through drainEvents; draining them or not leaves the state checksum identical', () => {
    const run = (drain: boolean) => {
      const sim = makeSim('proving-loop', 'multilink', 10);
      manualAtRest(sim);
      sim.drive!.setAids({ abs: false, traction: false, stability: false, steering: false });
      const seen: DriveEvent[] = [];
      for (let k = 0; k < steps(8); k++) {
        if (k === 0) sim.drive!.setIntent(intent({ throttle: 1, steer: 0.4 }));
        if (k === steps(5)) sim.drive!.setIntent(intent({ brake: 1 }));
        sim.step(SIM_DT);
        if (drain) sim.drive!.drainEvents((e) => seen.push(e));
      }
      const host = sim.drive as unknown as { stateChecksum(): number };
      return { crc: host.stateChecksum(), seen: kinds(seen) };
    };
    const a = run(true);
    const b = run(false);
    expect(a.crc).toBe(b.crc);
    expect(a.seen.some((k) => k === 'wheelspin' || k === 'slide' || k === 'hard-stop' || k === 'lockup')).toBe(true);
  });
});
