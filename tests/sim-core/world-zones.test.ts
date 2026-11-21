/**
 * GroundWorld zones (ARCHITECTURE-M2 §8.1, 10-02): composition and priority, the 0.5 m edge band, patches (split-mu per
 * wheel), roughness seeded from the world id, field flattening and skirts in terrainHeight, inBounds, continuity on a
 * 0.25 m grid over the field and the spur joins, the loop surface bit-identical with and without a world, no allocation.
 */
import { Session } from 'node:inspector/promises';
import { describe, expect, it } from 'vitest';
import type { TrackSample } from '../../src/contracts/track';
import type { GroundHit, WorldDefinition } from '../../src/contracts/world';
import { provingGround } from '../../src/sim-core/content/proving-ground';
import { provingLoop } from '../../src/sim-core/content/proving-loop';
import { buildTrack } from '../../src/sim-core/track/build';
import { buildGroundWorld, LOOP_CORRIDOR } from '../../src/sim-core/world/ground';
import { compileZones, createZoneLocal, SKIRT_DROP, ZONE_EDGE } from '../../src/sim-core/world/zones';

const track = buildTrack(provingLoop);
const world = buildGroundWorld(track, provingGround);
const bare = buildGroundWorld(track, null);
const hit = (): GroundHit => ({ h: 0, base: 0, surface: 'asphalt', zone: '', s: 0, l: 0 });
const set = compileZones(provingGround);
const zone = (id: string) => set.zones.find((z) => z.def.id === id)!;

/** Deliberate ride-street features steeper than 2 cm per 0.1 m (u spans; the M1 RoadFeature shapes): cobble joints,
 *  sleepers, single-wheel steps, the 0.15 m lateral edges of the twist bumps, pothole. */
const STEEP_FEATURES: [number, number][] = [
  [99.5, 160.5],
  [179.5, 215.5],
  [234.5, 251],
  [264.5, 286.5],
  [292.5, 293.5],
];
function inSteepFeature(x: number, y: number): boolean {
  const loc = zone('ride-street').local(x, y, createZoneLocal());
  return Math.abs(loc.w) <= 4 + ZONE_EDGE && STEEP_FEATURES.some(([a, b]) => loc.u >= a && loc.u <= b);
}

/** Worst |h(p + 0.1 e) - h(p)| over a 0.25 m grid, e = x and y; the worst place. */
function worstStep(x0: number, x1: number, y0: number, y1: number, skip: (x: number, y: number) => boolean) {
  const a = hit();
  const b = hit();
  let worst = 0;
  let at = '';
  let n = 0;
  for (let x = x0; x <= x1; x += 0.25)
    for (let y = y0; y <= y1; y += 0.25) {
      if (skip(x, y)) continue;
      world.sample(x, y, NaN, a);
      for (const [dx, dy] of [[0.1, 0], [0, 0.1]] as const) {
        world.sample(x + dx, y + dy, NaN, b);
        const d = Math.abs(b.h - a.h);
        n++;
        if (d > worst) {
          worst = d;
          at = `(${x.toFixed(2)}, ${y.toFixed(2)}) ${a.zone}->${b.zone}`;
        }
      }
    }
  return { worst, at, n };
}

describe('ground world zones', () => {
  it('the loop surface is bit-identical with and without the world away from the spurs', () => {
    const t: TrackSample = { s: 0, x: 0, y: 0, z: 0, heading: 0, curvature: 0, bank: 0, grade: 0 };
    const a = hit();
    const b = hit();
    let n = 0;
    for (let s = 0; s < track.length; s += 1.7) {
      track.sample(s, t);
      for (const l of [-17.4, -8, -4.4, 0, 3, 6.1, 12, 17.4]) {
        const x = t.x - Math.sin(t.heading) * l;
        const y = t.y + Math.cos(t.heading) * l;
        world.sample(x, y, NaN, a);
        if (!(a.s === a.s)) continue; // a spur contributes here
        bare.sample(x, y, NaN, b);
        expect(a.h).toBe(b.h);
        expect(a.base).toBe(b.base);
        expect(a.surface).toBe(b.surface);
        expect(a.s).toBe(b.s);
        n++;
      }
    }
    expect(n).toBeGreaterThan(7000);
  });

  it('priority and the edge band: spurs over the loop corridor, abutting zones meet without a dip', () => {
    const h = hit();
    // the spur start overlays the loop kerb / apron; s and l are NaN there (the plant reads h, not the loop envelope)
    world.sample(95, 6, NaN, h);
    expect(h.zone).toBe('spur-east');
    expect(h.surface).toBe('asphalt');
    expect(h.s).toBeNaN();
    // just outside the spur's start edge, inside the band: a blend of the spur and the loop
    world.sample(85 - ZONE_EDGE / 4, 8.5, NaN, h);
    expect(h.zone).toBe('spur-east');
    world.sample(85 - ZONE_EDGE - 0.01, 8.5, NaN, h);
    expect(h.zone).toBe('loop');
    // apron (prio 2) / street link (prio 2) / ride street (prio 3): heights stay at the annex base +- roughness
    let worst = 0;
    for (let y = 95; y <= 127.5; y += 0.05) {
      world.sample(60, y, NaN, h);
      worst = Math.max(worst, Math.abs(h.h - 0.5));
      expect(h.surface).toBe('asphalt');
    }
    expect(worst).toBeLessThan(0.02);
    // pave patch on the ride street
    world.sample(-240 + 130, 124, NaN, h);
    expect(h.surface).toBe('pave');
    expect(h.zone).toBe('ride-street');
    // on open field: grass, zone 'field'; outside it: terrain
    world.sample(250, 300, NaN, h);
    expect([h.zone, h.surface, h.h]).toEqual(['field', 'grass', 0.5]);
    world.sample(250, 30, NaN, h);
    expect([h.zone, h.surface]).toEqual(['terrain', 'grass']);
  });

  it('split-mu: left wheels on the tiles, right wheels on dry asphalt (per-wheel surface)', () => {
    const h = hit();
    const st = world.station('braking-platform')!;
    // car heading north in the split lane, 200 m along the platform; track 1.6 m, wheelbase 2.8 m
    const x = st.spawn.x;
    const surfaces = [-1.4, 1.4].flatMap((dx) =>
      [0.8, -0.8].map((dy) => {
        world.sample(x - dy, 300 + dx, NaN, h); // left = west = -x for a north heading
        return `${dy > 0 ? 'L' : 'R'}:${h.surface}`;
      }),
    );
    expect(surfaces).toEqual(['L:ceramic-wet', 'R:asphalt', 'L:ceramic-wet', 'R:asphalt']);
    // the four lanes across the tiles
    const lane = (px: number) => world.sample(px, 300, NaN, h).surface;
    expect([140.75, 145.25, 148.6, 150.9, 154.25].map(lane)).toEqual(['asphalt', 'asphalt-wet', 'ceramic-wet', 'asphalt', 'ceramic-wet']);
    // lead-in and safety area are dry
    expect([lane(154.25), world.sample(154.25, 255, NaN, h).surface, world.sample(154.25, 365, NaN, h).surface]).toEqual(['ceramic-wet', 'asphalt', 'asphalt']);
  });

  it('roughness is seeded from the world id: same id same ground, another id another ground', () => {
    const again = buildGroundWorld(track, { ...provingGround, zones: [...provingGround.zones] });
    const other = buildGroundWorld(track, { ...provingGround, id: 'proving-ground-b' } as WorldDefinition);
    const a = hit();
    const b = hit();
    let same = 0;
    let diff = 0;
    let rough = 0;
    for (let k = 0; k < 400; k++) {
      const x = -230 + k * 0.7;
      const y = 300 + (k % 13) * 0.37;
      world.sample(x, y, NaN, a);
      again.sample(x, y, NaN, b);
      same = Math.max(same, Math.abs(a.h - b.h));
      other.sample(x, y, NaN, b);
      diff = Math.max(diff, Math.abs(a.h - b.h));
      rough = Math.max(rough, Math.abs(a.h - a.base));
    }
    expect(same).toBe(0);
    expect(diff).toBeGreaterThan(5e-4);
    expect(rough).toBeGreaterThan(5e-4); // class A on the pad: millimetres
    expect(rough).toBeLessThan(0.01);
  });

  it('terrainHeight: field flat, zone skirts below the zone base, continuous across the field blend', () => {
    expect(world.terrainHeight(250, 300)).toBe(0.5);
    expect(world.terrainHeight(-100, 300)).toBeCloseTo(0.5 - SKIRT_DROP, 12); // under the pad
    expect(world.terrainHeight(150, 200)).toBeCloseTo(0.5 - SKIRT_DROP, 12); // under the platform
    // the loop terrain is unchanged far from the world
    for (const [x, y] of [[0, -250], [-150, -300], [150, -200], [100, -60]] as const) expect(world.terrainHeight(x, y)).toBe(bare.terrainHeight(x, y));
    // terrain steps on a 0.1 m line from the loop edge into the field (field blend, skirts beside the spurs)
    let worst = 0;
    let at = '';
    for (const x of [-120, -64.2, -55.8, -40, 0, 50, 112, 123.9, 200, 290]) {
      let prev = world.terrainHeight(x, LOOP_CORRIDOR + 1);
      for (let y = LOOP_CORRIDOR + 1.1; y < 100; y += 0.1) {
        const t = world.terrainHeight(x, y);
        if (Math.abs(t - prev) > worst) {
          worst = Math.abs(t - prev);
          at = `x ${x} y ${y.toFixed(1)}`;
        }
        prev = t;
      }
    }
    console.log(`[zones] terrain from the loop edge into the field: worst step ${(worst * 1000).toFixed(1)} mm per 0.1 m at ${at}`);
    expect(worst).toBeLessThan(0.02);
  });

  it('continuity: no step > 2 cm per 0.1 m on a 0.25 m grid over the field and round both spur joins', () => {
    const f = provingGround.field;
    const t0 = performance.now();
    const fieldRes = worstStep(f.minX, f.maxX, f.minY - f.blend, f.maxY, inSteepFeature);
    const east = worstStep(78, 128, 4, 66, () => false);
    const west = worstStep(-70, -18, 4, 66, () => false);
    console.log(
      `[zones] 0.25 m grid, 0.1 m steps: field ${(fieldRes.worst * 1000).toFixed(1)} mm at ${fieldRes.at} (${fieldRes.n} pairs, ride-street steep features excluded); ` +
        `east spur join ${(east.worst * 1000).toFixed(1)} mm at ${east.at}; west spur join ${(west.worst * 1000).toFixed(1)} mm at ${west.at} (${((performance.now() - t0) / 1000).toFixed(1)} s)`,
    );
    expect(fieldRes.worst).toBeLessThan(0.02);
    expect(east.worst).toBeLessThan(0.02);
    expect(west.worst).toBeLessThan(0.02);
  }, 300_000);

  it('inBounds: loop corridor + 60 m, field + 40 m, 30 m round the zones', () => {
    expect(world.inBounds(0, -59)).toBe(true);
    expect(world.inBounds(0, 30)).toBe(true);
    expect(world.inBounds(-299, 300)).toBe(true); // field - 39
    expect(world.inBounds(-301, 300)).toBe(false);
    expect(world.inBounds(0, 481)).toBe(false);
    expect(world.inBounds(341, 100)).toBe(false);
    expect(world.inBounds(0, -300)).toBe(false); // inside the loop, > 60 m from it
    expect(bare.inBounds(0, 200)).toBe(false);
  });

  it('sample does not allocate (sampling heap profile over the annex, spurs, loop and field blend)', async () => {
    const h = hit();
    const px = new Float64Array([-100, 100, 95, -110, 150, 0, 50, -30, 250, 100, -60, -170]);
    const py = new Float64Array([300, 30, 6, 124, 300, 40, -20, 8, 300, 50, 40, 280]);
    const run = (n: number): number => {
      let acc = 0;
      for (let k = 0; k < n; k++) {
        const i = k % 12;
        acc += world.sample(px[i]! + (k % 17) * 0.01, py[i]!, NaN, h).h;
      }
      return acc;
    };
    run(300_000);
    const t0 = performance.now();
    const N = 200_000;
    run(N);
    const us = ((performance.now() - t0) * 1000) / N;
    const session = new Session();
    session.connect();
    await session.post('HeapProfiler.enable');
    await session.post('HeapProfiler.startSampling', { samplingInterval: 64 });
    run(N);
    const { profile } = await session.post('HeapProfiler.stopSampling');
    session.disconnect();
    let bytes = 0;
    const sites = new Set<string>();
    const walk = (node: typeof profile.head): void => {
      if (node.selfSize > 0 && node.callFrame.url.includes('/src/sim-core/')) {
        bytes += node.selfSize;
        sites.add(`${node.callFrame.functionName}@${node.callFrame.url.split('/src/')[1]}:${node.callFrame.lineNumber + 1}`);
      }
      node.children.forEach(walk);
    };
    walk(profile.head);
    console.log(`[zones] sample: ${us.toFixed(2)} us/call over mixed points; sampled sim-core allocation ${bytes} B over ${N} calls (${[...sites].join(', ') || 'no sites'})`);
    expect(bytes / N).toBeLessThan(0.1);
  });
});
