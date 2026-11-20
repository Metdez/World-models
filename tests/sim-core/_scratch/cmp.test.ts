import { it } from 'vitest';
import { createSimulation } from '../../../src/sim-core/index';
import { SIM_DT } from '../../../src/contracts/units';
const empty = { track: () => undefined, vehicle: () => undefined, suspension: () => undefined };
it('cmp', () => {
  for (const s of ['macpherson','double-wishbone','multilink']) {
    const cont = createSimulation({ catalog: empty, trackId: 'proving-loop', vehicleId: 'gt-coupe', suspensionId: s });
    const sk = createSimulation({ catalog: empty, trackId: 'proving-loop', vehicleId: 'gt-coupe', suspensionId: s });
    const D = cont.lapDuration; const n = Math.floor(D / SIM_DT);
    const targets = new Set<number>(); for (let i=1;i<200;i++) targets.add(Math.round(i/200*n));
    let mh=0, mr=0, mp=0, mt=0, worst=0;
    for (let k=1;k<n;k++){ cont.step(SIM_DT); if(!targets.has(k)) continue; const a = cont.sample(1);
      const ah=a.heave, ar=a.roll, ap=a.pitch, at=a.corners.map(c=>c.travel), lt=a.lapTime;
      sk.seek(k*SIM_DT); const b = sk.sample(1);
      const dt = Math.max(...b.corners.map((c,i)=>Math.abs(c.travel-at[i])));
      if (dt>mt){mt=dt;worst=k*SIM_DT;}
      mh=Math.max(mh,Math.abs(b.heave-ah)); mr=Math.max(mr,Math.abs(b.roll-ar)); mp=Math.max(mp,Math.abs(b.pitch-ap));
      if (Math.abs(b.lapTime-lt)>1e-6) console.log('lt', lt, b.lapTime);
    }
    console.log(s, 'heave', mh, 'roll', mr, 'pitch', mp, 'travel', mt, 'at', worst);
  }
});
