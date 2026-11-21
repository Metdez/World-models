import { it } from 'vitest';
import { SIM_DT } from '../../src/contracts/units';
import { intent, makeSim } from '../fixtures/08-02-drive';

it('scratch return', () => {
  const sim = makeSim('proving-loop', 'double-wishbone', 20);
  const d = sim.drive!;
  d.request('manual'); sim.step(SIM_DT);
  d.setIntent(intent({ steer: 0.3, throttle: 0.5 }));
  for (let k = 0; k < 240; k++) sim.step(SIM_DT);
  d.setIntent(intent({}));
  d.request('auto');
  let prev = sim.sample(1); let pf = JSON.parse(JSON.stringify(prev));
  const evs: string[] = [];
  for (let k = 0; k < 40 * 240; k++) {
    sim.step(SIM_DT);
    d.drainEvents((e) => evs.push(JSON.stringify(e)));
    const f = sim.sample(1);
    if (pf.drive.mode !== 'auto' && f.drive.mode === 'auto') {
      console.log('latch at', k * SIM_DT, 'dpos', Math.hypot(f.drive.x - pf.drive.x, f.drive.y - pf.drive.y), 'v*dt', pf.speed * SIM_DT,
        'dspeed', f.speed - pf.speed, 'dyawrate', f.yawRate - pf.yawRate, 'droll', f.roll - pf.roll, 'dpitch', f.pitch - pf.pitch, 'dheave', f.heave - pf.heave,
        'dz', f.bodyPosition.z - pf.bodyPosition.z, 'dyaw', f.drive.yaw - pf.drive.yaw,
        'dtravel', f.corners.map((c: any, i: number) => (c.travel - pf.corners[i].travel).toFixed(5)), 'dload', f.corners.map((c: any, i: number) => (c.load - pf.corners[i].load).toFixed(0)));
      // next few steps
      for (let j = 0; j < 3; j++) { const g = JSON.parse(JSON.stringify(sim.sample(1))); sim.step(SIM_DT); const h = sim.sample(1); console.log('after', h.roll - g.roll, h.bodyPosition.z - g.bodyPosition.z, h.corners.map((c: any, i: number) => (c.load - g.corners[i].load).toFixed(0))); }
      break;
    }
    if (k % 120 === 0) { const ps = sim.stateAt(sim.lapTime, {} as any); console.log((k*SIM_DT).toFixed(1), f.drive.mode, f.sectionId, f.drive.lineOffset.toFixed(3), (f.drive.headingError*57.3).toFixed(2), ((f.drive.yaw - ps.heading)*57.3).toFixed(2), f.drive.u.toFixed(2), ps.v.toFixed(2)); }
    pf = JSON.parse(JSON.stringify(f));
  }
  console.log(evs);
}, 60000);
