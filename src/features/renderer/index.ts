import { Color, PerspectiveCamera, Scene, WebGLRenderer, type Object3D } from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { QUALITY_PRESETS, type FeatureModule, type FrameInfo, type QualitySettings } from '../../contracts/app';
import { CAMERA, RENDER, type RenderService, type RenderStats } from '../../contracts/services';
import { createPlaceholder } from './placeholder';

const BACKGROUND = 0x07080a;
/** Frame-time EMA weight (~60 frames). */
const EMA = 1 / 60;

let frameHandler: ((frame: FrameInfo) => void) | undefined;

export default {
  id: 'renderer',
  requires: [],
  phase: 'render',
  init(ctx) {
    const { stage } = ctx.dom;
    // Throws when WebGL 2 is unavailable: the kernel turns that into the fatal overlay.
    const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    ctx.addDisposer(() => renderer.dispose());
    const quality = (): QualitySettings => QUALITY_PRESETS[ctx.store.get().quality];
    const applyPixelRatio = () => {
      const ratio = ctx.flags.e2e ? 1 : Math.min(globalThis.devicePixelRatio || 1, quality().maxPixelRatio);
      if (ratio !== renderer.getPixelRatio()) renderer.setPixelRatio(ratio);
    };
    applyPixelRatio();
    stage.append(renderer.domElement);
    ctx.addDisposer(() => renderer.domElement.remove());

    // Label layer for CSS2DObjects added to the scene (part labels, overlays).
    const labels = new CSS2DRenderer();
    Object.assign(labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    stage.append(labels.domElement);
    ctx.addDisposer(() => labels.domElement.remove());

    const scene = new Scene();
    scene.background = new Color(BACKGROUND);
    const camera = new PerspectiveCamera(55, 1, 0.1, 5000);

    const resize = () => {
      const w = Math.max(1, stage.clientWidth);
      const h = Math.max(1, stage.clientHeight);
      renderer.setSize(w, h, false);
      labels.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    ctx.addDisposer(() => observer.disconnect());
    ctx.watch(applyPixelRatio);

    const placeholder = createPlaceholder(ctx.sim);
    scene.add(placeholder.root);
    ctx.addDisposer(() => {
      scene.remove(placeholder.root);
      placeholder.dispose();
    });
    ctx.on('sim:vehicle', placeholder.rebuild);

    let frameMs = 1000 / 60;
    const service: RenderService = {
      renderer,
      scene,
      camera,
      add(object: Object3D) {
        scene.add(object);
        return () => scene.remove(object);
      },
      get quality() {
        return quality();
      },
      compile: () => renderer.compileAsync(scene, camera).then(() => undefined),
      stats(): RenderStats {
        const { render, memory } = renderer.info;
        return {
          fps: 1000 / frameMs,
          frameMs,
          calls: render.calls,
          triangles: render.triangles,
          geometries: memory.geometries,
          textures: memory.textures,
          pixelRatio: renderer.getPixelRatio(),
        };
      },
    };
    ctx.services.provide(RENDER, service);

    frameHandler = (frame) => {
      if (frame.dt > 0) frameMs += (frame.dt * 1000 - frameMs) * EMA;
      placeholder.update(frame.t);
      if (!ctx.services.tryGet(CAMERA)) placeholder.chase(camera);
      renderer.render(scene, camera);
      labels.render(scene, camera);
    };
    ctx.addDisposer(() => (frameHandler = undefined));
  },
  update(frame) {
    frameHandler?.(frame);
  },
} satisfies FeatureModule;
