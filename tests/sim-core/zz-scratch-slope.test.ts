import { it } from 'vitest';
import { SIM_DT } from '../../src/contracts/units';
import { makeSim } from '../fixtures/08-02-drive';
import { begin } from '../fixtures/10-01-returning';
it('slope', () => {
  const sim = makeSim('proving-loop', 'double-wishbone', 0);
  begin(sim, {"lapTime":22.4,"offset":-8.9,"psi":-1.2217,"v":11.8,"yawRate":0.71});
  for (let k = 0; k < 6 * 240; k++) sim.step(SIM_DT);
  const f = sim.sample(1);
  const { x, y, yaw } = f.drive;
  const h = (a: number, b: number) => sim.world.terrainHeight(a, b);
  const hit = { h: 0, base: 0, surface: 'asphalt', zone: '', s: 0, l: 0 } as any;
  sim.world.sample(x, y, NaN, hit);
  console.log('pos', x, y, 'yaw', yaw, 'hit', hit, 'gradx', (h(x + 1, y) - h(x - 1, y)) / 2, 'grady', (h(x, y + 1) - h(x, y - 1)) / 2, 'along heading', (h(x + Math.cos(yaw), y + Math.sin(yaw)) - h(x - Math.cos(yaw), y - Math.sin(yaw))) / 2);
  console.log('loads', f.corners.map((c) => c.load.toFixed(0)), 'omega', f.corners.map((c) => c.omega.toFixed(2)), 'gear', f.drive.gear, f.drive.engineRpm, f.drive.throttle, f.drive.brake);
});
