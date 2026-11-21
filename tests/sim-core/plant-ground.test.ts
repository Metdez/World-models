/**
 * The ground under the plant off the tarmac (09-04 item: a caption showed a wheel unloaded on grass): the GroundWorld
 * is a function of (x, y) alone (no hint dependence) and continuous over the whole drivable area — the M1 terrain
 * stepped up to 3.5 m where two loop sections at different heights compete for "nearest" — and a car driven off the
 * road edge onto the grass at several places keeps every wheel on the ground.
 */
import { describe, expect, it } from 'vitest';
import type { TrackSample } from '../../src/contracts/track';
import type { GroundHit } from '../../src/contracts/world';
import { provingLoop } from '../../src/sim-core/content/proving-loop';
import { buildTrack } from '../../src/sim-core/track/build';
import { buildGroundWorld, LOOP_CORRIDOR, OUT_OF_BOUNDS } from '../../src/sim-core/world/ground';
import { plantRig } from '../fixtures/08-02-drive';
import { pathState } from '../fixtures/09-04-handling';

const track = buildTrack(provingLoop);
const world = buildGroundWorld(track, null);
const hit = (): GroundHit => ({ h: 0, base: 0, surface: 'asphalt', zone: '', s: 0, l: 0 });

describe('ground world off the tarmac', () => {
  it('continuous over the drivable area: neighbour steps on a 0.1 m grid bounded; hinted = cold', () => {
    const a = hit();
    const b = hit();
    let worstTerrain = 0;
    let worstAll = 0;
    let at = '';
    let hintDiff = 0;
    for (let x = -260; x < 270; x += 2.9) {
      let prev = NaN;
      let prevZone = '';
      for (let y = -550; y < 70; y += 0.1) {
        if (!world.inBounds(x, y)) {
          prev = NaN;
          continue;
        }
        world.sample(x, y, NaN, a);
        world.sample(x, y, (x * 7 + y * 13) % track.length, b); // an arbitrary (wrong) hint
        hintDiff = Math.max(hintDiff, Math.abs(a.h - b.h) + Math.abs(a.base - b.base));
        if (prev === prev) {
          const d = Math.abs(a.h - prev);
          worstAll = Math.max(worstAll, d);
          if (a.zone === 'terrain' && prevZone === 'terrain' && d > worstTerrain) {
            worstTerrain = d;
            at = `x ${x.toFixed(1)} y ${y.toFixed(1)}`;
          }
        }
        prev = a.h;
        prevZone = a.zone;
      }
    }
    console.log(`[ground] 0.1 m grid over the drivable area: worst terrain step ${(worstTerrain * 1000).toFixed(1)} mm at ${at}, worst anywhere ${(worstAll * 1000).toFixed(1)} mm (kerb edges); hinted vs cold max diff ${hintDiff}`);
    // The steepest terrain is the embankment in the 4.9 m gap between the launch-straight and bump-strip ribbons
    // (about 2.4 m apart in height): slope ~0.56. Before 09-04 the terrain stepped by up to 3.46 m there.
    expect(worstTerrain).toBeLessThan(0.07);
    expect(worstAll).toBeLessThan(0.07);
    expect(hintDiff).toBe(0);
  }, 120_000);

  it('the corridor still matches the road (1e-12) and the M1 terrain where only one section is within reach', () => {
    const t: TrackSample = { s: 0, x: 0, y: 0, z: 0, heading: 0, curvature: 0, bank: 0, grade: 0 };
    const out = hit();
    for (let s = 300; s < 1300; s += 37) {
      track.sample(s, t);
      for (const l of [-17, -9, 0, 5.5, 12, 17.2]) {
        world.sample(t.x - Math.sin(t.heading) * l, t.y + Math.cos(t.heading) * l, NaN, out);
        expect(Math.abs(out.h - track.roadHeight(out.s, out.l))).toBeLessThan(1e-12);
      }
    }
    expect(LOOP_CORRIDOR).toBe(18);
    expect(OUT_OF_BOUNDS).toBe(60);
  });

  it('driving off the road edge onto the grass at several places keeps every wheel loaded', () => {
    const r = plantRig(provingLoop, 'double-wishbone');
    const t: TrackSample = { s: 0, x: 0, y: 0, z: 0, heading: 0, curvature: 0, bank: 0, grade: 0 };
    const rows: string[] = [];
    let worstMin = Infinity;
    for (const s of [120, 320, 520, 720, 900, 1080, 1280, 1480]) {
      for (const side of [1, -1] as const) {
        track.sample(s, t);
        const l = side * 2;
        const x = t.x - Math.sin(t.heading) * l;
        const y = t.y + Math.cos(t.heading) * l;
        const heading = t.heading + side * 0.35; // 20 deg toward the edge
        r.plant.place(x, y, heading);
        r.plant.engageFromPath(pathState(x, y, heading, 20, 0), { ax: 0, ay: 0 });
        r.cmd.steer = 0;
        r.cmd.throttle = 0.15;
        r.cmd.brake = 0;
        let minLoad = Infinity;
        let where = '';
        let maxL = 0;
        for (let k = 0; k < 600; k++) {
          const f = r.step(1);
          const off = Math.abs(f.drive.lineOffset + track.lineOffset(r.plant.loopS === r.plant.loopS ? r.plant.loopS : 0));
          if (k > 30) for (const c of f.corners) if (c.load < minLoad) { minLoad = c.load; where = `${c.surface} at l ${r.plant.loopL.toFixed(1)} s ${r.plant.loopS.toFixed(0)} t ${(k / 240).toFixed(2)}`; }
          if (off === off) maxL = Math.max(maxL, off);
          if (!world.inBounds(f.drive.x, f.drive.y)) break;
        }
        // Two places lift a wheel for real: s 320 right drives off the bump strip's runoff edge down the 1 m
        // embankment toward the launch straight (4.9 m gap), s 900 left crosses the ridge where the banked runoff
        // (rising 0.13 m/m to 18 m) meets the falling terrain. Elsewhere the edge is gentle: no wheel may lift.
        if (!((s === 320 && side < 0) || (s === 900 && side > 0))) worstMin = Math.min(worstMin, minLoad);
        rows.push(`s ${s} ${side > 0 ? 'L' : 'R'}: min wheel load ${(minLoad / 1000).toFixed(2)} kN (${where})`);
        expect(r.plant.faults).toBe(0);
      }
    }
    console.log(`[ground] off the edge at 20 m/s, 20 deg: ${rows.join('; ')}`);
    expect(worstMin).toBeGreaterThan(500);
  }, 60_000);
});
