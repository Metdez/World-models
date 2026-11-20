import { HalfFloatType, type PerspectiveCamera, type Scene, type WebGLRenderer } from 'three';
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  FXAAEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
  type Effect,
} from 'postprocessing';
import type { N8AOPostPass } from 'n8ao';
import type { QualitySettings } from '../../contracts/app';

/**
 * Post stack (research 13 B6, restrained): Render (HalfFloat) → N8AO half-res (high only) → ONE merged EffectPass
 * [SMAA (FXAA on the low tier), Bloom, Vignette, AgX tone map], dithered against banding. The renderer must use NoToneMapping.
 */
export function createPost(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera) {
  const composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType });
  const renderPass = new RenderPass(scene, camera);
  // One final pass per bloom/smaa combination, built on first use (tier changes are rare).
  const finals = new Map<string, EffectPass>();
  let ao: N8AOPostPass | undefined;
  // n8ao (~300 kB with its denoise models) is only needed on the high tier: loaded on demand.
  let aoLoading: Promise<void> | undefined;
  let current: QualitySettings | undefined;
  let disposed = false;

  function finalPass(q: QualitySettings): EffectPass {
    const key = `${q.bloom}:${q.smaa}`;
    let pass = finals.get(key);
    if (!pass) {
      const effects: Effect[] = [];
      // AA first: it is the pass's only convolution effect and must see the un-graded image. Tiers without SMAA
      // still get FXAA: one cheap fetch-and-blend inside the same pass, no extra render target.
      effects.push(q.smaa ? new SMAAEffect({ preset: SMAAPreset.HIGH }) : new FXAAEffect());
      // Threshold is in linear scene units: the horizon sky is ~1.5, so only sun glints and HDR highlights bloom.
      if (q.bloom) effects.push(new BloomEffect({ mipmapBlur: true, luminanceThreshold: 3, luminanceSmoothing: 0.5, intensity: 0.3, radius: 0.65 }));
      effects.push(new VignetteEffect({ darkness: 0.38, offset: 0.3 }), new ToneMappingEffect({ mode: ToneMappingMode.AGX }));
      pass = new EffectPass(camera, ...effects);
      pass.dithering = true;
      finals.set(key, pass);
    }
    return pass;
  }

  function loadAo(): Promise<void> {
    aoLoading ??= import('n8ao').then(({ N8AOPostPass }) => {
      if (disposed) return;
      ao = new N8AOPostPass(scene, camera);
      ao.configuration.aoRadius = 0.9;
      ao.configuration.distanceFalloff = 1;
      ao.configuration.intensity = 2.5;
      ao.configuration.halfRes = true;
      ao.setQualityMode('Medium');
      if (current) setQuality(current);
    }).catch((e: unknown) => console.error('renderer: ambient occlusion unavailable', e));
    return aoLoading;
  }

  /** Rebuilds the pass list for a tier (AO joins once its module has loaded). */
  function setQuality(q: QualitySettings): void {
    current = q;
    for (const p of [...composer.passes]) composer.removePass(p);
    composer.addPass(renderPass);
    if (q.ambientOcclusion === 'half') {
      if (ao) composer.addPass(ao);
      else void loadAo();
    }
    composer.addPass(finalPass(q));
  }

  return {
    composer,
    setQuality,
    /** Resolves when every pass the current tier needs is in the composer. */
    ready(): Promise<void> {
      return current?.ambientOcclusion === 'half' ? loadAo() : Promise.resolve();
    },
    /** CSS size; the composer applies the renderer's pixel ratio. */
    setSize(width: number, height: number): void {
      composer.setSize(width, height, false);
    },
    render(dt: number): void {
      composer.render(dt);
    },
    dispose(): void {
      disposed = true;
      for (const p of [...composer.passes]) composer.removePass(p);
      composer.dispose();
      renderPass.dispose();
      ao?.dispose();
      for (const p of finals.values()) p.dispose();
    },
  };
}
