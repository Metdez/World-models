import {
  AgXToneMapping,
  Box3,
  type Camera,
  Group,
  HalfFloatType,
  LOD,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  ShaderMaterial,
  TextureLoader,
  Vector3,
  WebGLRenderTarget,
} from 'three';
import type { FeatureModule } from '../../contracts/app';
import { RENDER, type RenderService } from '../../contracts/services';
import type { TelemetryFrame } from '../../contracts/telemetry';
import { simToThree } from '../../contracts/units';
import type { GroundHit, GroundWorld } from '../../contracts/world';
import { provingGround } from '../../sim-core/content/proving-ground';
import { compileZones, type CompiledZone } from '../../sim-core/world/zones';
import { annexMarkings, buildMarkings, grassEdges } from './markings';
import { createAnnexMaterials, setAnisotropy, TEXTURE_ASSETS, type AnnexTextures } from './materials';
import { createCones, createFacility, createSigns, type FacilityPlacement } from './props';
import { ANNEX_MATERIALS, buildZoneMesh } from './surface';

/** Footprint area above which a zone is drawn as its own mesh (frustum culling, level of detail), m^2. */
const OWN_CHUNK_AREA = 10_000;
/** A chunk switches to its distant level of detail when the camera is this far from its bounding box, m. */
const FAR_LOD = 100;

/** Zone meshes are drawn in these pieces (one draw call per material used in each): every large zone and every zone
 *  with features alone, the rest together. */
export function annexChunks(zones: readonly CompiledZone[]): CompiledZone[][] {
  const own = zones.filter((z) => z.length * 2 * z.halfWidth > OWN_CHUNK_AREA || (z.def.features?.length ?? 0) > 0);
  return [...own.map((z) => [z]), zones.filter((z) => !own.includes(z))].filter((c) => c.length > 0);
}

/** Two levels of detail switched on the camera's distance to the chunk's bounding box (three's LOD measures to the
 *  object's origin, which misjudges long or large chunks). */
class BoxLOD extends LOD {
  private readonly eye = new Vector3();
  constructor(
    private readonly box: Box3,
    private readonly farFrom: number,
  ) {
    super();
  }
  override update(camera: Camera): void {
    const [near, far] = this.levels;
    if (!near || !far) return;
    this.eye.setFromMatrixPosition(camera.matrixWorld);
    const isFar = this.box.distanceToPoint(this.eye) > this.farFrom;
    near.object.visible = !isFar;
    far.object.visible = isFar;
  }
}

/** Sim (x, y, z) of a free test view: eye and target. */
type View = readonly [x: number, y: number, z: number];
declare global {
  /** e2e only (?e2e=1): renders the scene once from a free camera and returns a PNG data URL. Eye and target are sim
   *  (x, y, height above the GroundWorld there). Bypasses the post chain (AgX tone mapping only, no AA/bloom): for
   *  overview and close-up test shots. */
  var __annexView: ((eye: View, target: View, fovDeg?: number, fog?: boolean) => string) | undefined;
  /** e2e only (11-05): the current frame's tyre contact points in CSS px of the viewport, through the main camera. */
  var __screenContacts: (() => { x: number; y: number }[]) | undefined;
}

function installViewHook(render: RenderService, world: GroundWorld, frame: () => TelemetryFrame): () => void {
  const hit: GroundHit = { h: 0, base: 0, surface: 'asphalt', zone: '', s: NaN, l: NaN };
  const ground = (p: View) => p[2] + world.sample(p[0], p[1], NaN, hit).h;
  const camera = new PerspectiveCamera(50, 16 / 9, 1, 4000);
  // The canvas has no depth buffer (the post chain owns it): render into a target, then tone-map it onto the canvas.
  const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: true });
  const blit = new ShaderMaterial({
    uniforms: { map: { value: target.texture } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D map;\nvarying vec2 vUv;\nvoid main() {\ngl_FragColor = texture2D(map, vUv);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
    depthTest: false,
    depthWrite: false,
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), blit);
  const screen = new OrthographicCamera();
  globalThis.__annexView = (eye, at, fovDeg = 50, fog = true) => {
    const { renderer, scene } = render;
    const c = renderer.domElement;
    target.setSize(c.width, c.height);
    camera.aspect = c.width / Math.max(1, c.height);
    camera.fov = fovDeg;
    camera.position.set(eye[0], ground(eye), -eye[1]);
    camera.lookAt(at[0], ground(at), -at[1]);
    camera.updateProjectionMatrix();
    const mapping = renderer.toneMapping;
    const sceneFog = scene.fog;
    if (!fog) scene.fog = null;
    renderer.setRenderTarget(target);
    renderer.clear(); // the post chain turns autoClear off
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    scene.fog = sceneFog;
    renderer.toneMapping = AgXToneMapping;
    renderer.render(quad, screen);
    renderer.toneMapping = mapping;
    return c.toDataURL('image/png');
  };
  const p = new Vector3();
  globalThis.__screenContacts = () =>
    frame().corners.map((c) => {
      simToThree(c.contactPatch.x, c.contactPatch.y, c.contactPatch.z, p);
      p.project(render.camera);
      return { x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight };
    });
  return () => {
    globalThis.__annexView = undefined;
    globalThis.__screenContacts = undefined;
    target.dispose();
    blit.dispose();
    quad.geometry.dispose();
  };
}

/** Where the 11-05 facility props go: the big slabs' grass edges, the braking lanes' brake bars, the hut between the
 *  dynamics pad and the braking platform, the field rectangle. */
export function facilityPlacement(world: GroundWorld, zones: readonly CompiledZone[], field: FacilityPlacement['field']): FacilityPlacement {
  const p = { x: 0, y: 0 };
  const q = { x: 0, y: 0 };
  const edges: FacilityPlacement['edges'][number][] = [];
  const brake: FacilityPlacement['brake'][number][] = [];
  for (const z of zones) {
    if (z.def.shape.kind !== 'rect') continue;
    if (z.length * 2 * z.halfWidth > 8000) {
      for (const e of grassEdges(z, world)) {
        const sign = e.at > 0 ? 1 : -1;
        const pt = (t: number, off: number): [number, number] => {
          if (e.side === 'w') z.toWorld(t, e.at + sign * off, p);
          else z.toWorld(e.at + sign * off, t, p);
          return [p.x, p.y];
        };
        const a = pt(e.from, 0);
        const b = pt(e.to, 0);
        const o = pt((e.from + e.to) / 2, 1);
        const m = pt((e.from + e.to) / 2, 0);
        edges.push({ a, b, n: [o[0] - m[0], o[1] - m[1]], zone: z.def.id });
      }
    }
    const patches = z.def.patches ?? [];
    if (patches.length && !z.def.features?.length) {
      const u0 = Math.min(...patches.map((pp) => pp.u[0]));
      const lane = Math.max(...patches.map((pp) => pp.w[1] - pp.w[0]));
      const w0 = Math.max(-z.halfWidth + 0.5, Math.min(...patches.map((pp) => pp.w[0])) - lane);
      const w1 = Math.min(z.halfWidth - 0.5, Math.max(...patches.map((pp) => pp.w[1])) + lane);
      z.toWorld(u0, (w0 + w1) / 2, p);
      z.toWorld(u0 + 1, (w0 + w1) / 2, q);
      brake.push({ x: p.x, y: p.y, dir: [q.x - p.x, q.y - p.y], half: (w1 - w0) / 2 });
    }
  }
  return { edges, brake, hut: { x: 104, y: 190, heading: Math.PI }, field };
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
    // each chunk: the tier's mesh near, a 4 m mesh without feature rows beyond FAR_LOD of its box
    annexChunks(zones).forEach((chunk, i) => {
      const near = buildZoneMesh(world, zones, chunk, tier).geometry;
      const far = buildZoneMesh(world, zones, chunk, 'far').geometry;
      near.computeBoundingBox();
      const lod = new BoxLOD(near.boundingBox!.clone(), FAR_LOD);
      lod.name = `annex-ground-${i}`;
      const center = near.boundingSphere!.center.clone();
      lod.position.copy(center);
      for (const [g, distance] of [
        [near, 0],
        [far, 1],
      ] as const) {
        g.translate(-center.x, -center.y, -center.z);
        const mesh = new Mesh(g, slots);
        mesh.receiveShadow = true;
        lod.addLevel(mesh, distance);
      }
      root.add(lod);
    });
    const paint = new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const markings = new Mesh(buildMarkings(world, annexMarkings(def, zones, world)), paint);
    markings.name = 'annex-markings';
    markings.receiveShadow = true;
    root.add(markings);
    const cones = createCones(world, def);
    if (cones) root.add(cones);
    root.add(...createFacility(world, facilityPlacement(world, zones, def.field ?? null)));
    performance.measure('proving-ground-meshes', { start: t0, end: performance.now() });
    const signs = await createSigns(world, def);
    if (signs) root.add(signs);
    root.traverse((o) => {
      o.matrixAutoUpdate = false;
      o.updateMatrix();
    });

    ctx.addDisposer(render.add(root));
    if (ctx.flags.e2e) ctx.addDisposer(installViewHook(render, world, () => ctx.sim.frame));
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
