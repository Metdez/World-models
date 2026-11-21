import { it } from 'vitest';
import { provingGround } from '../../src/sim-core/content/proving-ground';
import { compileZones } from '../../src/sim-core/world/zones';
import { annexMarkings, buildMarkings } from '../../src/features/proving-ground/markings';
import { facilityPlacement } from '../../src/features/proving-ground/index';
import { createFacility } from '../../src/features/proving-ground/props';
import { buildGroundWorld } from '../../src/sim-core/world/ground';
import { buildTrack } from '../../src/sim-core/track/build';
import { provingLoop } from '../../src/sim-core/content/proving-loop';
it('count', () => {
  const track = buildTrack(provingLoop);
  const world = buildGroundWorld(track, provingGround);
  const zones = compileZones(provingGround).zones;
  const a = buildMarkings(world, annexMarkings(provingGround, zones));
  const b = buildMarkings(world, annexMarkings(provingGround, zones, world));
  console.log('markings old', a.index!.count / 3, 'new', b.index!.count / 3);
  for (const m of createFacility(world, facilityPlacement(world, zones, provingGround.field ?? null))) {
    const g = m.geometry; const t = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    console.log(m.name, t, 'x', (m as any).count ?? 1, '=', t * ((m as any).count ?? 1));
  }
});
