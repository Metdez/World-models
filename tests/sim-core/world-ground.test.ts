/** GroundWorld v0 (ARCHITECTURE-M2 §8.1): projection, loop corridor, surface bands and terrain. */
import { describe, expect, it } from 'vitest';
import type { TrackSample } from '../../src/contracts/track';
import type { Frenet, GroundHit } from '../../src/contracts/world';
import { groundHeight } from '../../src/features/track/terrain';
import { provingLoop } from '../../src/sim-core/content/proving-loop';
import { createRng } from '../../src/sim-core/math/rng';
import { buildTrack } from '../../src/sim-core/track/build';
import { buildGroundWorld, LOOP_CORRIDOR, loopSurface } from '../../src/sim-core/world/ground';
import { createProjectorCore } from '../../src/sim-core/world/project';
import { loopTerrainHeight } from '../../src/sim-core/world/terrain';

const track = buildTrack(provingLoop);
const L = track.length;
const ts = (): TrackSample => ({ s: 0, x: 0, y: 0, z: 0, heading: 0, curvature: 0, bank: 0, grade: 0 });
const frenet = (): Frenet => ({ s: 0, l: 0, heading: 0, curvature: 0, converged: true });
const hit = (): GroundHit => ({ h: 0, base: 0, surface: 'asphalt', zone: '', s: 0, l: 0 });
const ds = (a: number, b: number) => {
  const d = Math.abs(a - b) % L;
  return Math.min(d, L - d);
};

/** Dense centreline for the brute-force reference. */
const DENSE = 0.25;
const dense = (() => {
  const n = Math.ceil(L / DENSE);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const t = ts();
  for (let i = 0; i < n; i++) {
    track.sample((i * L) / n, t);
    x[i] = t.x;
    y[i] = t.y;
  }
  return { n, x, y };
})();
function bruteForce(px: number, py: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < dense.n; i++) {
    const d = (px - dense.x[i]!) ** 2 + (py - dense.y[i]!) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  // refine +-0.5 m at 5 mm
  const s0 = (best * L) / dense.n;
  const t = ts();
  let sBest = s0;
  bestD = Infinity;
  for (let k = -100; k <= 100; k++) {
    const s = s0 + k * 0.005;
    track.sample(s, t);
    const d = (px - t.x) ** 2 + (py - t.y) ** 2;
    if (d < bestD) {
      bestD = d;
      sBest = s;
    }
  }
  return ((sBest % L) + L) % L;
}

describe('loop projection', () => {
  it('matches brute force on 20 000 random points within 18 m (|ds| < 0.05 m); warm start <= 6 iterations', () => {
    const core = createProjectorCore(track);
    const rng = createRng(3);
    const t = ts();
    const out = frenet();
    let worstS = 0;
    let worstL = 0;
    let maxIt = 0;
    let coldMaxIt = 0;
    for (let k = 0; k < 20_000; k++) {
      const s = rng.uniform(0, L);
      const l = rng.uniform(-LOOP_CORRIDOR, LOOP_CORRIDOR);
      track.sample(s, t);
      const px = t.x - Math.sin(t.heading) * l;
      const py = t.y + Math.cos(t.heading) * l;
      // warm start: a hint within a few metres (the previous step's s of a moving wheel)
      core.project(px, py, s + rng.uniform(-3, 3), out);
      maxIt = Math.max(maxIt, core.iterations());
      const ref = bruteForce(px, py);
      worstS = Math.max(worstS, ds(out.s, ref));
      worstL = Math.max(worstL, Math.abs(Math.abs(out.l) - Math.abs(l)));
      if (k % 10 === 0) {
        core.project(px, py, NaN, out); // cold (strided fallback)
        coldMaxIt = Math.max(coldMaxIt, core.iterations());
        expect(ds(out.s, ref)).toBeLessThan(0.05);
      }
    }
    console.log(`[projection] 20 000 points: max |ds| ${worstS.toExponential(2)} m, max ||l| err| ${worstL.toExponential(2)} m, warm iterations <= ${maxIt}, cold <= ${coldMaxIt}`);
    expect(worstS).toBeLessThan(0.05);
    expect(maxIt).toBeLessThanOrEqual(6);
  }, 120_000);

  it('handles the seam, points inside an arc radius and a hint on the wrong branch', () => {
    const core = createProjectorCore(track);
    const out = frenet();
    // seam: just before / after s = 0 on the launch straight (heading +X at the origin)
    core.project(-0.3, 2, 0.2, out);
    expect(ds(out.s, L - 0.3)).toBeLessThan(1e-3);
    expect(out.l).toBeCloseTo(2, 3);
    // the hairpin finger: a point on the bump strip with a hint on the launch straight 41 m away
    const t = ts();
    const sBump = track.sections.find((x) => x.id === 'bump-strip')!.s0 + 30;
    track.sample(sBump, t);
    core.project(t.x, t.y, 60, out);
    expect(ds(out.s, sBump)).toBeLessThan(1e-3);
    // a car far out in the field still gets a finite answer
    core.project(5000, 3000, NaN, out);
    expect(Number.isFinite(out.s) && Number.isFinite(out.l)).toBe(true);
  });
});

describe('ground world', () => {
  const world = buildGroundWorld(track, null);

  it('on the corridor h = roadHeight (1e-12), base = swell + bank, bands by |l|', () => {
    const rng = createRng(11);
    const t = ts();
    const out = hit();
    const seen = new Set<string>();
    for (let k = 0; k < 5000; k++) {
      const s = rng.uniform(0, L);
      const l = rng.uniform(-17.4, 17.4);
      track.sample(s, t);
      const px = t.x - Math.sin(t.heading) * l;
      const py = t.y + Math.cos(t.heading) * l;
      world.sample(px, py, s, out);
      expect(Math.abs(out.h - track.roadHeight(out.s, out.l))).toBeLessThan(1e-12);
      expect(out.zone).toBe('loop');
      const base = provingLoop.swell.amplitude * Math.sin((2 * Math.PI * out.s) / L) + out.l * Math.tan(t.bank);
      expect(Math.abs(out.base - base)).toBeLessThan(1e-6);
      const a = Math.abs(out.l);
      const band = a <= 4.5 ? ['asphalt', 'pave'] : a <= 6 ? ['kerb'] : a <= 8 ? ['asphalt'] : ['grass'];
      expect(band).toContain(out.surface);
      seen.add(out.surface);
    }
    expect([...seen].sort()).toEqual(['asphalt', 'grass', 'kerb', 'pave']);
    // the pave span of the pave section
    const pave = track.sections.find((x) => x.id === 'pave')!;
    expect(loopSurface(track, pave.s0 + 10, 0)).toBe('pave');
    expect(loopSurface(track, pave.s0 + 10, 5)).toBe('kerb');
  });

  it('beyond the corridor: terrain, grass, NaN s/l; continuous across the 18 m edge', () => {
    const t = ts();
    const out = hit();
    const s = 50;
    track.sample(s, t);
    const at = (l: number) => world.sample(t.x - Math.sin(t.heading) * l, t.y + Math.cos(t.heading) * l, s, out);
    at(30);
    expect(out.zone).toBe('terrain');
    expect(out.surface).toBe('grass');
    expect(out.s).toBeNaN();
    let prev = at(17).h;
    for (let l = 17.01; l < 19.5; l += 0.01) {
      const h = at(l).h;
      expect(Math.abs(h - prev)).toBeLessThan(0.02); // the M1 terrain steps 3 cm at the ribbon edge (TUCK vs EDGE_DROP), half of it inside the blend
      prev = h;
    }
    expect(world.inBounds(t.x, t.y)).toBe(true);
    expect(world.inBounds(t.x - Math.sin(t.heading) * 80, t.y + Math.cos(t.heading) * 80)).toBe(false);
  });

  it('terrainHeight = features/track/terrain.ts groundHeight at 1 000 points (1e-9)', () => {
    const rng = createRng(5);
    const a = ts();
    const b = ts();
    for (let k = 0; k < 1000; k++) {
      const s = rng.uniform(0, L);
      const l = rng.uniform(-300, 300);
      const x = rng.uniform(-400, 400);
      const y = rng.uniform(-600, 200);
      expect(Math.abs(loopTerrainHeight(track, x, y, s, l, a) - groundHeight(track, x, y, s, l, b))).toBeLessThan(1e-9);
    }
  });
});
