import { Session } from 'node:inspector/promises';
import { it } from 'vitest';
import { SIM_DT } from '../../src/contracts/units';
import { makeSim } from '../fixtures/08-02-drive';
import { begin } from '../fixtures/10-01-returning';

async function profile(label: string, run: () => void, steps: number) {
  const session = new Session();
  session.connect();
  await session.post('HeapProfiler.enable');
  await session.post('HeapProfiler.startSampling', { samplingInterval: 64, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true } as never);
  run();
  const { profile } = await session.post('HeapProfiler.stopSampling');
  const self = new Map<string, number>();
  const pair = new Map<string, number>();
  let total = 0;
  const walk = (node: typeof profile.head, parent: string): void => {
    const here = `${node.callFrame.functionName}@${node.callFrame.url.split('/src/')[1] ?? node.callFrame.url.split('/').pop()}:${node.callFrame.lineNumber + 1}`;
    if (node.selfSize > 0) {
      total += node.selfSize;
      self.set(here, (self.get(here) ?? 0) + node.selfSize);
      pair.set(parent + ' > ' + here, (pair.get(parent + ' > ' + here) ?? 0) + node.selfSize);
    }
    node.children.forEach((c) => walk(c, here));
  };
  walk(profile.head, '');
  const fmt = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, v]) => `  ${(v / steps).toFixed(1)} B/step  ${k}`).join('\n');
  console.log(`== ${label}: total ${(total / steps).toFixed(0)} B/step\nSELF\n${fmt(self)}\nPAIRS\n${fmt(pair)}`);
  session.disconnect();
}

it('profile returning vs manual', async () => {
  const sim = makeSim('proving-loop', 'multilink', 0);
  const d = sim.drive!;
  const restart = (i: number) => begin(sim, { lapTime: 10 + 7 * i, offset: 6, psi: 0.6, v: 15, yawRate: 0 });
  const block = (n: number) => {
    for (let k = 0; k < n; k += 120) {
      for (let j = 0; j < 120; j++) sim.step(SIM_DT);
      sim.sample(0.5, 1);
      d.drainEvents(() => {});
      sim.drainEvents(() => {});
    }
  };
  for (let r = 0; r < 4; r++) { restart(r); block(2400); }
  let steps = 0;
  await profile('returning', () => { for (let r = 0; r < 4; r++) { restart(r + 1); block(240); block(2400); steps += 2640; if (d.mode !== 'returning') console.log('mode', d.mode); } }, 4 * 2640);
  const manual = makeSim('proving-loop', 'multilink', 10);
  manual.drive!.request('manual');
  manual.step(SIM_DT);
  manual.drive!.setIntent({ steer: 0, throttle: 0.3, brake: 0, handbrake: 0, digital: false, source: 'gamepad' });
  const mb = () => { manual.drive!.reset(); for (let k = 0; k < 2400; k += 120) { for (let j = 0; j < 120; j++) manual.step(SIM_DT); manual.drainEvents(() => {}); manual.drive!.drainEvents(() => {}); } };
  for (let i = 0; i < 4; i++) mb();
  await profile('manual', () => { for (let i = 0; i < 4; i++) mb(); }, 9600);
}, 300000);
