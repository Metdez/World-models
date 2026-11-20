import { it } from 'vitest';
import { createSimulation } from '../../../src/sim-core/index';
import { SIM_DT } from '../../../src/contracts/units';
const empty = { track: () => undefined, vehicle: () => undefined, suspension: () => undefined };
it('repro', () => {
  for (const s of ['macpherson','double-wishbone','multilink']) {
    const sim = createSimulation({ catalog: empty, trackId: 'proving-loop', vehicleId: 'gt-coupe', suspensionId: s });
    const D = sim.lapDuration;
    const bad: string[] = [];
    for (let i = 0; i < 400; i++) { sim.seek(i / 400 * D); const f = sim.sample(1); if (!(Math.abs(f.heave) < 0.5)) bad.push((i/400*D).toFixed(3)); }
    console.log(s, D, bad.length, bad.slice(0, 20).join(' '));
  }
});
