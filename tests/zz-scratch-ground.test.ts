import { it } from 'vitest';
import { provingLoop } from '../src/sim-core/content/proving-loop';
import { buildTrack } from '../src/sim-core/track/build';
import { buildGroundWorld } from '../src/sim-core/world/ground';
it('ground profile', () => {
  const t = buildTrack(provingLoop); const w = buildGroundWorld(t, null);
  const hit = { h: 0, base: 0, surface: 'asphalt' as const, zone: '', s: 0, l: 0 } as any;
  const p = { x: 0, y: 0, z: 0 };
  const worst: [number, number, number, number, string][] = [];
  for (let s = 0; s < t.length; s += 2.5) {
    let prev = NaN; let prevL = 0; let prevBase = NaN;
    for (let l = -30; l <= 30; l += 0.01) {
      t.toWorld(s, l, p);
      w.sample(p.x, p.y, s, hit);
      if (prev === prev) {
        const d = Math.abs(hit.h - prev);
        const db = Math.abs(hit.base - prevBase);
        if (d > 0.004 || db > 0.004) worst.push([s, l, d, db, hit.surface + '/' + hit.zone]);
      }
      prev = hit.h; prevBase = hit.base; prevL = l;
    }
  }
  worst.sort((a, b) => b[2] - a[2]);
  console.log('n jumps', worst.length);
  console.log(worst.slice(0, 40).map((r) => `s ${r[0].toFixed(1)} l ${r[1].toFixed(2)} dh ${(r[2]*1000).toFixed(1)} mm dbase ${(r[3]*1000).toFixed(1)} ${r[4]}`).join('\n'));
  // histogram of l
  const byL = new Map<number, number>(); for (const r of worst) { const k = Math.round(Math.abs(r[1])); byL.set(k, (byL.get(k) ?? 0) + 1); }
  console.log([...byL.entries()].sort((a,b)=>a[0]-b[0]).map(([k,v])=>`${k}:${v}`).join(' '));
});
