import { it } from 'vitest';
import { provingGround } from '../../src/sim-core/content/proving-ground';
import { provingLoop } from '../../src/sim-core/content/proving-loop';
import { buildTrack } from '../../src/sim-core/track/build';
import { buildGroundWorld } from '../../src/sim-core/world/ground';
import { compileZones } from '../../src/sim-core/world/zones';
import { buildRibbon } from '../../src/features/track/ribbon';
import { annexChunks } from '../../src/features/proving-ground/index';
import { buildZoneMesh } from '../../src/features/proving-ground/surface';
it('t', () => {
  const track = buildTrack(provingLoop);
  const world = buildGroundWorld(track, provingGround);
  const bare = buildGroundWorld(track, null);
  const zones = compileZones(provingGround).zones;
  for (let k = 0; k < 2; k++) {
    for (const [res, fine] of [[1, false], [0.25, true]] as const) {
      let t = performance.now(); buildRibbon(track, res, fine, { world: bare }); const a = performance.now() - t;
      t = performance.now(); buildRibbon(track, res, fine, { world, zones }); const b = performance.now() - t;
      console.log('ribbon', res, 'bare', a.toFixed(0), 'cut', b.toFixed(0));
    }
    for (const tier of ['low', 'high'] as const) { const t = performance.now(); for (const c of annexChunks(zones)) buildZoneMesh(world, zones, c, tier); console.log('zones', tier, (performance.now() - t).toFixed(0)); }
  }
});
