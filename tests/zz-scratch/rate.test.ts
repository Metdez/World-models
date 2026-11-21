import { it } from 'vitest';
import { SIM_DT } from '../../src/contracts/units';
import { makeSim } from '../fixtures/08-02-drive';
import { begin } from '../fixtures/10-01-returning';
export function rate(stepOnce: () => void, n: number): number {
  let sum = 0; let prev = process.memoryUsage().heapUsed;
  for (let i = 0; i < n; i++) { stepOnce(); const h = process.memoryUsage().heapUsed; if (h > prev) sum += h - prev; prev = h; }
  // baseline cost of memoryUsage itself
  let base = 0; prev = process.memoryUsage().heapUsed;
  for (let i = 0; i < n; i++) { const h = process.memoryUsage().heapUsed; if (h > prev) base += h - prev; prev = h; }
  return (sum - base) / n;
}
it('rate', () => {
  const sim = makeSim('proving-loop', 'multilink', 0);
  const d = sim.drive!;
  const restart = (i: number) => begin(sim, { lapTime: 10 + 7 * i, offset: 6, psi: 0.6, v: 15, yawRate: 0 });
  for (let r = 0; r < 4; r++) { restart(r); for (let i = 0; i < 2400; i++) sim.step(SIM_DT); }
  restart(2); for (let i = 0; i < 240; i++) sim.step(SIM_DT);
  console.log('returning', rate(() => sim.step(SIM_DT), 2400).toFixed(0), 'B/step', d.mode);
  const m = makeSim('proving-loop', 'multilink', 10);
  m.drive!.request('manual'); m.step(SIM_DT);
  m.drive!.setIntent({ steer: 0, throttle: 0.3, brake: 0, handbrake: 0, digital: false, source: 'gamepad' });
  for (let i = 0; i < 9600; i++) { if (i % 2400 === 0) m.drive!.reset(); m.step(SIM_DT); }
  m.drive!.reset();
  console.log('manual', rate(() => m.step(SIM_DT), 2400).toFixed(0), 'B/step', m.drive!.mode);
  const a = makeSim('proving-loop', 'multilink', 10);
  for (let i = 0; i < 9600; i++) a.step(SIM_DT);
  console.log('auto', rate(() => a.step(SIM_DT), 2400).toFixed(0), 'B/step');
}, 300000);
