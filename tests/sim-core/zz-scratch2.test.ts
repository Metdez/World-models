import { it } from 'vitest';
import { provingLoop } from '../../src/sim-core/content/proving-loop';
import { buildTrack } from '../../src/sim-core/track/build';
import { buildGroundWorld } from '../../src/sim-core/world/ground';
it('g', () => {
  const track = buildTrack(provingLoop);
  const w = buildGroundWorld(track, null);
  const hit = { h: 0, base: 0, surface: 'asphalt' as const, zone: '', s: 0, l: 0 };
  const ts = { s: 0, x: 0, y: 0, z: 0, heading: 0, curvature: 0, bank: 0, grade: 0 };
  for (const s of [100, 200, 300]) { track.sample(s, ts); w.sample(ts.x, ts.y, s, hit as never); console.log(s, ts.z, track.roadHeight(s, 0), hit); }
});
