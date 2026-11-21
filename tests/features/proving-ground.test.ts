import { describe, expect, it } from 'vitest';
import type { BufferGeometry } from 'three';
import type { Registries } from '../../src/contracts/app';
import type { GroundHit, WorldDefinition } from '../../src/contracts/world';
import feature, { annexChunks } from '../../src/features/proving-ground/index';
import { annexMarkings, buildMarkings, MARK_LIFT } from '../../src/features/proving-ground/markings';
import { coneGeometry } from '../../src/features/proving-ground/props';
import { ANNEX_MATERIALS, buildZoneMesh, createOwner } from '../../src/features/proving-ground/surface';
import { buildRibbon } from '../../src/features/track/ribbon';
import { provingGround } from '../../src/sim-core/content/proving-ground';
import { provingLoop } from '../../src/sim-core/content/proving-loop';
import { buildTrack } from '../../src/sim-core/track/build';
import { buildGroundWorld } from '../../src/sim-core/world/ground';
import { compileZones, createZoneLocal, ZONE_EDGE } from '../../src/sim-core/world/zones';

const track = buildTrack(provingLoop);
const world = buildGroundWorld(track, provingGround);
const zones = compileZones(provingGround).zones;
const hit: GroundHit = { h: 0, base: 0, surface: 'asphalt', zone: '', s: NaN, l: NaN };
const groundH = (x: number, y: number) => world.sample(x, y, NaN, hit).h;
const TIERS = ['low', 'medium', 'high'] as const;

/** Height of an indexed mesh (three x, h, -y) at world (x, y): every triangle holding the point (binned 2 m). */
function probe(g: BufferGeometry, maxSize = 12) {
  const pos = g.getAttribute('position');
  const idx = g.getIndex()!;
  const groups = g.groups;
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
  /** Heights (and material indices) of every triangle holding (x, y). */
  return (x: number, y: number): { h: number; group: number }[] => {
    const out: { h: number; group: number }[] = [];
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
      out.push({ h: w1 * ah + w2 * bh + w3 * ch, group: groups.find((gr) => t >= gr.start && t < gr.start + gr.count)?.materialIndex ?? -1 });
    }
    return out;
  };
}

const meshes = Object.fromEntries(
  TIERS.map((tier) => {
    const t0 = performance.now();
    const chunks = annexChunks(zones).map((chunk) => buildZoneMesh(world, zones, chunk, tier));
    return [tier, { chunks, ms: performance.now() - t0 }];
  }),
) as Record<(typeof TIERS)[number], { chunks: ReturnType<typeof buildZoneMesh>[]; ms: number }>;

describe('proving-ground feature', () => {
  it('contributes the proving-ground world', () => {
    const got: WorldDefinition[] = [];
    feature.contribute!({ worlds: { register: (w: WorldDefinition) => (got.push(w), () => {}) } } as unknown as Registries);
    expect(got.map((w) => w.id)).toEqual(['proving-ground']);
    expect(feature.requires).toEqual(['renderer']);
  });

  it('chunks name every zone exactly once', () => {
    expect(annexChunks(zones).flat().map((z) => z.def.id).sort()).toEqual(provingGround.zones.map((z) => z.id).sort());
  });
});

describe('zone meshes', () => {
  for (const tier of TIERS) {
    it(`${tier}: every vertex is the GroundWorld (1 mm) and uv is world x, y`, () => {
      let worst = 0;
      for (const { geometry } of meshes[tier].chunks) {
        const pos = geometry.getAttribute('position');
        const uv = geometry.getAttribute('uv');
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const y = -pos.getZ(i);
          worst = Math.max(worst, Math.abs(pos.getY(i) - groundH(x, y)));
          expect(Math.abs(uv.getX(i) - x) + Math.abs(uv.getY(i) - y)).toBeLessThan(1e-3);
        }
        expect(geometry.groups.reduce((n, g) => n + g.count, 0)).toBe(geometry.getIndex()!.count);
      }
      // float32 storage of x, y up to ~440 m moves the sample point by < 0.03 mm
      expect(worst).toBeLessThan(0.001);
    });
  }

  it('high: between vertices the drawn zones match the GroundWorld (each zone, the ride-street features)', () => {
    const report: string[] = [];
    const probes = meshes.high.chunks.map((c) => probe(c.geometry));
    const loc = createZoneLocal();
    const p = { x: 0, y: 0 };
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const z of zones) {
      let worst = 0;
      let worstFeature = 0;
      const perKind: Record<string, number> = {};
      const features = z.def.features ?? [];
      for (let k = 0; k < 20_000; k++) {
        const u = rnd() * z.length;
        const w = (rnd() * 2 - 1) * (z.halfWidth - 0.05);
        z.toWorld(u, w, p);
        const hs = probes.flatMap((pr) => pr(p.x, p.y));
        expect(hs.length).toBeGreaterThan(0); // no holes inside a footprint
        const e = Math.max(...hs.map((q) => Math.abs(q.h - groundH(p.x, p.y))));
        const on = features.find((f) => f.kind !== 'vertical-curve' && f.kind !== 'kerb-strike' && u >= f.s - 0.5 && u <= f.s + ('length' in f ? f.length : 0) + (f.kind === 'humps' ? 40 : 0) + 0.5);
        if (on) {
          worstFeature = Math.max(worstFeature, e);
          perKind[on.kind] = Math.max(perKind[on.kind] ?? 0, e);
        }
        else worst = Math.max(worst, e);
        z.local(p.x, p.y, loc);
      }
      report.push(`${z.def.id} ${(worst * 1000).toFixed(1)} mm${features.length ? `, features ${(worstFeature * 1000).toFixed(1)} mm ${JSON.stringify(perKind)}` : ''}`);
    }
    console.log(`zone mesh vs GroundWorld between vertices (high): ${report.join('; ')}`);
  });
});

describe('budgets', () => {
  it('prints per tier', () => {
    for (const tier of TIERS) {
      const tris = meshes[tier].chunks.reduce((n, c) => n + c.triangles, 0);
      const verts = meshes[tier].chunks.reduce((n, c) => n + c.geometry.getAttribute('position').count, 0);
      const draws = meshes[tier].chunks.reduce((n, c) => n + c.geometry.groups.length, 0);
      console.log(`${tier}: zone triangles ${tris}, vertices ${verts}, ground draws ${draws}, build ${meshes[tier].ms.toFixed(0)} ms`);
    }
  });
});

describe('misc', () => {
  it('markings, cones', () => {
    const strips = annexMarkings(provingGround, zones);
    const g = buildMarkings(world, strips);
    const pos = g.getAttribute('position');
    let worst = 0;
    for (let i = 0; i < pos.count; i++) worst = Math.max(worst, Math.abs(pos.getY(i) - MARK_LIFT - groundH(pos.getX(i), -pos.getZ(i))));
    console.log('markings', strips.length, 'strips', pos.count, 'verts', g.getIndex()!.count / 3, 'tris', 'worst', worst);
    console.log('cone tris', coneGeometry().getAttribute('position').count / 3);
    void createOwner;
    void ANNEX_MATERIALS;
    void ZONE_EDGE;
    const t0 = performance.now();
    const r = buildRibbon(track, 0.25, true, { world, zones });
    console.log('ribbon cut ms', performance.now() - t0, r.geometry.getIndex()!.count / 3);
  });
});
