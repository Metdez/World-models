import { it } from 'vitest';
import { SIM_DT } from '../../src/contracts/units';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { buildSpeedProfile } from '../../src/sim-core/path/speed-profile';
import { loopLine } from '../../src/sim-core/drive/reference';
import { createPathDriver } from '../../src/sim-core/drive/path-driver';
import { plantRig } from '../fixtures/08-02-drive';
import { pathState } from '../fixtures/09-04-handling';

it('scratch lap', () => {
  const r = plantRig();
  const profile = buildSpeedProfile(r.track, gtCoupe.limits, gtCoupe.dragArea, gtCoupe.mass);
  const path = pathState(0, 0, 0, 0, 0);
  profile.stateAt(5, path);
  r.model.reset(path);
  r.plant.engageFromPath(path, { ax: NaN, ay: NaN });
  const line = loopLine(r.track, profile, r.world);
  const pd = createPathDriver(gtCoupe, line, { speedScale: 0.97, exactSpeed: false });
  pd.engage(r.plant.view, r.plant.command);
  let maxE = 0, maxPsi = 0, conv = -1; const states = new Set<string>(); const secE: Record<string, number> = {}; const secV: Record<string, number> = {};
  for (let k = 0; k < 75 * 240; k++) {
    pd.step(SIM_DT, r.plant.view, r.cmd);
    r.step();
    maxE = Math.max(maxE, Math.abs(pd.lateralError)); maxPsi = Math.max(maxPsi, Math.abs(pd.headingError));
    states.add(pd.state);
    if (pd.converged && conv < 0) conv = k * SIM_DT;
    const sec = r.track.sections[r.track.sectionIndexAt(pd.lineS)]!.id; secE[sec] = Math.max(secE[sec] ?? 0, Math.abs(pd.lateralError));
    const dv = r.plant.view.u - pd.lineSpeed; if (Math.abs(dv) > Math.abs(secV[sec] ?? 0)) secV[sec] = dv; if ((sec==='bump-strip'||sec==='hairpin') && k%48===0) console.log('bz', pd.lineS.toFixed(1), r.plant.view.u.toFixed(2), pd.lineSpeed.toFixed(2), r.cmd.brake.toFixed(2), r.cmd.throttle.toFixed(2), pd.state);
    if (k % 2400 === 0) console.log(k*SIM_DT, pd.state, pd.lineS.toFixed(1), pd.lateralError.toFixed(3), (pd.headingError*57.3).toFixed(2), r.plant.view.u.toFixed(2), pd.lineSpeed.toFixed(2), pd.converged);
  }
  console.log(secE, secV); console.log({ maxE, maxPsi: maxPsi * 57.3, conv, states: [...states] });
}, 60000);
