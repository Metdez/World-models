/**
 * Proving-ground content (ARCHITECTURE-M2 §8.3, 10-02) against the REAL loop and the 09-04 ground: spur ends within
 * 1 cm / 0.01 deg of §8.3 and tangent to the loop where they join it, the annex >= 40 m from the loop centreline except
 * the spurs, the ISO 3888-2 gates, slalom and circle, every station spawn on asphalt and inside its zone, and a plant
 * drive across each spur with no NaN and no road-input step above 3 cm.
 */
import { describe, expect, it } from 'vitest';
import type { TrackSample } from '../../src/contracts/track';
import type { GroundHit, GroundWorld, WorldProp } from '../../src/contracts/world';
import { gtCoupe } from '../../src/sim-core/content/gt-coupe';
import { provingGround } from '../../src/sim-core/content/proving-ground';
import { provingLoop } from '../../src/sim-core/content/proving-loop';
import { buildTrack } from '../../src/sim-core/track/build';
import { buildGroundWorld } from '../../src/sim-core/world/ground';
import { compileZones, createZoneLocal } from '../../src/sim-core/world/zones';
import { finiteFrame } from '../fixtures/08-02-drive';
import { rig, speedHold } from '../fixtures/09-04-handling';

const track = buildTrack(provingLoop);
const world = buildGroundWorld(track, provingGround);
const set = compileZones(provingGround);
const zone = (id: string) => set.zones.find((z) => z.def.id === id)!;
const hit = (): GroundHit => ({ h: 0, base: 0, surface: 'asphalt', zone: '', s: 0, l: 0 });
const frenet = () => ({ s: 0, l: 0, heading: 0, curvature: 0, converged: true });
const DEG = 180 / Math.PI;
const wrapDeg = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

/** World pose (x, y, heading deg) at zone-local u on the centreline. */
function poseAt(id: string, u: number) {
  const z = zone(id);
  const a = { x: 0, y: 0 };
  const b = { x: 0, y: 0 };
  z.toWorld(u - 0.005, 0, a);
  z.toWorld(u + 0.005, 0, b);
  const p = { x: 0, y: 0 };
  z.toWorld(u, 0, p);
  return { x: p.x, y: p.y, heading: Math.atan2(b.y - a.y, b.x - a.x) * DEG };
}

describe('proving-ground layout on the real loop', () => {
  it('spur ends within 1 cm / 0.01 deg of §8.3; both meet the loop tangentially beside its road edge', () => {
    const ends = {
      'spur-east': [{ x: 85, y: 8.5, heading: 0 }, { x: 117.85, y: 60, heading: 90 }],
      'spur-west': [{ x: -60, y: 60, heading: -90 }, { x: -27.15, y: 8.5, heading: 0 }],
    } as const;
    const rows: string[] = [];
    for (const [id, [start, end]] of Object.entries(ends)) {
      const z = zone(id);
      for (const [u, want] of [[0, start], [z.length, end]] as const) {
        const got = poseAt(id, u);
        const d = Math.hypot(got.x - want.x, got.y - want.y);
        rows.push(`${id} u ${u.toFixed(2)}: (${got.x.toFixed(4)}, ${got.y.toFixed(4)}) ${got.heading.toFixed(4)} deg, off ${(d * 1000).toFixed(2)} mm`);
        expect(d).toBeLessThan(0.01);
        expect(Math.abs(wrapDeg(got.heading - want.heading))).toBeLessThan(0.01);
      }
      // the loop end: tangent to the loop centreline, centre 8.5 m off it (the spur's near edge on the road edge)
      const joinU = id === 'spur-east' ? 0 : z.length;
      const p = poseAt(id, joinU);
      const fr = world.project(p.x, p.y, NaN, frenet());
      const t: TrackSample = { s: 0, x: 0, y: 0, z: 0, heading: 0, curvature: 0, bank: 0, grade: 0 };
      track.sample(fr.s, t);
      rows.push(`${id} joins the loop at s ${fr.s.toFixed(1)} l ${fr.l.toFixed(3)}, heading diff ${wrapDeg(p.heading - t.heading * DEG).toFixed(4)} deg`);
      expect(Math.abs(wrapDeg(p.heading - t.heading * DEG))).toBeLessThan(0.01);
      expect(Math.abs(fr.l - (track.def.width / 2 + z.halfWidth))).toBeLessThan(0.01);
    }
    console.log(`[annex] ${rows.join('; ')}`);
  });

  it('the annex keeps >= 40 m from the loop centreline except the spurs (and stays out of the corridor + skirt)', () => {
    const fr = frenet();
    const p = { x: 0, y: 0 };
    const rows: string[] = [];
    let worst = Infinity;
    for (const z of set.zones) {
      if (z.def.shape.kind === 'path') continue;
      let m = Infinity;
      const nu = Math.ceil(z.length);
      const nw = Math.ceil(2 * z.halfWidth);
      for (let i = 0; i <= nu; i++)
        for (let j = 0; j <= nw; j++) {
          z.toWorld((i / nu) * z.length, -z.halfWidth + (j / nw) * 2 * z.halfWidth, p);
          m = Math.min(m, Math.abs(world.project(p.x, p.y, NaN, fr).l));
        }
      rows.push(`${z.def.id} ${m.toFixed(1)} m`);
      worst = Math.min(worst, m);
    }
    const props = provingGround.props.map((q: WorldProp) => Math.abs(world.project(q.x, q.y, NaN, fr).l));
    const spawns = provingGround.stations.map((st) => Math.abs(world.project(st.spawn.x, st.spawn.y, NaN, fr).l));
    const f = provingGround.field;
    let fieldMin = Infinity;
    for (let x = f.minX; x <= f.maxX; x += 1) fieldMin = Math.min(fieldMin, Math.abs(world.project(x, f.minY, NaN, fr).l));
    console.log(`[annex] nearest approach to the loop centreline: ${rows.join(', ')}; props ${Math.min(...props).toFixed(1)} m, spawns ${Math.min(...spawns).toFixed(1)} m; field edge ${fieldMin.toFixed(1)} m (blend reaches ${(fieldMin - f.blend).toFixed(1)} m, corridor 18 m)`);
    expect(worst).toBeGreaterThanOrEqual(40);
    expect(Math.min(...props, ...spawns)).toBeGreaterThanOrEqual(40);
    expect(fieldMin - f.blend).toBeGreaterThan(18 + 1);
  });

  it('dynamics pad furniture: ISO 3888-2 gates, slalom, circle inside the pad', () => {
    const cones = provingGround.props.filter((q) => q.kind === 'cone');
    const lane = cones.filter((c) => c.y > 390);
    const slalom = cones.filter((c) => c.y === 280);
    expect(lane).toHaveLength(18);
    expect(slalom.map((c) => c.x)).toEqual([-90, -65, -40, -15, 10, 35, 60]);
    const W = 1.95;
    const gate = (x: number) => {
      const ys = lane.filter((c) => Math.abs(c.x - x) < 1e-9).map((c) => c.y).sort((a, b) => a - b);
      return { width: ys[1]! - ys[0]!, centre: (ys[0]! + ys[1]!) / 2 };
    };
    for (const x of [-120, -114, -108]) expect(gate(x).width).toBeCloseTo(1.1 * W + 0.25, 9);
    for (const x of [-94.5, -89, -83.5]) {
      expect(gate(x).width).toBeCloseTo(W + 1, 9);
      expect(gate(x).centre).toBeCloseTo(403.6725, 9);
    }
    for (const x of [-71, -65, -59]) expect(gate(x).width).toBeCloseTo(3, 9);
    const circle = provingGround.props.find((q) => q.kind === 'circle')!;
    const pad = zone('dynamics-pad');
    const loc = pad.local(circle.x, circle.y, createZoneLocal());
    expect(loc.inside).toBeGreaterThan(circle.kind === 'circle' ? circle.radius + 10 : 0);
    for (const c of cones) expect(pad.local(c.x, c.y, createZoneLocal()).inside).toBeGreaterThan(10);
    const signs = provingGround.props.filter((q) => q.kind === 'sign');
    expect(signs.map((q) => (q.kind === 'sign' ? q.station : ''))).toEqual(provingGround.stations.map((s) => s.id));
  });

  it('every station spawn is on asphalt, in its zone, >= 10 m from its start / end edges and >= 10 m (or the car fits) from its sides', () => {
    const h = hit();
    const rows: string[] = [];
    for (const st of provingGround.stations) {
      const z = zone(st.zone);
      const loc = z.local(st.spawn.x, st.spawn.y, createZoneLocal());
      const along = Math.min(loc.u, z.length - loc.u);
      const side = z.halfWidth - Math.abs(loc.w);
      rows.push(`${st.id}: ${along.toFixed(1)} m along, ${side.toFixed(1)} m to the side`);
      expect(along).toBeGreaterThanOrEqual(10);
      expect(side).toBeGreaterThanOrEqual(z.halfWidth >= 10 ? 10 : 1.5);
      // the four contact patches of a car at rest there (track 1.6, wheelbase 2.8)
      const c = Math.cos(st.spawn.heading);
      const s = Math.sin(st.spawn.heading);
      for (const [ax, ay] of [[1.4, 0.8], [1.4, -0.8], [-1.4, 0.8], [-1.4, -0.8]] as const) {
        world.sample(st.spawn.x + c * ax - s * ay, st.spawn.y + s * ax + c * ay, NaN, h);
        expect(h.surface).toBe('asphalt');
        expect(h.zone).toBe(st.zone);
      }
    }
    console.log(`[annex] spawns: ${rows.join('; ')}`);
  });
});

/** World wrapper recording every sample (the plant's four wheel queries per step). */
function recording(w: GroundWorld) {
  const rec: number[] = [];
  const wrapped: GroundWorld = {
    ...w,
    def: w.def,
    sample(x, y, hint, out) {
      w.sample(x, y, hint, out);
      rec.push(out.h - out.base);
      return out;
    },
    terrainHeight: (x, y) => w.terrainHeight(x, y),
    project: (x, y, hint, out) => w.project(x, y, hint, out),
    inBounds: (x, y) => w.inBounds(x, y),
    station: (id) => w.station(id),
  };
  return { wrapped, rec };
}

/** Pure pursuit along a polyline (lookahead 8 m) at a held speed; returns the worst per-step change of a wheel's
 *  road input (h - base) and whether everything stayed finite. */
function driveAlong(path: readonly (readonly [number, number])[], speed: number) {
  const { wrapped, rec } = recording(world);
  const r = rig({ world: wrapped });
  const [x0, y0] = path[0]!;
  const [x1, y1] = path[1]!;
  r.launch(speed, 0, x0, y0, Math.atan2(y1 - y0, x1 - x0));
  const hold = speedHold(speed);
  const wheelbase = gtCoupe.wheelbase;
  let idx = 1;
  let worst = 0;
  let worstAt = '';
  let finite = true;
  let prev: number[] | null = null;
  const zones = new Set<string>();
  const out = hit();
  for (let k = 0; k < 240 * 40 && idx < path.length - 1; k++) {
    const v = r.plant.view;
    while (idx < path.length - 1 && Math.hypot(path[idx]![0] - v.x, path[idx]![1] - v.y) < 8) idx++;
    const [tx, ty] = path[idx]!;
    const yaw = Math.atan2(v.sinYaw, v.cosYaw);
    const alpha = Math.atan2(ty - v.y, tx - v.x) - yaw;
    const ld = Math.hypot(tx - v.x, ty - v.y);
    r.cmd.steer = Math.max(-0.5, Math.min(0.5, Math.atan((2 * wheelbase * Math.sin(alpha)) / ld)));
    hold(r);
    rec.length = 0;
    const f = r.step();
    finite &&= finiteFrame(f);
    zones.add(world.sample(v.x, v.y, NaN, out).zone);
    if (rec.length >= 4) {
      const cur = rec.slice(rec.length - 4);
      if (prev)
        for (let i = 0; i < 4; i++) {
          const d = Math.abs(cur[i]! - prev[i]!);
          if (d > worst) {
            worst = d;
            worstAt = `wheel ${i} at (${v.x.toFixed(1)}, ${v.y.toFixed(1)})`;
          }
        }
      prev = cur;
    }
  }
  const v = r.plant.view;
  return { worst, worstAt, finite, faults: r.plant.faults, end: [v.x, v.y] as const, reached: idx >= path.length - 1, zones: [...zones] };
}

/** Points every metre along zone-local u of a spur centreline. */
function spurPoints(id: string, from: number, to: number): [number, number][] {
  const z = zone(id);
  const p = { x: 0, y: 0 };
  const out: [number, number][] = [];
  for (let u = from; u <= to; u += 1) {
    z.toWorld(u, 0, p);
    out.push([p.x, p.y]);
  }
  return out;
}

describe('a plant drive across each spur', () => {
  it('loop -> east spur -> paddock and paddock -> west spur -> loop: no NaN, no fault, no road-input step > 3 cm', () => {
    const east = zone('spur-east');
    const eastPath: [number, number][] = [];
    for (let x = 40; x < 80; x += 1) eastPath.push([x, 2 + ((x - 40) / 40) * 4]);
    eastPath.push(...spurPoints('spur-east', 6, east.length), [117.85, 70], [117.85, 80], [117.85, 90]);
    const west = zone('spur-west');
    const westPath: [number, number][] = [[-60, 85], [-60, 75], [-60, 65], ...spurPoints('spur-west', 0, west.length - 6)];
    for (let x = -30; x < 30; x += 1) westPath.push([x, 8.5 - Math.min(1, (x + 30) / 30) * 6.5]);
    const rows: string[] = [];
    for (const [name, path] of [['east', eastPath], ['west', westPath]] as const) {
      const res = driveAlong(path, 11);
      rows.push(`${name}: reached ${res.reached} at (${res.end[0].toFixed(1)}, ${res.end[1].toFixed(1)}), zones ${res.zones.join('>')}, worst road-input step ${(res.worst * 1000).toFixed(1)} mm (${res.worstAt})`);
      expect(res.finite).toBe(true);
      expect(res.faults).toBe(0);
      expect(res.reached).toBe(true);
      expect(res.worst).toBeLessThan(0.03);
    }
    console.log(`[annex] plant across the spurs at 11 m/s: ${rows.join('; ')}`);
  }, 120_000);
});
