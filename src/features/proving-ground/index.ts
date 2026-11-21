import { AgXToneMapping, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, TextureLoader } from 'three';
import type { FeatureModule } from '../../contracts/app';
import { RENDER, type RenderService } from '../../contracts/services';
import { provingGround } from '../../sim-core/content/proving-ground';
import { compileZones, type CompiledZone } from '../../sim-core/world/zones';
import { annexMarkings, buildMarkings } from './markings';
import { createAnnexMaterials, setAnisotropy, TEXTURE_ASSETS, type AnnexTextures } from './materials';
import { createCones, createSigns } from './props';
import { ANNEX_MATERIALS, buildZoneMesh } from './surface';

/** Footprint area above which a zone is drawn as its own mesh (frustum culling), m^2; the rest share one. */
const OWN_CHUNK_AREA = 10_000;

/** Zone meshes are drawn in these pieces (one draw call per material used in each): every large zone alone, the rest
 *  together. */
export function annexChunks(zones: readonly CompiledZone[]): CompiledZone[][] {
  const big = zones.filter((z) => z.length * 2 * z.halfWidth > OWN_CHUNK_AREA);
  return [...big.map((z) => [z]), zones.filter((z) => !big.includes(z))].filter((c) => c.length > 0);
}

/** Sim (x, y, z) of a free test view: eye and target. */
type View = readonly [x: number, y: number, z: number];
declare global {
  /** e2e only (?e2e=1): renders the scene once from a free camera (sim world coordinates) and returns a PNG data URL.
   *  Bypasses the post chain (AgX tone mapping applied by the renderer instead): for overview screenshots only. */
  var __annexView: ((eye: View, target: View, fovDeg?: number, fog?: boolean) => string) | undefined;
}

function installViewHook(render: RenderService): () => void {
  const camera = new PerspectiveCamera(50, 16 / 9, 0.3, 5000);
  globalThis.__annexView = (eye, target, fovDeg = 50, fog = true) => {
    const { renderer, scene } = render;
    const c = renderer.domElement;
    camera.aspect = c.width / Math.max(1, c.height);
    camera.fov = fovDeg;
    camera.position.set(eye[0], eye[2], -eye[1]);
    camera.lookAt(target[0], target[2], -target[1]);
    camera.updateProjectionMatrix();
    const mapping = renderer.toneMapping;
    const sceneFog = scene.fog;
    renderer.toneMapping = AgXToneMapping;
    if (!fog) scene.fog = null;
    renderer.render(scene, camera);
    renderer.toneMapping = mapping;
    scene.fog = sceneFog;
    return c.toDataURL('image/png');
  };
  return () => {
    globalThis.__annexView = undefined;
  };
}

/**
 * Contributes the proving-ground world (10-02 content) and draws it (ARCHITECTURE-M2 §8.4): zone meshes sampled from
 * the simulation's own GroundWorld, wet patches, painted markings, cones and station signs. Static: no per-frame work.
 * Draws whatever world the simulation grounds on (nothing without one).
 */
export default {
  id: 'proving-ground',
  requires: ['renderer'],
  phase: 'scene',
  contribute(r) {
    r.worlds.register(provingGround);
  },
  async init(ctx) {
    const world = ctx.sim.current.world;
    const def = world?.def;
    if (!world || !def?.zones?.length) return;
    const render = ctx.services.get(RENDER);
    const tier = ctx.store.get().quality;
    const loader = new TextureLoader();
    const entries = await Promise.all(
      Object.entries(TEXTURE_ASSETS).map(async ([key, id]) => [key, await loader.loadAsync(ctx.assets.url(id))] as const),
    );
    const textures = Object.fromEntries(entries) as unknown as AnnexTextures;
    setAnisotropy(textures, render.quality.anisotropy);
    const materials = createAnnexMaterials(textures);
    const slots = ANNEX_MATERIALS.map((k) => materials[k]);

    const t0 = performance.now();
    const zones = compileZones(def).zones;
    const root = new Group();
    root.name = 'proving-ground';
    annexChunks(zones).forEach((chunk, i) => {
      const { geometry } = buildZoneMesh(world, zones, chunk, tier);
      const mesh = new Mesh(geometry, slots);
      mesh.name = `annex-ground-${i}`;
      mesh.receiveShadow = true;
      root.add(mesh);
    });
    const paint = new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const markings = new Mesh(buildMarkings(world, annexMarkings(def, zones)), paint);
    markings.name = 'annex-markings';
    markings.receiveShadow = true;
    root.add(markings);
    const cones = createCones(world, def);
    if (cones) root.add(cones);
    performance.measure('proving-ground-meshes', { start: t0, end: performance.now() });
    const signs = await createSigns(world, def);
    if (signs) root.add(signs);
    root.traverse((o) => {
      o.matrixAutoUpdate = false;
      o.updateMatrix();
    });

    ctx.addDisposer(render.add(root));
    if (ctx.flags.e2e) ctx.addDisposer(installViewHook(render));
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
