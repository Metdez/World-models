/**
 * No allocation in the hot path (ARCHITECTURE §7.6, §18): 10 000 steps + 1 000 samples (+ the per-frame calls the
 * kernel and overlays make) keep every frame/state object identity-stable and the retained heap delta under 64 KB.
 * Measured: the heap BEFORE collection also grows (young-generation garbage, never retained): V8 boxes a double
 * passed to / returned from a call it did not inline, and whether the track-surface calls (roadHeight, sample,
 * stateAt: double arguments and results) get inlined is a JIT heuristic. That churn is printed and bounded here.
 */
import { describe, expect, it } from 'vitest';
import type { PathState, SimCatalog } from '../../src/contracts/sim';
import { SIM_DT } from '../../src/contracts/units';
import { createSimulation } from '../../src/sim-core/index';

const empty: SimCatalog = { track: () => undefined, vehicle: () => undefined, suspension: () => undefined };

describe('no allocation in step/sample', () => {
  it('10 000 steps + 1 000 samples: identity-stable objects, heap delta < 64 KB', () => {
    const gc = (globalThis as { gc?: () => void }).gc;
    expect(gc, 'vitest must run with --expose-gc').toBeTypeOf('function');
    const sim = createSimulation({ catalog: empty, trackId: 'proving-loop', vehicleId: 'gt-coupe', suspensionId: 'macpherson', lapTime: 10 });
    const path: PathState = { lapTime: 0, s: 0, l: 0, v: 0, ax: 0, ay: 0, curvature: 0, heading: 0, x: 0, y: 0, z: 0, bank: 0, grade: 0, sectionIndex: 0 };
    const rest = new Float64Array(32 * 3);
    let events = 0;
    const onEvent = () => void events++;
    const frame = sim.sample(0);
    const refs = [
      frame,
      frame.corners,
      frame.axles,
      frame.bodyPosition,
      frame.bodyRotation,
      ...frame.corners.flatMap((c) => [c, c.points, c.wheelPosition, c.wheelRotation, c.contactPatch, c.instantCentre, c.pointOrder]),
      ...frame.axles.map((a) => a.rollCentre),
    ];
    const kinematics = sim.kinematics();
    // 10 steps per sample, alternating amplification, plus the kernel's drain and the overlays' restPose / stateAt.
    const block = () => {
      for (let k = 0; k < 1000; k++) {
        for (let j = 0; j < 10; j++) sim.step(SIM_DT);
        const f = sim.sample(0.5, k & 1 ? 2.5 : 1);
        sim.drainEvents(onEvent);
        sim.restPose(k & 3, rest);
        sim.stateAt(f.lapTime + 1, path);
      }
    };
    block(); // warm-up: JIT, lazily created hidden classes
    let churn = Infinity; // min of 3: the worker's own background activity also shows up in heapUsed
    let retained = Infinity;
    for (let r = 0; r < 3; r++) {
      gc!();
      const before = process.memoryUsage().heapUsed;
      block();
      churn = Math.min(churn, process.memoryUsage().heapUsed - before);
      gc!();
      retained = Math.min(retained, process.memoryUsage().heapUsed - before);
    }
    console.log(
      `[no-alloc] 10 000 steps + 1 000 samples: retained ${retained} B; short-lived churn ${churn} B (${(churn / 10000).toFixed(0)} B per step incl. its share of samples; events seen: ${events})`,
    );
    expect(retained).toBeLessThan(64 * 1024);
    expect(churn / 10000).toBeLessThan(1500); // tripwire: a per-step object or array allocation would show far above boxing
    const after = sim.sample(0);
    const now = [
      after,
      after.corners,
      after.axles,
      after.bodyPosition,
      after.bodyRotation,
      ...after.corners.flatMap((c) => [c, c.points, c.wheelPosition, c.wheelRotation, c.contactPatch, c.instantCentre, c.pointOrder]),
      ...after.axles.map((a) => a.rollCentre),
    ];
    expect(now.length).toBe(refs.length);
    now.forEach((o, i) => expect(o).toBe(refs[i]));
    expect(sim.kinematics()).toBe(kinematics);
  });
});
