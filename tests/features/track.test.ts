import { describe, expect, it } from 'vitest';
import { QUALITY_PRESETS } from '../../src/contracts/app';
import type { XYZ } from '../../src/contracts/units';
import { buildRibbon, CHUNKS, featureZones, SURFACES } from '../../src/features/track/ribbon';
import { buildTerrain } from '../../src/features/track/terrain';
import { provingLoop } from '../../src/sim-core/content/proving-loop';
import { buildTrack } from '../../src/sim-core/track/build';

const track = buildTrack(provingLoop);
const ribbons = {
  low: buildRibbon(track, QUALITY_PRESETS.low.trackResolution, false),
  high: buildRibbon(track, QUALITY_PRESETS.high.trackResolution, true),
};
const outer = provingLoop.width / 2 + provingLoop.kerbWidth + provingLoop.runoff;

describe('track ribbon', () => {
  for (const [tier, { geometry }] of Object.entries(ribbons)) {
    it(`${tier}: every vertex is the simulation's road surface at its (s, l)`, () => {
      const pos = geometry.getAttribute('position');
      const uv = geometry.getAttribute('uv');
      const p: XYZ = { x: 0, y: 0, z: 0 };
      let worst = 0;
      for (let i = 0; i < pos.count; i++) {
        const l = uv.getX(i);
        const s = uv.getY(i);
        track.toWorld(s, l, p);
        // three = (x, z, -y); float32 storage of coordinates up to a few hundred metres.
        worst = Math.max(worst, Math.abs(pos.getX(i) - p.x), Math.abs(pos.getZ(i) + p.y));
        expect(Math.abs(pos.getY(i) - track.roadHeight(s, l))).toBeLessThan(1e-5);
        expect(Math.abs(pos.getY(i) - p.z)).toBeLessThan(1e-5);
      }
      expect(worst).toBeLessThan(1e-4);
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
      // Integral of (1 - kappa l) dl over a symmetric section is its width, so the plan area is L x width.
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

describe('terrain', () => {
  it('stays below the asphalt, kerbs and apron and meets the runoff edge within a few cm', () => {
    const geometry = buildTerrain(track);
    const pos = geometry.getAttribute('position');
    expect(pos.count).toBeLessThan(60_000);
    for (let i = 0; i < pos.count; i++) expect(Number.isFinite(pos.getY(i))).toBe(true);
    // Interpolate the terrain grid (sim x, y; same diagonal split as buildTerrain) under the paved bands.
    const xs = new Set<number>();
    const ys = new Set<number>();
    for (let i = 0; i < pos.count; i++) {
      xs.add(pos.getX(i));
      ys.add(-pos.getZ(i));
    }
    const ax = [...xs].sort((a, b) => a - b);
    const ay = [...ys].sort((a, b) => a - b);
    const w = ax.length;
    const cell = (v: readonly number[], x: number) => v.findIndex((a, k) => a <= x && v[k + 1]! > x);
    const heightAt = (x: number, y: number): number => {
      const i = cell(ax, x);
      const j = cell(ay, y);
      const fx = (x - ax[i]!) / (ax[i + 1]! - ax[i]!);
      const fy = (y - ay[j]!) / (ay[j + 1]! - ay[j]!);
      const h = (r: number, c: number) => pos.getY(r * w + c);
      const [h00, h10, h01, h11] = [h(j, i), h(j, i + 1), h(j + 1, i), h(j + 1, i + 1)];
      return fx + fy <= 1 ? h00 + fx * (h10 - h00) + fy * (h01 - h00) : h11 + (1 - fx) * (h01 - h11) + (1 - fy) * (h10 - h11);
    };
    const p: XYZ = { x: 0, y: 0, z: 0 };
    const paved = provingLoop.width / 2 + provingLoop.kerbWidth + 2;
    for (let s = 0; s < track.length; s += 3.1) {
      for (let l = -paved; l <= paved; l += 1.3) {
        track.toWorld(s, l, p);
        expect(heightAt(p.x, p.y)).toBeLessThan(p.z - 0.01);
      }
    }
  });
});
