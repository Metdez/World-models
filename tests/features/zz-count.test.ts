import { it } from 'vitest';
import type { BufferGeometry } from 'three';
import { provingGround } from '../../src/sim-core/content/proving-ground';
import { provingLoop } from '../../src/sim-core/content/proving-loop';
import { buildTrack } from '../../src/sim-core/track/build';
import { buildGroundWorld } from '../../src/sim-core/world/ground';
import { buildTerrain } from '../../src/features/track/terrain';
import type { Frenet, GroundHit } from '../../src/contracts/world';

function probe(g: BufferGeometry, maxSize = 12) {
  const pos = g.getAttribute('position'); const idx = g.getIndex()!; const bins = new Map<number, number[]>();
  const key = (i: number, j: number) => i * 100_000 + j;
  for (let t = 0; t < idx.count; t += 3) {
    const xs = [0, 1, 2].map((k) => pos.getX(idx.getX(t + k))); const ys = [0, 1, 2].map((k) => -pos.getZ(idx.getX(t + k)));
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    if (x1 - x0 > maxSize || y1 - y0 > maxSize) continue;
    for (let i = Math.floor(x0 / 2); i <= Math.floor(x1 / 2); i++) for (let j = Math.floor(y0 / 2); j <= Math.floor(y1 / 2); j++) { const k = key(i, j); let b = bins.get(k); if (!b) bins.set(k, (b = [])); b.push(t); }
  }
  return (x: number, y: number): number[] => {
    const out: number[] = [];
    for (const t of bins.get(key(Math.floor(x / 2), Math.floor(y / 2))) ?? []) {
      const v = [0, 1, 2].map((k) => idx.getX(t + k));
      const [ax, ay, ah] = [pos.getX(v[0]!), -pos.getZ(v[0]!), pos.getY(v[0]!)]; const [bx, by, bh] = [pos.getX(v[1]!), -pos.getZ(v[1]!), pos.getY(v[1]!)]; const [cx, cy, ch] = [pos.getX(v[2]!), -pos.getZ(v[2]!), pos.getY(v[2]!)];
      const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(det) < 1e-12) continue;
      const w1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det; const w2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det; const w3 = 1 - w1 - w2;
      if (w1 < -1e-7 || w2 < -1e-7 || w3 < -1e-7) continue; out.push(w1 * ah + w2 * bh + w3 * ch);
    }
    return out;
  };
}
it('terrain', () => {
  const track = buildTrack(provingLoop);
  for (const def of [null, provingGround]) {
    const world = buildGroundWorld(track, def);
    const t0 = performance.now();
    const g = buildTerrain(track, world);
    console.log(def?.id ?? 'bare', 'ms', (performance.now() - t0).toFixed(0), JSON.stringify(g.userData.stats));
    const pr = probe(g);
    const hit: GroundHit = { h: 0, base: 0, surface: 'grass', zone: '', s: 0, l: 0 };
    const fr0: Frenet = { s: 0, l: 0, heading: 0, curvature: 0, converged: true };
    let worst = 0, wx = 0, wy = 0, n = 0, holes = 0, multi = 0, poke = 0; const errs: number[] = [];
    let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 300000; k++) {
      const x = -300 + rnd() * 640, y = -530 + rnd() * 1010;
      world.sample(x, y, NaN, hit);
      const hs = pr(x, y);
      if (hs.length === 0) { holes++; continue; }
      if (hs.length > 2) multi++;
      if (hit.zone === 'loop') { if (Math.abs(hit.l) < 17.5 && Math.max(...hs) > hit.h - 0.005) { poke++; if (poke < 6) console.log('poke', x.toFixed(1), y.toFixed(1), 's', hit.s.toFixed(1), 'l', hit.l.toFixed(2), 'dh', (Math.max(...hs) - hit.h).toFixed(3)); } continue; }
      if (hit.zone !== 'terrain' && hit.zone !== 'field') continue;
      world.project(x, y, NaN, fr0); if (Math.abs(fr0.l) <= 18.5) continue;
      const e = Math.abs(hs[0]! - hit.h); n++; errs.push(e);
      if (e > worst) { worst = e; wx = x; wy = y; }
    }
    const fr: Frenet = { s: 0, l: 0, heading: 0, curvature: 0, converged: true }; world.project(wx, wy, NaN, fr); console.log('worst at s', fr.s.toFixed(1), 'l', fr.l.toFixed(2), 'curv', fr.curvature.toFixed(4));
    errs.sort((a, b) => a - b);
    console.log(`n ${n} holes ${holes} multi ${multi} poke ${poke} worst ${worst.toFixed(4)} at ${wx.toFixed(1)},${wy.toFixed(1)} p99 ${errs[Math.floor(n * 0.99)]!.toFixed(4)} p999 ${errs[Math.floor(n * 0.999)]!.toFixed(4)}`);
  }
}, 600000);
