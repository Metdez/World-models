import { it } from 'vitest';
import { SIM_DT } from '../../src/contracts/units';
import type { DriveHost } from '../../src/sim-core/drive/control';
import { makeSim } from '../fixtures/08-02-drive';
import { begin } from '../fixtures/10-01-returning';

const START = JSON.parse(process.env.START ?? '{}');
it('one', () => {
  const sim = makeSim('proving-loop', 'double-wishbone', 0);
  begin(sim, START);
  for (let k = 0; k < 20 * 240; k++) {
    sim.step(SIM_DT);
    const f = sim.sample(1);
    const ap = (sim.drive as DriveHost).autopilot;
    if (k % 60 === 0 && ap) console.log((k*SIM_DT).toFixed(2), ap.state, f.sectionId, 'e', ap.lateralError.toFixed(3), 'psi', (ap.headingError*57.3).toFixed(2), 'u', f.drive.u.toFixed(2), 'vref', ap.lineSpeed.toFixed(2), 'beta', (f.drive.beta*57.3).toFixed(1), 'cmd', f.steer.toFixed(3), f.drive.throttle.toFixed(2), f.drive.brake.toFixed(2), 'ax', f.ax.toFixed(2), 'ay', f.ay.toFixed(2), f.drive.gear, f.drive.tractionActive, f.drive.stabilityActive);
    if (f.drive.mode === 'auto') { console.log('latched', k * SIM_DT); break; }
  }
});
