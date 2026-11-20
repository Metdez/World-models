import { Group, Mesh, TextureLoader } from 'three';
import type { FeatureModule } from '../../contracts/app';
import { RENDER } from '../../contracts/services';
import { provingLoop } from '../../sim-core/content/proving-loop';
import { createMaterials, setAnisotropy, TEXTURE_ASSETS, type TrackTextures } from './materials';
import { createCones, createSignboards } from './props';
import { buildRibbon, SURFACES } from './ribbon';
import { buildTerrain } from './terrain';

/**
 * Contributes the proving loop (02-04) and draws it (03-01): the road ribbon sampled from the simulation's own
 * `roadHeight`, terrain to the horizon, cones and section signboards. Static: no per-frame work.
 */
export default {
  id: 'track',
  requires: ['renderer'],
  phase: 'scene',
  contribute(r) {
    r.tracks.register(provingLoop);
  },
  async init(ctx) {
    const render = ctx.services.get(RENDER);
    const track = ctx.sim.current.track;
    // §10: the ribbon resolution is fixed by the tier active at boot.
    const quality = render.quality;
    const loader = new TextureLoader();
    const entries = await Promise.all(
      Object.entries(TEXTURE_ASSETS).map(async ([key, id]) => [key, await loader.loadAsync(ctx.assets.url(id))] as const),
    );
    const textures = Object.fromEntries(entries) as unknown as TrackTextures;
    setAnisotropy(textures, quality.anisotropy);
    const materials = createMaterials(track, textures);

    const root = new Group();
    root.name = 'track';
    const ribbon = buildRibbon(track, quality.trackResolution, ctx.store.get().quality === 'high');
    const surfaceMaterials = SURFACES.map((s) => materials[s]);
    const road = ribbon.chunks.map((g, i) => {
      const mesh = new Mesh(g, surfaceMaterials);
      mesh.name = `track-ribbon-${i}`;
      mesh.receiveShadow = true;
      // Road first, field last: the hidden ground under the road then fails the depth test early.
      mesh.renderOrder = -1;
      return mesh;
    });
    const ground = new Mesh(buildTerrain(track), materials.grass);
    ground.name = 'track-terrain';
    ground.receiveShadow = true;
    ground.renderOrder = 1;
    root.add(...road, ground);
    const cones = createCones(track);
    if (cones) root.add(cones);
    root.add(await createSignboards(track));
    for (const o of [...road, ground]) o.matrixAutoUpdate = false;

    ctx.addDisposer(render.add(root));
    ctx.addDisposer(() => {
      root.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          (m as { map?: { dispose(): void } | null }).map?.dispose();
          m.dispose();
        }
      });
      for (const t of Object.values(textures)) t.dispose();
    });
    ctx.watch(() => setAnisotropy(textures, render.quality.anisotropy));
  },
} satisfies FeatureModule;
