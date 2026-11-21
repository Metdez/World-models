import { describe, expect, it } from 'vitest';
import { type BufferGeometry, InstancedMesh, Matrix4, Vector3 } from 'three';
import type { Registries } from '../../src/contracts/app';
import type { GroundHit, WorldDefinition } from '../../src/contracts/world';
import feature, { annexChunks, facilityPlacement } from '../../src/features/proving-ground/index';
import { annexMarkings, buildMarkings, grassEdges, MARK_LIFT } from '../../src/features/proving-ground/markings';
import { coneGeometry, createFacility } from '../../src/features/proving-ground/props';
import { buildZoneMesh, tarmacTone } from '../../src/features/proving-ground/surface';
import { buildRibbon } from '../../src/features/track/ribbon';
import { provingGround } from '../../src/sim-core/content/proving-ground';
import { provingLoop } from '../../src/sim-core/content/proving-loop';
import { buildTrack } from '../../src/sim-core/track/build';
import { buildGroundWorld } from '../../src/sim-core/world/ground';
import { compileZones, createZoneLocal } from '../../src/sim-core/world/zones';

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

  it('high: between vertices the drawn zones match the GroundWorld; each point is drawn once, with its surface material', () => {
    const report: string[] = [];
    const probes = meshes.high.chunks.map((c) => probe(c.geometry));
    const p = { x: 0, y: 0 };
    const slot = { asphalt: 0, kerb: 0, grass: 0, pave: 1, 'asphalt-wet': 2, 'ceramic-wet': 3 } as const;
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let twice = 0;
    let points = 0;
    for (const z of zones) {
      let worst = 0;
      const perKind: Record<string, number> = {};
      const features = z.def.features ?? [];
      for (let k = 0; k < 20_000; k++) {
        const u = rnd() * z.length;
        const w = (rnd() * 2 - 1) * (z.halfWidth - 0.05);
        z.toWorld(u, w, p);
        const hs = probes.flatMap((pr) => pr(p.x, p.y));
        points++;
        expect(hs.length).toBeGreaterThan(0); // no holes inside a footprint
        if (hs.length > 1) twice++;
        world.sample(p.x, p.y, NaN, hit);
        expect(hs[0]!.group).toBe(slot[hit.surface]);
        const e = Math.max(...hs.map((q) => Math.abs(q.h - hit.h)));
        const on = features.find((f) => f.kind !== 'vertical-curve' && f.kind !== 'kerb-strike' && u >= f.s - 0.5 && u <= f.s + ('length' in f ? f.length : 0) + (f.kind === 'humps' ? f.count * f.spacing : 0) + 0.5);
        if (on) perKind[on.kind] = Math.max(perKind[on.kind] ?? 0, e);
        else worst = Math.max(worst, e);
      }
      report.push(`${z.def.id} ${(worst * 1000).toFixed(1)} mm${features.length ? ` (${Object.entries(perKind).map(([k, v]) => `${k} ${(v * 1000).toFixed(1)}`).join(', ')})` : ''}`);
      expect(worst).toBeLessThan(0.008);
      for (const [kind, e] of Object.entries(perKind)) expect(e).toBeLessThan(kind === 'pave' ? 0.02 : 0.005);
    }
    console.log(`zone mesh vs GroundWorld between vertices (high), worst: ${report.join('; ')}`);
    // points exactly on a shared triangle edge count twice; overlapping zone meshes would make it common
    expect(twice / points).toBeLessThan(0.002);
  });

  it('the link roads cover the loop ribbon where they overlay it (no hole between the two meshes)', () => {
    const ribbon = buildRibbon(track, 0.25, true, { world, zones });
    const top = [probe(ribbon.geometry, 40), ...meshes.low.chunks.map((c) => probe(c.geometry))];
    const loc = createZoneLocal();
    const fr = { s: 0, l: 0, heading: 0, curvature: 0, converged: true };
    const p = { x: 0, y: 0 };
    let n = 0;
    for (const z of zones.filter((q) => q.def.shape.kind === 'path'))
      for (let u = -0.4; u < z.length; u += 0.37)
        for (let w = -z.halfWidth - 0.4; w <= z.halfWidth + 0.4; w += 0.29) {
          z.toWorld(u, w, p);
          world.project(p.x, p.y, NaN, fr);
          if (Math.abs(fr.l) > 18) continue;
          n++;
          const hs = top.flatMap((pr) => pr(p.x, p.y).map((q) => q.h));
          expect(hs.length).toBeGreaterThan(0);
          // inside the footprint only the link road draws
          if (z.local(p.x, p.y, loc).inside > 0.05) expect(Math.max(...hs) - Math.min(...hs)).toBeLessThan(0.01);
        }
    expect(n).toBeGreaterThan(500);
  });
});

describe('budgets', () => {
  it('draw calls and triangles per tier', () => {
    const cones = provingGround.props.filter((p) => p.kind === 'cone').length;
    const caps = { low: 100_000, medium: 160_000, high: 230_000 };
    for (const tier of TIERS) {
      const { chunks, ms } = meshes[tier];
      const tris = chunks.reduce((n, c) => n + c.triangles, 0);
      // ground groups + markings + cones (instanced) + signs; N8AO's prepass (high) draws each again, shadows the casters
      const draws = chunks.reduce((n, c) => n + c.geometry.groups.length, 0) + 3;
      const cone = coneGeometry().getAttribute('position').count / 3;
      console.log(`${tier}: annex ${draws} draws per pass, ground ${tris} triangles + ${cones} cones x ${cone}, built in ${ms.toFixed(0)} ms`);
      expect(draws * 2 + 2).toBeLessThanOrEqual(25);
      expect(tris).toBeLessThan(caps[tier]);
    }
    // the distant level of detail (beyond each chunk's bounding sphere + 120 m)
    const far = annexChunks(zones).map((c) => buildZoneMesh(world, zones, c, 'far'));
    const farTris = far.reduce((n, c) => n + c.triangles, 0);
    console.log(`far LOD: ${farTris} triangles`);
    expect(farTris).toBeLessThan(25_000);
    for (const { geometry } of far) {
      const pos = geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i += 5) expect(Math.abs(pos.getY(i) - groundH(pos.getX(i), -pos.getZ(i)))).toBeLessThan(0.001);
    }
  });
});

describe('markings and props', () => {
  it('markings lie MARK_LIFT above the GroundWorld; the circle and every cone are painted', () => {
    const strips = annexMarkings(provingGround, zones);
    const g = buildMarkings(world, strips);
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i += 3) expect(Math.abs(pos.getY(i) - MARK_LIFT - groundH(pos.getX(i), -pos.getZ(i)))).toBeLessThan(1e-4);
    const circle = provingGround.props.find((p) => p.kind === 'circle')!;
    const onCircle = strips.filter((s) => s.points.every(([x, y]) => Math.abs(Math.hypot(x - circle.x, y - circle.y) - circle.radius) < 1e-6));
    expect(onCircle.length).toBe(1);
    // every slalom cone has its spot ring, every gate post pair a gate line
    const cones = provingGround.props.filter((p) => p.kind === 'cone');
    const near = (px: number, py: number, d: number) =>
      strips.some((s) =>
        s.points.some(([x0, y0], i) => {
          const [x1, y1] = s.points[Math.min(i + 1, s.points.length - 1)]!;
          const L2 = (x1 - x0) ** 2 + (y1 - y0) ** 2;
          const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - x0) * (x1 - x0) + (py - y0) * (y1 - y0)) / L2)) : 0;
          return Math.hypot(px - x0 - t * (x1 - x0), py - y0 - t * (y1 - y0)) < d;
        }),
      );
    for (const c of cones) expect(near(c.x, c.y, 0.5)).toBe(true);
    // the braking lanes: a line at every lane edge of the wet patches
    const bp = zones.find((z) => (z.def.patches?.length ?? 0) > 0 && !(z.def.features?.length ?? 0))!;
    for (const w of [4.5, 0, -4.5, -9]) {
      const p = { x: 0, y: 0 };
      bp.toWorld(200, w, p);
      expect(near(p.x, p.y, 0.01)).toBe(true);
    }
  });
});

describe('11-05 facility look', () => {
  it('edge treatment only where the paving meets grass: the dynamics pad has a gap at the pad link, the kerb rises', () => {
    const pad = zones.find((z) => z.def.id === 'dynamics-pad')!;
    const edges = grassEdges(pad, world);
    // the u = 0 end (towards the ride street) is broken by the pad link (10 m wide)
    const south = edges.filter((e) => e.side === 'u' && e.at === 0);
    expect(south.length).toBe(2);
    const gap = Math.max(...south.map((e) => e.from)) - Math.min(...south.map((e) => e.to));
    expect(gap).toBeGreaterThan(8);
    expect(gap).toBeLessThan(14);
    const strips = annexMarkings(provingGround, zones, world);
    const kerb = strips.filter((s) => s.lift === 0.04);
    expect(kerb.length).toBeGreaterThan(5);
    // the gravel margin lies on the field (inner points: a run's ends sit at a corner)
    const gravel = strips.filter((s) => s.width > 2);
    expect(gravel.length).toBe(kerb.length);
    for (const s of gravel) for (const [x, y] of s.points.slice(1, -1)) expect(world.sample(x, y, NaN, hit).surface, `${x.toFixed(2)},${y.toFixed(2)} ${hit.zone}`).toBe('grass');
    // the steering circle gets radius rings (every 10 m) and the centre cross
    const circle = provingGround.props.find((p) => p.kind === 'circle')!;
    for (const r of [10, 20, 30, 50, 60]) expect(strips.some((s) => s.points.length > 20 && s.points.every(([x, y]) => Math.abs(Math.hypot(x - circle.x, y - circle.y) - r) < 1e-6))).toBe(true);
  });

  it('tarmac tone is subtle and deterministic', () => {
    const pad = zones.find((z) => z.def.id === 'dynamics-pad')!;
    let lo = Infinity;
    let hi = -Infinity;
    for (let x = -240; x < 80; x += 3.7)
      for (let y = 145; y < 335; y += 4.1) {
        const t = tarmacTone(pad, x, y);
        lo = Math.min(lo, t);
        hi = Math.max(hi, t);
      }
    expect(lo).toBeGreaterThanOrEqual(0.91);
    expect(hi).toBeLessThanOrEqual(1.09);
    expect(hi - lo).toBeGreaterThan(0.05);
    expect(tarmacTone(pad, -50.5, 200.25)).toBe(tarmacTone(pad, -50.5, 200.25));
  });

  it('poles, boards and the hut stand on grass; the treeline never on paving or the loop corridor', () => {
    const meshes = createFacility(world, facilityPlacement(world, zones, provingGround.field ?? null));
    const names = meshes.map((m) => m.name);
    expect(names).toContain('annex-poles');
    expect(names).toContain('annex-facility');
    expect(names.filter((n) => n.startsWith('annex-treeline')).length).toBeGreaterThanOrEqual(3);
    const m4 = new Matrix4();
    const v = new Vector3();
    for (const mesh of meshes) {
      if (!(mesh instanceof InstancedMesh)) continue;
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m4);
        v.setFromMatrixPosition(m4);
        world.sample(v.x, -v.z, NaN, hit);
        expect(hit.surface, `${mesh.name} ${i}`).toBe('grass');
        if (mesh.name.startsWith('annex-treeline')) expect(Number.isNaN(hit.s)).toBe(true);
      }
    }
    const hut = facilityPlacement(world, zones, provingGround.field ?? null).hut!;
    for (const [dx, dy] of [[-5, -3], [5, 3], [-5, 3], [5, -3]] as const) expect(world.sample(hut.x + dx, hut.y + dy, NaN, hit).surface).toBe('grass');
  });
});
