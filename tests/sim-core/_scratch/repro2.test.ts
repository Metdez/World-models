import { it } from 'vitest';
import { createSimulation } from '../../../src/sim-core/index';
import { SIM_DT } from '../../../src/contracts/units';
import { SEEK_SETTLE_S } from '../../../src/contracts/sim';
const empty = { track: () => undefined, vehicle: () => undefined, suspension: () => undefined };
it('repro2', () => {
  const sim = createSimulation({ catalog: empty, trackId: 'proving-loop', vehicleId: 'gt-coupe', suspensionId: 'double-wishbone' });
  const t = 0.4 * sim.lapDuration;
  // Mimic preroll manually: seek to t - settle then step
  sim.seek(t - SEEK_SETTLE_S); // this itself prerolls; instead look at seek(t) by stepping trace
  const f0 = sim.sample(1);
  console.log('seek(t-settle) heave', f0.heave, f0.corners.map(c=>c.travel.toFixed(4)+'/'+c.load.toFixed(0)).join(' '));
  for (let k=0;k<Math.round(SEEK_SETTLE_S/SIM_DT);k++){ sim.step(SIM_DT); const f=sim.sample(1); if(k%12==0||!(Math.abs(f.heave)<1)) {console.log(k, f.lapTime.toFixed(3), f.heave.toExponential(2), f.corners.map(c=>c.travel.toFixed(4)+'/'+c.load.toFixed(0)).join(' ')); if(!(Math.abs(f.heave)<1)) break;}}
});
