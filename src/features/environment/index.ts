import {
  Color,
  DataTexture,
  DirectionalLight,
  Fog,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  RGBAFormat,
  Vector3,
  type Texture,
} from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import type { FeatureModule, FrameInfo } from '../../contracts/app';
import { RENDER } from '../../contracts/services';
import type { ViewMode } from '../../contracts/store';
import { simQuatToThree, simToThree } from '../../contracts/units';
import { clampHdr, snapToTexel, type HdrAnalysis } from './hdri';

interface EnvironmentLook {
  readonly asset: string;
  /** Linear clamp before PMREM; the clipped energy becomes the sun light. */
  readonly clamp: number;
  /** Sun intensity per unit of clipped irradiance, and its bounds (lux-like three units). */
  readonly sunScale: number;
  readonly sunRange: readonly [number, number];
  readonly environmentIntensity: number;
  readonly backgroundBlurriness: number;
  readonly backgroundIntensity: number;
  /** Linear fog, m. */
  readonly fog: readonly [number, number];
}

// Tuned by eye against DPR-1 screenshots (03-02 SUMMARY): AgX, bloom threshold 3.
const LOOKS = {
  airfield: {
    asset: 'hdri/derelict_airfield_01_1k',
    clamp: 48,
    sunScale: 1,
    sunRange: [1.5, 4],
    environmentIntensity: 1,
    backgroundBlurriness: 0.06,
    backgroundIntensity: 1,
    fog: [80, 700],
  },
  studio: {
    asset: 'hdri/ferndale_studio_03_1k',
    clamp: 160,
    sunScale: 0.2,
    sunRange: [0.8, 2.5],
    environmentIntensity: 1.1,
    backgroundBlurriness: 0.25,
    backgroundIntensity: 0.35,
    fog: [60, 600],
  },
} as const satisfies Record<string, EnvironmentLook>;
type LookId = keyof typeof LOOKS;
const VIEW_LOOK: Readonly<Record<ViewMode, LookId>> = { follow: 'airfield', explore: 'airfield', closeup: 'studio' };

/** Shadow box half-size around the car, m (a low sun throws ~4 m shadows off a 1.3 m car). */
const SHADOW_HALF = 12;
/** Light distance from the shadow centre along the sun direction, m. */
const SUN_DISTANCE = 60;
const BLOB_OPACITY = 0.8;
/** Contact blob margin around wheelbase × track, m. */
const BLOB_MARGIN = { length: 2.2, width: 1.1 } as const;

let frameHandler: ((frame: FrameInfo) => void) | undefined;

/** Soft rounded-rectangle falloff for an alphaMap (three reads its green channel): grounding shadow, no extra pass. */
function blobTexture(size = 64): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = Math.abs(((x + 0.5) / size) * 2 - 1);
      const v = Math.abs(((y + 0.5) / size) * 2 - 1);
      // Superellipse distance: flat core, soft rim.
      const d = Math.pow(Math.pow(u, 4) + Math.pow(v, 4), 0.25);
      const t = Math.min(1, Math.max(0, (1 - d) / 0.55));
      data.fill(Math.round(255 * t * t * (3 - 2 * t)), (y * size + x) * 4, (y * size + x) * 4 + 4);
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export default {
  id: 'environment',
  requires: ['renderer'],
  phase: 'scene',
  async init(ctx) {
    const render = ctx.services.get(RENDER);
    const { renderer, scene } = render;
    const pmrem = new PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    ctx.addDisposer(() => pmrem.dispose());

    interface LoadedLook {
      readonly look: EnvironmentLook;
      readonly texture: Texture;
      readonly hdr: HdrAnalysis;
    }
    const loaded = new Map<LookId, Promise<LoadedLook>>();
    const load = (id: LookId): Promise<LoadedLook> => {
      let p = loaded.get(id);
      if (!p) {
        const look = LOOKS[id];
        p = new HDRLoader().loadAsync(ctx.assets.url(look.asset)).then((equirect) => {
          const { width, height, data } = equirect.image as { width: number; height: number; data: Uint16Array };
          const hdr = clampHdr(data, width, height, look.clamp);
          const texture = pmrem.fromEquirectangular(equirect).texture;
          equirect.dispose();
          return { look, texture, hdr };
        });
        loaded.set(id, p);
      }
      return p;
    };
    ctx.addDisposer(() => {
      for (const p of loaded.values()) void p.then((l) => l.texture.dispose(), () => undefined);
    });

    // Sun: one directional light whose shadow box follows the car (texel-snapped).
    const root = new Group();
    root.name = 'environment';
    const sun = new DirectionalLight(0xffffff, 2);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -SHADOW_HALF;
    sun.shadow.camera.right = sun.shadow.camera.top = SHADOW_HALF;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = SUN_DISTANCE * 2;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 3;
    root.add(sun, sun.target);
    const sunDir = new Vector3(0, 1, 0);
    const lightRight = new Vector3();
    const lightUp = new Vector3();
    const lightForward = new Vector3();
    let texel = (2 * SHADOW_HALF) / 1024;

    // Contact blob under the car.
    const blobMap = blobTexture();
    const blobMaterial = new MeshBasicMaterial({
      color: 0x000000,
      alphaMap: blobMap,
      transparent: true,
      opacity: BLOB_OPACITY,
      depthWrite: false,
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    });
    const blob = new Mesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), blobMaterial);
    blob.renderOrder = 1;
    root.add(blob);
    const sizeBlob = () => {
      const v = ctx.sim.current.vehicle;
      const width = 'track' in v.front ? v.front.track : 0.3;
      blob.scale.set(v.wheelbase + BLOB_MARGIN.length, 1, width + BLOB_MARGIN.width);
    };
    sizeBlob();
    ctx.on('sim:vehicle', sizeBlob);
    ctx.addDisposer(() => {
      blob.geometry.dispose();
      blobMaterial.dispose();
      blobMap.dispose();
      sun.dispose();
    });

    const fog = new Fog(0x000000, 100, 1000);
    const previous = { background: scene.background, environment: scene.environment, fog: scene.fog };
    scene.fog = fog;
    ctx.addDisposer(render.add(root));
    ctx.addDisposer(() => {
      scene.background = previous.background;
      scene.environment = previous.environment;
      scene.fog = previous.fog;
    });

    let wanted: LookId = VIEW_LOOK[ctx.store.get().view];
    const apply = ({ look, texture, hdr }: LoadedLook) => {
      scene.environment = texture;
      scene.environmentIntensity = look.environmentIntensity;
      scene.background = texture;
      scene.backgroundBlurriness = look.backgroundBlurriness;
      scene.backgroundIntensity = look.backgroundIntensity;
      fog.color.setRGB(hdr.horizon[0], hdr.horizon[1], hdr.horizon[2]).multiplyScalar(look.backgroundIntensity);
      fog.near = look.fog[0];
      fog.far = look.fog[1];
      sun.color.setRGB(hdr.sunColor[0], hdr.sunColor[1], hdr.sunColor[2]);
      sun.intensity = Math.min(look.sunRange[1], Math.max(look.sunRange[0], hdr.sunIrradiance * look.sunScale));
      sunDir.set(hdr.sunDirection[0], hdr.sunDirection[1], hdr.sunDirection[2]);
      // Keep a usable shadow when the key light sits near the horizon.
      if (sunDir.y < 0.25) sunDir.setY(0.25).normalize();
      lightForward.copy(sunDir).negate();
      lightRight.set(0, 1, 0).cross(lightForward).normalize();
      lightUp.copy(lightForward).cross(lightRight).normalize();
    };
    const show = (id: LookId) => {
      wanted = id;
      load(id).then(
        (l) => {
          if (wanted === id) apply(l);
        },
        (e: unknown) => console.error(`environment: ${LOOKS[id].asset} failed to load`, e),
      );
    };
    // The first look blocks init (behind the loading overlay); the rest stream in after the app is ready.
    apply(await load(wanted));
    ctx.on('app:ready', () => {
      for (const id of Object.keys(LOOKS) as LookId[]) void load(id).catch(() => undefined);
    });
    ctx.watch((s) => {
      if (VIEW_LOOK[s.view] !== wanted) show(VIEW_LOOK[s.view]);
      const size = render.quality.shadowMapSize;
      sun.castShadow = size > 0;
      if (size > 0 && sun.shadow.mapSize.x !== size) {
        sun.shadow.mapSize.set(size, size);
        sun.shadow.map?.dispose();
        sun.shadow.map = null;
        texel = (2 * SHADOW_HALF) / size;
      }
    });

    const centre = new Vector3();
    const snapped = new Vector3();
    const forward = new Vector3();
    const q = new Quaternion();
    frameHandler = ({ t }) => {
      // Ground point under the car: mean contact patch.
      centre.set(0, 0, 0);
      for (const c of t.corners) {
        centre.x += c.contactPatch.x;
        centre.y += c.contactPatch.y;
        centre.z += c.contactPatch.z;
      }
      const n = t.corners.length || 1;
      simToThree(centre.x / n, centre.y / n, centre.z / n, centre);
      blob.position.copy(centre);
      simQuatToThree(t.bodyRotation, q);
      forward.set(1, 0, 0).applyQuaternion(q);
      blob.rotation.y = Math.atan2(-forward.z, forward.x);
      // Fades as the body lifts away from the road (heave is + up).
      blobMaterial.opacity = BLOB_OPACITY * Math.min(1, Math.max(0.4, 1 - t.heave * 4));

      snapToTexel(centre, lightRight, lightUp, lightForward, texel, snapped);
      sun.target.position.copy(snapped);
      sun.position.copy(snapped).addScaledVector(sunDir, SUN_DISTANCE);
    };
    ctx.addDisposer(() => (frameHandler = undefined));
  },
  update(frame) {
    frameHandler?.(frame);
  },
} satisfies FeatureModule;
