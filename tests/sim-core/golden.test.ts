/**
 * Determinism golden (ARCHITECTURE §13): 10 s from lap time 0 on the proving loop (seed 42), every sampled frame
 * quantised to 1e-6 and hashed. The hash must be identical across runs and match the recorded value; a deliberate
 * physics/content change updates GOLDEN (and says why in its commit).
 */
import { describe, expect, it } from 'vitest';
import type { SimCatalog } from '../../src/contracts/sim';
import type { TelemetryFrame } from '../../src/contracts/telemetry';
import { SIM_DT } from '../../src/contracts/units';
import { provingLoop } from '../../src/sim-core/content/proving-loop';
import { createSimulation } from '../../src/sim-core/index';

const GOLDEN: Record<string, string> = {
  macpherson: '53e95141',
  'double-wishbone': 'a8a25413',
  multilink: '64d2ddf9',
};
const empty: SimCatalog = { track: () => undefined, vehicle: () => undefined, suspension: () => undefined };

function hashRun(suspensionId: string): string {
  const sim = createSimulation({ catalog: empty, trackId: 'proving-loop', vehicleId: 'gt-coupe', suspensionId, lapTime: 0 });
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    const q = Math.round(v * 1e6);
    for (const part of [q | 0, Math.floor(q / 4294967296) | 0]) {
      h ^= part;
      h = Math.imul(h, 0x01000193);
    }
  };
  const frame = (f: TelemetryFrame) => {
    for (const v of [f.lapTime, f.s, f.speed, f.ax, f.ay, f.roll, f.pitch, f.heave, f.steer, f.bodyPosition.x, f.bodyPosition.y, f.bodyPosition.z]) mix(v);
    for (const c of f.corners) {
      for (const v of [
        c.travel,
        c.load,
        c.camber,
        c.toe,
        c.steer,
        c.gripUse,
        c.springForce,
        c.damperForce,
        c.wheelPosition.x,
        c.wheelPosition.z,
        c.contactPatch.z,
      ])
        mix(v);
      for (let k = 0; k < c.pointOrder.length * 3; k++) mix(c.points[k]!);
    }
  };
  for (let k = 0; k < 10 / SIM_DT; k++) {
    sim.step(SIM_DT);
    frame(sim.sample(0.5, k % 2 ? 2.5 : 1));
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

describe('determinism golden (seed 42, 10 s)', () => {
  it('uses the seed-42 proving loop', () => expect(provingLoop.seed).toBe(42));
  it.each(Object.keys(GOLDEN))('%s hashes identically across runs and matches the recording', (id) => {
    const a = hashRun(id);
    expect(hashRun(id)).toBe(a);
    expect(a).toBe(GOLDEN[id]);
  });
});
