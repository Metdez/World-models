import { it } from 'vitest';
import { createSimulation } from '../../../src/sim-core/index';
import { createCarModel } from '../../../src/sim-core/car/car-model';
import { gtCoupe } from '../../../src/sim-core/content/gt-coupe';
import { doubleWishbone } from '../../../src/sim-core/content/susp-double-wishbone';
import { SIM_DT } from '../../../src/contracts/units';
import { SEEK_SETTLE_S } from '../../../src/contracts/sim';
import { createTelemetryFrame } from '../../../src/contracts/telemetry';
const empty = { track: () => undefined, vehicle: () => undefined, suspension: () => undefined };
it('repro3', () => {
  const sim = createSimulation({ catalog: empty, trackId: 'proving-loop', vehicleId: 'gt-coupe', suspensionId: 'double-wishbone' });
  const D = sim.lapDuration;
  const t0 = 0.4 * D - SEEK_SETTLE_S;
  const model = createCarModel(gtCoupe, doubleWishbone, sim.track);
  const p: any = {}; sim.stateAt(t0, p);
  model.reset(p);
  const f = createTelemetryFrame('car', model.corners);
  model.sample(1,1,p,f);
  console.log('reset', f.heave, f.roll, f.pitch, f.corners.map(c=>c.travel.toFixed(4)+'/'+c.load.toFixed(0)+'/'+c.stop.toFixed(2)).join(' '));
  let lt = t0; const ev:any[]=[];
  for (let k=0;k<360;k++){ lt+=SIM_DT; sim.stateAt(lt,p); model.step(SIM_DT,p,ev); model.sample(1,1,p,f);
    if (k<10||k%24==0||!(Math.abs(f.heave)<1)) { console.log(k, f.heave.toExponential(2), f.roll.toExponential(2), f.corners.map(c=>c.travel.toFixed(4)+'/'+c.load.toFixed(0)).join(' ')); if(!(Math.abs(f.heave)<1)) break; } }
});
