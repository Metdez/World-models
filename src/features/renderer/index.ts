import { Color, NoToneMapping, PCFShadowMap, PerspectiveCamera, Scene, WebGLRenderer, type Object3D } from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { QUALITY_PRESETS, type FeatureModule, type FrameInfo, type QualitySettings, type QualityTier } from '../../contracts/app';
import { RENDER, type RenderService, type RenderStats } from '../../contracts/services';
import { createGovernor, startRatio, stepGovernor, trackFrame } from './governor';
import { createPost } from './post';

const BACKGROUND = 0x07080a;
const LOWER_TIER: Record<QualityTier, QualityTier> = { high: 'medium', medium: 'low', low: 'low' };

let frameHandler: ((frame: FrameInfo) => void) | undefined;

export default {
  id: 'renderer',
  requires: [],
  phase: 'render',
  async init(ctx) {
    const { stage } = ctx.dom;
    // Throws when WebGL 2 is unavailable: the kernel turns that into the fatal overlay.
    // No canvas MSAA/depth: everything renders into the composer's HalfFloat buffers (SMAA does the AA).
    const renderer = new WebGLRenderer({ antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    ctx.addDisposer(() => renderer.dispose());
    renderer.toneMapping = NoToneMapping; // AgX runs in the final EffectPass
    // Enabled up front so programs are compiled with shadow support; the environment decides who casts.
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    // Several render() calls per frame (shadow, AO, post): reset once per frame so stats() covers the whole frame.
    renderer.info.autoReset = false;

    // §10 start tier: ?quality= › coarse pointer → low › high.
    if (!ctx.flags.quality && !ctx.flags.e2e && globalThis.matchMedia?.('(pointer: coarse)').matches) ctx.store.setKey('quality', 'low');
    const quality = (): QualitySettings => QUALITY_PRESETS[ctx.store.get().quality];
    const deviceRatio = () => (ctx.flags.e2e ? 1 : globalThis.devicePixelRatio || 1);
    const governor = createGovernor(startRatio(deviceRatio(), quality()));
    const governed = !ctx.flags.e2e && !ctx.flags.quality;
    if (ctx.flags.e2e) governor.ratio = 1;
    renderer.setPixelRatio(governor.ratio);
    stage.append(renderer.domElement);
    ctx.addDisposer(() => renderer.domElement.remove());

    // Label layer for CSS2DObjects added through RENDER.add (part labels, overlays).
    const labels = new CSS2DRenderer();
    // CSS2DRenderer walks the whole scene and allocates every call: only run it once a label has been added.
    let labelsInUse = false;
    Object.assign(labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    stage.append(labels.domElement);
    ctx.addDisposer(() => labels.domElement.remove());

    const scene = new Scene();
    scene.background = new Color(BACKGROUND);
    const camera = new PerspectiveCamera(55, 1, 0.1, 5000);
    const post = createPost(renderer, scene, camera);
    ctx.addDisposer(() => post.dispose());

    const resize = () => {
      const w = Math.max(1, stage.clientWidth);
      const h = Math.max(1, stage.clientHeight);
      post.setSize(w, h);
      labels.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    ctx.addDisposer(() => observer.disconnect());

    // Effective settings (preset with the governed ratio as its cap), rebuilt only on change: readers may poll per frame.
    let effective: QualitySettings = quality();
    const applyRatio = () => {
      effective = { ...quality(), maxPixelRatio: governor.ratio };
      if (governor.ratio === renderer.getPixelRatio()) return;
      renderer.setPixelRatio(governor.ratio);
      resize();
    };
    let tier: QualityTier | undefined;
    ctx.watch((s) => {
      if (s.quality === tier) return;
      tier = s.quality;
      governor.ratio = ctx.flags.e2e ? 1 : startRatio(deviceRatio(), quality());
      governor.ceiling = Infinity; // a new tier has its own costs
      applyRatio();
      post.setQuality(quality());
    });

    const service: RenderService = {
      renderer,
      scene,
      camera,
      add(object: Object3D) {
        object.traverse((o) => {
          if ((o as { isCSS2DObject?: boolean }).isCSS2DObject) labelsInUse = true;
        });
        scene.add(object);
        return () => scene.remove(object);
      },
      get quality() {
        return effective;
      },
      // Scene programs first (parallel where supported), then one full frame warms the shadow and post shaders.
      async compile() {
        await post.ready();
        await renderer.compileAsync(scene, camera);
        renderer.info.reset();
        post.render(0);
      },
      stats(): RenderStats {
        const { render, memory } = renderer.info;
        return {
          fps: 1000 / governor.ema,
          frameMs: governor.ema,
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
      if (!governed) trackFrame(governor, frame.dt);
      else {
        const action = stepGovernor(governor, frame.dt, quality());
        const current = ctx.store.get().quality;
        if (action === 'ratio') applyRatio();
        else if (action === 'downgrade' && current !== 'low') {
          console.info(`renderer: frame time ${governor.ema.toFixed(1)} ms at minimum pixel ratio; quality ${current} → ${LOWER_TIER[current]}`);
          ctx.store.setKey('quality', LOWER_TIER[current]);
        }
      }
      renderer.info.reset();
      post.render(frame.dt);
      if (labelsInUse) labels.render(scene, camera);
    };
    ctx.addDisposer(() => (frameHandler = undefined));
    await post.ready();
  },
  update(frame) {
    frameHandler?.(frame);
  },
} satisfies FeatureModule;
