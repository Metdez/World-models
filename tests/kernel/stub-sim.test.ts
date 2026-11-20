import { describe, expect, it } from 'vitest';
import type { PathState, SimCatalog, SimEvent } from '../../src/contracts/sim';
import { SEEK_SETTLE_S } from '../../src/contracts/sim';
import { SIM_DT } from '../../src/contracts/units';
import { createSimulation } from '../../src/sim-core/index';

const catalog: SimCatalog = { track: () => undefined, vehicle: () => undefined, suspension: () => undefined };
const make = (lapTime?: number) =>
  createSimulation({ catalog, trackId: 'proving-loop', vehicleId: 'gt-coupe', suspensionId: 'double-wishbone', ...(lapTime === undefined ? {} : { lapTime }) });
const path = (): PathState => ({ lapTime: 0, s: 0, l: 0, v: 0, ax: 0, ay: 0, curvature: 0, heading: 0, x: 0, y: 0, z: 0, bank: 0, grade: 0, sectionIndex: 0 });

describe('stub simulation (circle R 60 m, 15 m/s)', () => {
  it('stateAt is pure, periodic and inverted by lapTimeAt', () => {
    const sim = make(3);
    const D = sim.lapDuration;
    expect(D).toBeCloseTo((2 * Math.PI * 60) / 15, 12);
    const a = sim.stateAt(7.5, path());
    expect(sim.lapTime).toBe(3); // no side effects
    expect(sim.stateAt(7.5, path())).toEqual(a);
    const b = sim.stateAt(7.5 + 2 * D, path());
    expect(b.s).toBeCloseTo(a.s, 9);
    expect(b.x).toBeCloseTo(a.x, 9);
    expect(a.v).toBe(15);
    expect(a.ay).toBeCloseTo(15 ** 2 / 60, 12);
    expect(a.curvature).toBeCloseTo(1 / 60, 15);
    expect(Math.hypot(a.x, a.y - 60)).toBeCloseTo(60, 9);
    expect(sim.lapTimeAt(a.s)).toBeCloseTo(7.5, 12);
    expect(sim.lapTimeAt(-15)).toBeCloseTo(D - 1, 9);
    const p = sim.track.toWorld(a.s, 2, { x: 0, y: 0, z: 0 });
    expect(Math.hypot(p.x, p.y - 60)).toBeCloseTo(58, 9); // + left = toward the centre of a left turn
  });

  it('steps at SIM_DT, wraps the lap with one lap event and interpolates samples', () => {
    const sim = make(sim0Lap() - 2 * SIM_DT);
    const events: SimEvent[] = [];
    sim.step(SIM_DT);
    const before = sim.lapTime;
    sim.step(SIM_DT);
    sim.step(SIM_DT);
    sim.drainEvents((e) => events.push(e));
    expect(events).toEqual([{ kind: 'lap', lap: 1, duration: sim.lapDuration }]);
    sim.drainEvents((e) => events.push(e));
    expect(events).toHaveLength(1);
    expect(sim.lapTime).toBeCloseTo(SIM_DT, 9);
    expect(before).toBeCloseTo(sim.lapDuration - SIM_DT, 9);
    const f = sim.sample(0.5);
    expect(f.lapTime).toBeCloseTo(SIM_DT / 2, 9); // interpolated across the wrap
    expect(f.lap).toBe(1);
    expect(sim.sample(0.25)).toBe(f); // preallocated frame
  });

  it('frame has 4 corners with self-consistent synthetic travel and amplified POSE only', () => {
    const sim = make();
    for (let i = 0; i < 100; i++) sim.step(SIM_DT);
    const t1 = JSON.stringify(sim.sample(1, 1).corners.map((c) => [c.travel, c.load]));
    const posed = sim.sample(1, 2.5);
    expect(JSON.stringify(posed.corners.map((c) => [c.travel, c.load]))).toBe(t1); // TRUE fields unchanged
    expect(posed.amplification).toBe(2.5);
    expect(posed.corners.map((c) => c.id)).toEqual(['fl', 'fr', 'rl', 'rr']);
    const [fl, fr] = posed.corners;
    expect(fl!.pointOrder).toEqual(['wheelCentre']);
    expect(fl!.wheelPosition.z).toBeCloseTo(0.34, 12);
    expect(Math.hypot(fl!.wheelPosition.x - fr!.wheelPosition.x, fl!.wheelPosition.y - fr!.wheelPosition.y)).toBeCloseTo(1.6, 9);
    expect(posed.speed).toBe(15);
    expect(posed.sectionId).toBe('stub-circle');
  });

  it('seek, setSuspension, setVehicle, restPose, kinematics', () => {
    const sim = make();
    const t0 = sim.simTime;
    sim.seek(10);
    expect(sim.lapTime).toBe(10);
    expect(sim.simTime).toBe(t0 + SEEK_SETTLE_S);
    const frame = sim.sample(0);
    sim.setSuspension('macpherson');
    expect(sim.suspension.id).toBe('macpherson');
    expect(sim.sample(0)).toBe(frame);
    sim.setVehicle('other-car');
    expect(sim.vehicle.id).toBe('other-car');
    expect(sim.suspension.id).toBe('macpherson');
    const next = sim.sample(0);
    expect(next).not.toBe(frame);
    expect(next.vehicleId).toBe('other-car');
    const out = sim.restPose(0, new Float64Array(3));
    expect(out[2]).toBeCloseTo(0.34, 12);
    expect(sim.kinematics().front.summary.motionRatio).toBe(1);
  });
});

function sim0Lap() {
  return (2 * Math.PI * 60) / 15;
}
