import { describe, expect, it } from 'vitest';
import { QUALITY_PRESETS } from '../../src/contracts/app';
import type { XYZ } from '../../src/contracts/units';
import type { BufferGeometry } from 'three';
import type { Frenet, GroundHit } from '../../src/contracts/world';
import { buildRibbon, CHUNKS, featureZones, SURFACES } from '../../src/features/track/ribbon';
import { buildTerrain, TOLERANCE } from '../../src/features/track/terrain';
import { provingGround } from '../../src/sim-core/content/proving-ground';
import { provingLoop } from '../../src/sim-core/content/proving-loop';
import { buildTrack } from '../../src/sim-core/track/build';
import { buildGroundWorld } from '../../src/sim-core/world/ground';
import { compileZones } from '../../src/sim-core/world/zones';

const track = buildTrack(provingLoop);
const bare = buildGroundWorld(track, null);
const world = buildGroundWorld(track, provingGround);
const zones = compileZones(provingGround).zones;
const ribbons = {
  low: buildRibbon(track, QUALITY_PRESETS.low.trackResolution, false, { world: bare }),
  high: buildRibbon(track, QUALITY_PRESETS.high.trackResolution, true, { world: bare }),
};
const runoff = provingLoop.width / 2 + provingLoop.kerbWidth + provingLoop.runoff;
/** The ribbon runs 0.5 m past the runoff edge (the GroundWorld's road-to-terrain blend). */
const outer = runoff + 0.5;
const hit: GroundHit = { h: 0, base: 0, surface: 'grass', zone: '', s: NaN, l: NaN };
const fr: Frenet = { s: 0, l: 0, heading: 0, curvature: 0, converged: true };

/** Height of an indexed mesh (three x, h, -y) at world (x, y) for every triangle holding it (binned 2 m; triangles
 *  larger than `maxSize` skipped). */
function probe(g: BufferGeometry, maxSize = 12) {
  const pos = g.getAttribute('position');
  const idx = g.getIndex()!;
  const bins = new Map<number, number[]>();
  const key = (i: number, j: number) => i * 100_000 + j;
  for (let t = 0; t < idx.count; t += 3) {
    const xs = [0, 1, 2].map((k) => pos.getX(idx.getX(t + k)));
    const ys = [0, 1, 2].map((k) => -pos.getZ(idx.getX(t + k)));
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    if (x1 - x0 > maxSize || y1 - y0 > maxSize) continue;
    for (let i = Math.floor(x0 / 2); i <= Math.floor(x1 / 2); i++)
      for (let j = Math.floor(y0 / 2); j <= Math.floor(y1 / 2); j++) {
        const k = key(i, j);
        let b = bins.get(k);
        if (!b) bins.set(k, (b = []));
        b.push(t);
      }
  }
  return (x: number, y: number): number[] => {
    const out: number[] = [];
    for (const t of bins.get(key(Math.floor(x / 2), Math.floor(y / 2))) ?? []) {
      const v = [0, 1, 2].map((k) => idx.getX(t + k));
      const [ax, ay, ah] = [pos.getX(v[0]!), -pos.getZ(v[0]!), pos.getY(v[0]!)];
      const [bx, by, bh] = [pos.getX(v[1]!), -pos.getZ(v[1]!), pos.getY(v[1]!)];
      const [cx, cy, ch] = [pos.getX(v[2]!), -pos.getZ(v[2]!), pos.getY(v[2]!)];
      const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(det) < 1e-12) continue;
      const w1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det;
      const w2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det;
      const w3 = 1 - w1 - w2;
      if (w1 < -1e-7 || w2 < -1e-7 || w3 < -1e-7) continue;
      out.push(w1 * ah + w2 * bh + w3 * ch);
    }
    return out;
  };
}

describe('track ribbon', () => {
  for (const [tier, { geometry }] of Object.entries(ribbons)) {
    it(`${tier}: every vertex is the simulation's road surface at its (s, l); the outer 1 m is the GroundWorld blend`, () => {
      const pos = geometry.getAttribute('position');
      const uv = geometry.getAttribute('uv');
      const p: XYZ = { x: 0, y: 0, z: 0 };
      let worst = 0;
      let blend = 0;
      for (let i = 0; i < pos.count; i++) {
        const l = uv.getX(i);
        const s = uv.getY(i);
        track.toWorld(s, l, p);
        // three = (x, z, -y); float32 storage of coordinates up to a few hundred metres.
        worst = Math.max(worst, Math.abs(pos.getX(i) - p.x), Math.abs(pos.getZ(i) + p.y));
        if (Math.abs(l) <= runoff - 0.5 + 1e-6) {
          expect(Math.abs(pos.getY(i) - track.roadHeight(s, l))).toBeLessThan(1e-5);
          expect(Math.abs(pos.getY(i) - p.z)).toBeLessThan(1e-5);
        } else blend = Math.max(blend, Math.abs(pos.getY(i) - bare.sample(p.x, p.y, NaN, hit).h));
      }
      expect(worst).toBeLessThan(1e-4);
      // the band's terrain is taken linearly between its sampled edges (it is smooth there)
      expect(blend).toBeLessThan(0.005);
    });

    it(`${tier}: triangles tile the full band area once (no cracks, no overlaps) and groups cover every index`, () => {
      const pos = geometry.getAttribute('position');
      const index = geometry.getIndex()!;
      let area = 0;
      for (let t = 0; t < index.count; t += 3) {
        const a = index.getX(t);
        const b = index.getX(t + 1);
        const c = index.getX(t + 2);
        // Signed plan area (three x/z); + = counter-clockwise from above (front face up).
        const ux = pos.getX(b) - pos.getX(a);
        const uz = pos.getZ(b) - pos.getZ(a);
        const vx = pos.getX(c) - pos.getX(a);
        const vz = pos.getZ(c) - pos.getZ(a);
        const cross = uz * vx - ux * vz;
        expect(cross).toBeGreaterThanOrEqual(-1e-6);
        area += cross / 2;
      }
      // Integral of (1 - kappa l) dl over a symmetric section is its width, so the plan area is L x width (incl. the band).
      expect(area / (track.length * 2 * outer)).toBeCloseTo(1, 3);
      const covered = geometry.groups.reduce((n, g) => n + g.count, 0);
      expect(covered).toBe(index.count);
      expect(geometry.groups.map((g) => g.materialIndex)).toEqual(SURFACES.map((_, i) => i));
      expect(geometry.groups.every((g) => g.count > 0)).toBe(true);
    });

    it(`${tier}: the drawn chunks hold exactly the ribbon's triangles, share its buffers and bound their own part`, () => {
      const { chunks } = ribbons[tier as keyof typeof ribbons];
      expect(chunks.length).toBe(CHUNKS);
      // Draw-call budget (ARCHITECTURE §18, track ≤ 30): every chunk group in view, plus terrain, cones, signboards.
      expect(chunks.reduce((n, g) => n + g.groups.length, 0) + 3).toBeLessThanOrEqual(30);
      expect(chunks.reduce((n, g) => n + g.getIndex()!.count, 0)).toBe(geometry.getIndex()!.count);
      const pos = geometry.getAttribute('position');
      for (const g of chunks) {
        expect(g.getAttribute('position')).toBe(pos);
        expect(g.getAttribute('normal')).toBe(geometry.getAttribute('normal'));
        expect(g.groups.reduce((n, gr) => n + gr.count, 0)).toBe(g.getIndex()!.count);
        // Each chunk is a part of the lap: smaller than the whole ribbon, so culling pays.
        expect(g.boundingSphere!.radius).toBeLessThan(geometry.boundingSphere!.radius);
        const idx = g.getIndex()!;
        for (let i = 0; i < idx.count; i += 97) {
          const v = idx.getX(i);
          const d = Math.hypot(pos.getX(v) - g.boundingSphere!.center.x, pos.getY(v) - g.boundingSphere!.center.y, pos.getZ(v) - g.boundingSphere!.center.z);
          expect(d).toBeLessThanOrEqual(g.boundingSphere!.radius + 1e-3);
        }
      }
    });

    it(`${tier}: the closing row repeats row 0 (positions and normals) so the loop has no seam`, () => {
      const pos = geometry.getAttribute('position');
      const nor = geometry.getAttribute('normal');
      const uv = geometry.getAttribute('uv');
      const start: number[] = [];
      const end: number[] = [];
      for (let i = 0; i < uv.count; i++) {
        if (uv.getY(i) === 0) start.push(i);
        if (Math.abs(uv.getY(i) - track.length) < 1e-3) end.push(i);
      }
      expect(end.length).toBe(start.length);
      start.forEach((a, k) => {
        const b = end[k]!;
        expect(uv.getX(a)).toBe(uv.getX(b));
        for (const attr of [pos, nor]) {
          expect(attr.getX(a)).toBeCloseTo(attr.getX(b), 4);
          expect(attr.getY(a)).toBeCloseTo(attr.getY(b), 4);
          expect(attr.getZ(a)).toBeCloseTo(attr.getZ(b), 4);
        }
      });
    });
  }

  it('feature zones are densely sampled (rows and columns) where the car reacts', () => {
    const { geometry } = ribbons.low;
    const uv = geometry.getAttribute('uv');
    const zones = featureZones(track, false);
    expect(zones.map((z) => z.kind).sort()).toEqual(['cosine-bump', 'humps', 'kerb-strike', 'pave', 'pothole', 'washboard']);
    const rows = new Map<number, number[]>();
    for (let i = 0; i < uv.count; i++) {
      const s = uv.getY(i);
      let r = rows.get(s);
      if (!r) rows.set(s, (r = []));
      r.push(uv.getX(i));
    }
    const stations = [...rows.keys()].sort((a, b) => a - b);
    const maxRowGap = (s0: number, s1: number) => {
      const inside = stations.filter((s) => s >= s0 - 1e-6 && s <= s1 + 1e-6);
      return Math.max(...inside.slice(1).map((s, i) => s - inside[i]!));
    };
    const bump = zones.find((z) => z.kind === 'cosine-bump')!;
    expect(maxRowGap(bump.s0, bump.s1)).toBeLessThanOrEqual(0.0501);
    const pothole = zones.find((z) => z.kind === 'pothole')!;
    expect(maxRowGap(pothole.s0, pothole.s1)).toBeLessThanOrEqual(0.0501);
    // The pothole row through its centre has columns every 5 cm across it.
    const mid = stations.reduce((a, b) => (Math.abs(b - (pothole.s0 + pothole.s1) / 2) < Math.abs(a - (pothole.s0 + pothole.s1) / 2) ? b : a));
    const cols = rows.get(mid)!.filter((l) => l > -1.1 && l < -0.5).sort((a, b) => a - b);
    expect(Math.max(...cols.slice(1).map((l, i) => l - cols[i]!))).toBeLessThanOrEqual(0.0501);
    expect(maxRowGap(zones.find((z) => z.kind === 'washboard')!.s0, zones.find((z) => z.kind === 'washboard')!.s1)).toBeLessThanOrEqual(0.9 / 7 + 1e-6);
    expect(maxRowGap(zones.find((z) => z.kind === 'kerb-strike')!.s0, zones.find((z) => z.kind === 'kerb-strike')!.s1)).toBeLessThanOrEqual(0.1001);
    // Outside the zones the low tier keeps its 1 m resolution.
    expect(maxRowGap(0, track.length)).toBeLessThanOrEqual(QUALITY_PRESETS.low.trackResolution + 1e-6);
  });

  it('the drawn road matches the sim surface between vertices to within a few mm on the driven lanes', () => {
    // Barycentric check along each wheel path of the driving line: interpolated mesh height vs roadHeight.
    const { geometry } = ribbons.high;
    const pos = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    const index = geometry.getIndex()!;
    // Bin triangles by s so the lookup stays cheap.
    const bins = new Map<number, number[]>();
    for (let t = 0; t < index.count; t += 3) {
      const s = uv.getY(index.getX(t));
      const k = Math.floor(s);
      let b = bins.get(k);
      if (!b) bins.set(k, (b = []));
      b.push(t);
    }
    let worst = 0;
    for (let s = 0.123; s < track.length - 1; s += 1.37) {
      for (const side of [-0.8, 0.8]) {
        const l = track.lineOffset(s) + side;
        for (const t of [...(bins.get(Math.floor(s)) ?? []), ...(bins.get(Math.floor(s) - 1) ?? [])]) {
          const ids = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
          const [a, b, c] = ids.map((i) => [uv.getX(i), uv.getY(i), pos.getY(i)] as const);
          const det = (b![1] - c![1]) * (a![0] - c![0]) + (c![0] - b![0]) * (a![1] - c![1]);
          if (Math.abs(det) < 1e-12) continue;
          const w1 = ((b![1] - c![1]) * (l - c![0]) + (c![0] - b![0]) * (s - c![1])) / det;
          const w2 = ((c![1] - a![1]) * (l - c![0]) + (a![0] - c![0]) * (s - c![1])) / det;
          const w3 = 1 - w1 - w2;
          if (w1 < -1e-9 || w2 < -1e-9 || w3 < -1e-9) continue;
          const z = w1 * a![2] + w2 * b![2] + w3 * c![2];
          worst = Math.max(worst, Math.abs(z - track.roadHeight(s, l)));
          break;
        }
      }
    }
    // Roughness is sampled at the tier spacing (its shortest waves are below it); features are resolved finely.
    expect(worst).toBeLessThan(0.012);
  });
});

describe('ribbon with the proving-ground world', () => {
  const cut = buildRibbon(track, QUALITY_PRESETS.low.trackResolution, false, { world, zones });
  const spurs = zones.filter((z) => z.def.shape.kind === 'path');

  it('follows the GroundWorld where a zone contributes and leaves the link roads\' footprints to their meshes', () => {
    const pos = cut.geometry.getAttribute('position');
    const uv = cut.geometry.getAttribute('uv');
    let followed = 0;
    for (let i = 0; i < pos.count; i++) {
      world.sample(pos.getX(i), -pos.getZ(i), NaN, hit);
      if (hit.s === hit.s) continue;
      if (Math.abs(uv.getX(i)) > runoff - 0.5) continue;
      followed++;
      expect(Math.abs(pos.getY(i) - hit.h)).toBeLessThan(0.001);
    }
    expect(followed).toBeGreaterThan(100);
    const idx = cut.geometry.getIndex()!;
    const loc = { u: 0, w: 0, inside: 0, outside: 0 };
    for (let t = 0; t < idx.count; t += 3) {
      const v = [0, 1, 2].map((k) => idx.getX(t + k));
      const x = v.reduce((a, i) => a + pos.getX(i), 0) / 3;
      const y = -v.reduce((a, i) => a + pos.getZ(i), 0) / 3;
      for (const z of spurs) expect(z.local(x, y, loc).inside).toBeLessThanOrEqual(1e-6);
    }
    // nothing else changes: away from the spurs the cut ribbon has the bare ribbon's rows
    expect(cut.rows).toBeGreaterThan(ribbons.low.rows);
  });
});

describe('terrain', () => {
  const terrains = {
    bare: buildTerrain(track, bare),
    world: buildTerrain(track, world),
  };

  it('prints its size', () => {
    for (const [k, g] of Object.entries(terrains)) console.log(`terrain ${k}: ${JSON.stringify(g.userData.stats)}`);
    expect(terrains.world.userData.stats!.triangles).toBeLessThan(260_000);
  });

  for (const [name, w] of [
    ['bare', bare],
    ['world', world],
  ] as const) {
    it(`${name}: every vertex is the GroundWorld (visible: sample, hidden: terrainHeight)`, () => {
      const pos = terrains[name].getAttribute('position');
      for (let i = 0; i < pos.count; i += 7) {
        const x = pos.getX(i);
        const y = -pos.getZ(i);
        w.sample(x, y, NaN, hit);
        const visible = hit.zone === 'terrain' || hit.zone === 'field';
        expect(Math.abs(pos.getY(i) - (visible ? hit.h : w.terrainHeight(x, y)))).toBeLessThan(1e-4);
      }
    });
  }

  it('world: between vertices the visible terrain is the GroundWorld within a few cm, also between competing loop sections', () => {
    const at = probe(terrains.world, 24);
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const errs: number[] = [];
    let gapWorst = 0;
    let gaps = 0;
    for (let k = 0; k < 150_000; k++) {
      const x = -280 + rnd() * 600;
      const y = -520 + rnd() * 980;
      world.sample(x, y, NaN, hit);
      if (hit.zone !== 'terrain' && hit.zone !== 'field') continue;
      world.project(x, y, NaN, fr);
      if (Math.abs(fr.l) <= outer) continue; // the ribbon draws the band
      const hs = at(x, y);
      expect(hs.length).toBeGreaterThan(0);
      const e = Math.abs(hs[0]! - hit.h);
      errs.push(e);
      // a second loop section within 30 m of this one's runoff edge: the blended embankments (09-04)
      const s0 = fr.s;
      let competing = false;
      for (const [dx, dy] of [[25, 0], [-25, 0], [0, 25], [0, -25]] as const) {
        world.project(x + dx, y + dy, NaN, fr);
        if (Math.abs(fr.l) < outer + 5 && Math.abs(((fr.s - s0 + track.length * 1.5) % track.length) - track.length / 2) < track.length / 2 - 80) competing = true;
      }
      if (competing) {
        gaps++;
        gapWorst = Math.max(gapWorst, e);
      }
    }
    errs.sort((a, b) => a - b);
    const p999 = errs[Math.floor(errs.length * 0.999)]!;
    console.log(`terrain vs GroundWorld: ${errs.length} points, p99 ${(errs[Math.floor(errs.length * 0.99)]! * 1000).toFixed(1)} mm, p99.9 ${(p999 * 1000).toFixed(1)} mm, worst ${(errs[errs.length - 1]! * 1000).toFixed(1)} mm; beside a competing section ${gaps} points, worst ${(gapWorst * 1000).toFixed(1)} mm`);
    expect(gaps).toBeGreaterThan(100);
    expect(p999).toBeLessThan(2 * TOLERANCE);
    expect(errs[errs.length - 1]!).toBeLessThan(0.04);
    expect(gapWorst).toBeLessThan(0.04);
  }, 60_000); // ~5 s alone; the default 5 s timeout fails under the parallel suite

  it('stays below the asphalt, kerbs and apron', () => {
    const at = probe(terrains.world, 24);
    const p: XYZ = { x: 0, y: 0, z: 0 };
    const paved = provingLoop.width / 2 + provingLoop.kerbWidth + 2;
    for (let s = 0; s < track.length; s += 3.1) {
      for (let l = -paved; l <= paved; l += 1.3) {
        track.toWorld(s, l, p);
        for (const h of at(p.x, p.y)) expect(h).toBeLessThan(p.z - 0.01);
      }
    }
  });
});
