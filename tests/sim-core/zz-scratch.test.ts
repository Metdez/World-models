import { it } from 'vitest';
import { SIM_DT } from '../../src/contracts/units';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { plantRig } from '../fixtures/08-02-drive';
import { strip } from '../fixtures/08-02-test-tracks';
it('coast', () => {
  const rig = plantRig(strip);
  const t0 = rig.track.sample(20, { s: 0, x: 0, y: 0, z: 0, heading: 0, curvature: 0, bank: 0, grade: 0 });
  rig.plant.place(t0.x, t0.y, t0.heading);
  rig.cmd.throttle = 0.4;
  while (rig.step().drive.u < 5);
  rig.cmd.throttle = 0;
  let prev = rig.frame.drive.u; let t = 0;
  for (; t < 60 && prev > 0; t += SIM_DT) {
    const f = rig.step();
    if (f.drive.u > prev + 1e-9 && t > 0.5) console.log('rise', t.toFixed(3), (f.drive.u - prev).toExponential(2), f.drive.u.toFixed(4), 'g', f.drive.gear, 'rpm', f.drive.engineRpm.toFixed(0), f.corners.map(c => c.fx.toFixed(1)).join(','));
    prev = f.drive.u;
  }
  rig.cmd.throttle = 0.12; rig.cmd.steer = gtCoupe.maxSteer;
  let pu = 0;
  for (let k = 0; k < 240 * 6; k++) { const f = rig.step(); if (f.drive.u < pu - 1e-3) console.log('drop', (k / 240).toFixed(3), f.drive.u.toFixed(4), pu.toFixed(4), 'g', f.drive.gear, f.drive.engineRpm.toFixed(0)); pu = f.drive.u; }
});
