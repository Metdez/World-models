# 09 - Premium real-time car rendering techniques (vanilla three.js)

Date: 2026-11-20. Method: read primary sources (raw GitHub, npm registry) directly. "Verified" = I opened the source this session. "Unverified" = from a search snippet only. Snippets marked **(mine)** are my own sketches built from verified API facts and are untested.

## 0. Version / API facts (verified)

- **Latest three.js: r187.0 (npm, published 2026-10-30)**, MIT. Previous: r186.1 (2026-09-24), r185.1, r184. (npm registry `three`.)
- Changes in r18x that matter (verified in dev source):
  - `THREE.Clock` is **deprecated since r183** -> use `THREE.Timer` (`timer.connect(document)`, `timer.update()`, `timer.getDelta()`).
  - `RGBELoader` is now **`HDRLoader`** (`three/addons/loaders/HDRLoader.js`) - official car example uses it.
  - DRACO decoder path constant: `DRACO_GLTF_CONFIG` exported from `DRACOLoader`.
  - WebGPU path: `import * as THREE from 'three/webgpu'`; post-processing class is **`THREE.RenderPipeline`** (was `PostProcessing`); `renderer.setAnimationLoop`, TSL nodes from `three/tsl`. WebGPURenderer falls back to WebGL2 backend (general knowledge; examples exist for both `webgl_*` and `webgpu_*`).
  - Tone mapping options (all in `webgl_tonemapping`): `NoToneMapping, Linear, Reinhard, Cineon, ACESFilmic, AgX, Neutral, Custom`.
  - `scene.environmentIntensity`, `scene.backgroundBlurriness/Intensity/Rotation` exist (drei's Environment wraps them).
  - Rendering examples existing in dev: `webgl_materials_envmaps_groundprojected`, `webgl_shadow_contact`, `webgl_mirror` (Reflector), `webgl_postprocessing_{smaa,taa,ssr,gtao,dof,unreal_bloom}`, `webgl_loader_gltf_{iridescence,sheen,anisotropy,transmission}`, `webgl_lights_rectarealight`; WebGPU-only: `webgpu_postprocessing_motion_blur`, `webgpu_postprocessing_traa`, `webgpu_postprocessing_ssgi`, `webgpu_postprocessing_ssr_*`, `webgpu_upscaling_taau`, `webgpu_fog_height`.
- Licences: three.js MIT; `@react-three/drei` 10.7.9 MIT; `@pmndrs/vanilla` (drei-vanilla) MIT; `postprocessing` (pmndrs) 6.39.6 **Zlib** (permissive, usable); `vis-prime/progressive-shadows` Apache-2.0; `pmndrs/racing-game` MIT (CC0 assets).

## 1. Source survey - what is actually worth lifting

| Source | What | Licence | Reusable |
|---|---|---|---|
| three.js `examples/webgl_materials_car.html` (verified, read in full) | The canonical car example | MIT code. Ferrari 458 model by vicent091036 on Sketchfab; reported CC BY 4.0 (from a forum post, **unverified in repo** - check before shipping; attribution needed) | Material recipe, baked-AO-plane trick, wheel spin, moving grid for speed sense |
| three.js `examples/jsm/objects/GroundedSkybox.js` + `webgl_materials_envmaps_groundprojected` | Ground-projected HDRI | MIT | Drop-in |
| three.js `examples/jsm/objects/Reflector.js` | Planar reflection (MSAA 4x, HalfFloat RT by default) | MIT | Drop-in; base for wet-asphalt |
| three.js `examples/jsm/environments/RoomEnvironment.js` | Procedural studio env for PMREM | MIT | Template for own softbox scene |
| three.js `examples/jsm/tsl/display/MotionBlur.js`, `TRAANode.js` (WebGPU) | Velocity-based motion blur / temporal AA | MIT | Only if we go WebGPURenderer |
| pmndrs/drei `src/core/Lightformer.tsx` (verified) | Emissive planes in an env scene | MIT | 30 lines; pattern below |
| drei `ContactShadows.tsx` (verified) | Orthographic depth render from below + 2-pass blur, original by mrdoob | MIT | Pattern below |
| drei `MeshReflectorMaterial` (`src/materials/MeshReflectorMaterial.tsx`, verified) | MeshStandardMaterial + `onBeforeCompile` blending blurred planar reflection, depth fade, normal-map distortion | MIT | Shader chunk liftable verbatim |
| pmndrs/drei-vanilla (`@pmndrs/vanilla`) | Vanilla ports: `AccumulativeShadows`, `MeshReflectorMaterial`, `pcss`, `MeshTransmissionMaterial`, `Caustics`, `Sparkles` etc. | MIT | **Use this package directly** - no React needed |
| vis-prime/progressive-shadows | Vanilla AccumulativeShadows (older; README says use drei-vanilla) | Apache-2.0 | Superseded |
| pmndrs/racing-game (verified) | r3f racing demo, `src/effects/{Skid,Dust,Trail...}` instanced skid marks keyed on speed; three 0.139 (old) | MIT, CC0 assets | Skid/dust/trail ideas |
| Discourse "LUSTRE" car-paint page (verified post) | One `MeshPhysicalMaterial` + `onBeforeCompile` with two paint parameter sets blended by world-space wipe; procedural dirt via 3D noise; PMREM from a small scene with hex-grid ceiling + side softboxes so reflections match lights; DPR cap 1.5 on touch; iridescence off on touch. No repo | Demo only; no licence | Ideas only |
| Discourse flip-paint thread (verified) | `iridescenceThicknessRange` ~[300,500] gives yellow-green; base colour confounds; unresolved | - | Tuning hint |

GitHub "three.js car configurator" search (via API, verified): **nothing notable by stars** - best hits are ~26 stars (`Prajyot-Desai/AutoVerse`, no licence) and MIT hobby repos with 1 star (`Kishlaykumar/modular-car-configurator`, `moizahmad418/aventador-3d-configurator`). The real quality lives in three.js's own example + pmndrs primitives; configurator repos are not worth lifting from. Codrops: only a 2019 chair colour customiser turned up (no car tutorial found). Active Theory / Lusion car techniques: **nothing documented found** (unverified/none). PlayCanvas/Babylon forum notes (snippets only): clearcoat depends heavily on environment quality; do not let a reflection probe capture the car itself (bake with the car excluded or use a fixed cube) - same applies to three `CubeCamera`.

## 2. Materials

### 2.1 Car paint (official baseline, verified)
```js
const body = new THREE.MeshPhysicalMaterial({
  color: 0xff0000, metalness: 1.0, roughness: 0.5,
  clearcoat: 1.0, clearcoatRoughness: 0.03      // webgl_materials_car
});
// grounded-skybox variant (dark paint): color 0x000000, roughness 0.8, clearcoatRoughness 0.2
const details = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1.0, roughness: 0.5 }); // rims, trim
const glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.25, roughness: 0, transmission: 1.0 });
```
Official clearcoat example (`webgl_materials_physical_clearcoat`) adds the two normal-map layers that make paint look real:
```js
new THREE.MeshPhysicalMaterial({
  clearcoat: 1.0, metalness: 1.0, color: 0xff0000,
  normalMap: flakeNormal,  normalScale: new THREE.Vector2(0.15, 0.15),   // flakes under the coat
  clearcoatNormalMap: orangePeelNormal,
  clearcoatNormalScale: new THREE.Vector2(2.0, -2.0)   // y negated for handedness (per source comment)
});
```
**(mine) Premium paint recipe** - metallic flake base + low-roughness coat; tune these:
- Pearl/metallic: `metalness 0.9-1.0, roughness 0.35-0.5` (the roughness of the *base* sets how wide the flake sheen is), `clearcoat 1, clearcoatRoughness 0.02-0.08`.
- Flakes: tiny high-frequency normal map (generate once from a canvas of random unit-vector RGB noise, `RepeatWrapping`, repeat ~40-80 on the body UVs or use triplanar via `onBeforeCompile` if UVs are bad), `normalScale ~0.1-0.2`. Orange peel: very low-frequency, low-amplitude noise normal on `clearcoatNormalMap`.
- Pearlescent/colour-shift: `iridescence: 0.3-1`, `iridescenceIOR: 1.3`, `iridescenceThicknessRange: [200, 500]` (forum thread: [300,500] ~ yellow-green; keep subtle, fixed base colour). Also consider `sheen`/`sheenColor` for satin/matte wraps. Disable iridescence on weak GPUs (cost: per-pixel thin-film in the physical shader).
- Matte/satin wrap: `clearcoat 0`, `roughness 0.45-0.6`, `metalness 0.4`.
- Brushed/forged parts: `anisotropy: 0.6-1.0` + `anisotropyRotation` (see `webgl_loader_gltf_anisotropy`).
```js
// (mine) flake normal map generator
function makeFlakeNormal(size = 512) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = new THREE.Vector3(Math.random()*2-1, Math.random()*2-1, 1.6 + Math.random()).normalize();
    img.data.set([ (v.x*.5+.5)*255, (v.y*.5+.5)*255, (v.z*.5+.5)*255, 255 ], i*4);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(60, 60);
  t.anisotropy = 8; return t;   // normal maps stay in linear (no colorSpace set)
}
```
Cost note: clearcoat is a second specular lobe + extra env lookup; keep one MeshPhysicalMaterial for the body only.

### 2.2 Glass
- Official: `transmission: 1.0, roughness: 0, metalness 0.25`. Transmission renders the opaque scene into a separate buffer each frame = **expensive and does not show other transmissive objects**. For a moving car with many glass panes: tint windows with a dark `MeshPhysicalMaterial({ color: 0x050607, roughness: 0.02, metalness: 0, transmission: 0, opacity: 0.85, transparent: true, envMapIntensity: 1.5, ior: 1.5 })` plus env reflection - cheaper, and reads "tinted glass" anyway. Use true transmission only for headlight lenses / close-up.
- Fresnel look comes free from the env map; raise `specularIntensity`/`envMapIntensity` slightly for headlights.

### 2.3 Tyres, brake discs, chrome (mine, standard PBR)
- Rubber: `MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.85-0.95, metalness: 0 })` + sidewall normal map (lettering); keep tread low-contrast. A touch of `sheen` or darker roughness variation at the shoulder sells wear.
- Brake disc: `metalness 1, roughness 0.35-0.45`, radial `anisotropy ~0.8` (brushed/cast), cross-drilled holes in geometry or alpha-test; slight emissive orange (`emissive 0xff4400`, intensity ~0.1-0.4 x brake input) for heat glow, bloom-able.
- Chrome: `metalness 1, roughness 0.02-0.08, color 0xffffff`; **needs strong env contrast** (softboxes) or it looks grey - see Lightformers.
- Calipers: `MeshPhysicalMaterial` with clearcoat, saturated colour.

## 3. Lighting / environment

### 3.1 Studio env = PMREM of a mini scene with emissive "lightformer" planes
drei's `Lightformer` (verified) is just a `Mesh(PlaneGeometry, MeshBasicMaterial({toneMapped:false, side: DoubleSide}))` whose colour is multiplied by `intensity` (>1 = HDR), `lookAt` a target. Drei's `<Environment>` renders such a scene to a cube/PMREM. Vanilla equivalent (**mine**, same technique as three's `RoomEnvironment`, verified API: `PMREMGenerator.fromScene`):
```js
function lightformer(w, h, intensity, pos, look = [0,0,0], color = 0xffffff) {
  const m = new THREE.MeshBasicMaterial({ color, toneMapped: false, side: THREE.DoubleSide });
  m.color.multiplyScalar(intensity);                  // drei: color.multiplyScalar(intensity)
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  mesh.position.set(...pos); mesh.lookAt(...look); return mesh;
}
function buildStudioEnv(renderer) {
  const s = new THREE.Scene(); s.background = new THREE.Color(0x0a0a0c);
  s.add(lightformer(10, 10, 4, [0, 8, 0]));           // overhead softbox -> roof/bonnet highlight
  s.add(lightformer(1.5, 8, 6, [-6, 2, 0]));          // long strips -> body-side "character line" streaks
  s.add(lightformer(1.5, 8, 6, [ 6, 2, 0]));
  s.add(lightformer(8, 2, 2, [0, 1, -8]));            // rear fill
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(s, 0.02);                // sigma blur 0.02
  pmrem.dispose(); return rt.texture;
}
scene.environment = buildStudioEnv(renderer);
```
Why it works: long thin high-intensity strips give the sharp reflection lines that define the shape of a car; broad low-intensity gradients alone look flat. Reflect the environment's softboxes in the scene lights too (LUSTRE post does this).

### 3.2 Outdoor / HDRI
```js
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';       // r187 name
const env = await new HDRLoader().loadAsync('sunrise_1k.hdr');
env.mapping = THREE.EquirectangularReflectionMapping;
scene.environment = env;   // three PMREM-filters it internally for PBR
```
Use a 1k-2k HDR for lighting (small, cheap) and optionally a separate higher-res background. Keep a dim/low-sun HDRI for "cinematic" look. Poly Haven HDRIs are CC0 (general knowledge - confirm per asset).

### 3.3 Ground-projected environment (verified, MIT)
```js
import { GroundedSkybox } from 'three/addons/objects/GroundedSkybox.js';
const skybox = new GroundedSkybox(envMap, /*height*/ 15, /*radius*/ 100);
skybox.position.y = 15 - 0.01;            // example offsets by -0.01 to avoid z-fight with y=0 ground
scene.add(skybox); scene.environment = envMap;
```
`height` = camera height of the HDRI photo (larger magnifies ground). For a car that drives across a large track, keep the skybox following the camera/car on XZ (`skybox.position.x/z = car.x/z`) or the ground "swims". Radius must exceed camera far distance. Blend the track mesh into the projected ground with a gradient/fog colour matched to the horizon.

### 3.4 Exposure / tone mapping / colour
- Official car example: `ACESFilmicToneMapping`, `toneMappingExposure 0.85`. ACES shifts saturated reds/blues (hue skew; reds go orange) - bad for brand-colour paint. **Prefer `THREE.NeutralToneMapping`** (Khronos PBR Neutral, designed for product colour fidelity, in r16x+) or **`AgXToneMapping`** (more filmic desaturation of highlights; nice for cinematic outdoor). A/B them with `webgl_tonemapping`. Verified both constants exist.
- Output: `renderer.outputColorSpace = THREE.SRGBColorSpace` (default). Colour textures `colorSpace = SRGBColorSpace`; normal/roughness/AO data textures stay linear (see `webgpu_postprocessing_motion_blur` example doing exactly this). `toneMapped:false` on emissive lightformers/shadow-multiply planes.
- With `EffectComposer`: tone mapping moves to `OutputPass` (renderer's toneMapping is applied there; render targets should be `HalfFloatType`). Composer's internal RT is HalfFloat (verified).

## 4. Shadows and grounding

1. **Baked AO plane (official)**: a 2-D AO texture on a `PlaneGeometry(0.655*4, 1.3*4)` under the car, `MeshBasicMaterial({ map, blending: MultiplyBlending, toneMapped:false, transparent:true, premultipliedAlpha:true })`, `rotation.x=-PI/2`, `renderOrder = 2`, parented to the car (verified). Free and rock-solid for a rigid car; **but a suspension demo body-rolls/pitches** -> parent the plane to the *chassis* (rolls with it) or better scale/offset it from ride height: `mesh.material.opacity = k * clamp(1 - rideHeightDelta...)`. Needs a custom-baked AO for our car model (bake in Blender).
2. **ContactShadows (drei, from mrdoob example, MIT, verified)**: ortho camera *below* the ground looking up, `scene.overrideMaterial = MeshDepthMaterial` rendered to a 512 RT, then horizontal+vertical blur (`HorizontalBlurShader`/`VerticalBlurShader` from `three/addons/shaders`), displayed on a transparent plane. `frames: Infinity` = realtime (needed for moving car, cost = 1 extra depth render of the car + 4 blur draws; use 256-512 res and cull to the car via layers). Official `webgl_shadow_contact` is the vanilla source.
3. **AccumulativeShadows** (progressive, jittered lights accumulated into a lightmap): beautiful soft shadows but **static only** - for a studio/garage view with a parked car, not the driving scene. Use `@pmndrs/vanilla` `AccumulativeShadows`.
4. **Real-time**: one `DirectionalLight` (sun) with a small, car-following shadow frustum (`shadow.camera` +-4 m, 2048 map, `shadow.bias -0.0002, normalBias 0.02`, `PCFSoftShadowMap`/VSM) for the long directional shadow, plus ContactShadows/AO plane for the contact darkening. Move the light target with the car, texel-snap to avoid shimmer.
5. Screen-space AO (`webgl_postprocessing_gtao`, `webgpu_postprocessing_ao`/`ssgi`) for under-car/wheel-arch darkness; cost moderate.

## 5. Wet asphalt / planar reflections
- Vanilla `Reflector` (verified options): `new Reflector(geometry, { clipBias: 0.003, textureWidth, textureHeight, color, multisample: 4 })`; internal RT is `HalfFloatType`, samples 4. Use `textureWidth = innerWidth*dpr*0.5` for cost. Reflection = scene re-rendered with oblique clip plane (Lengyel): **roughly doubles draw cost** - exclude heavy stuff via `layers` or a cheaper low-LOD proxy copy.
- Mirror-sharp is wrong for asphalt. Drei's `MeshReflectorMaterial` (verified source, MIT) is the right model: `MeshStandardMaterial` patched via `onBeforeCompile` to `texture2DProj(tDiffuse, my_vUv)`, optionally a blurred second RT (`blur:[w,h]`, `mixBlur`, `mixStrength`), roughness-map weighted mix (`blurFactor = min(1, mixBlur * roughness)`), normal-map distortion (`coord.xy + coord.z * my_normal.xz * 0.05`), `mixContrast`, depth fade (`depthScale`, thresholds). Final line: `diffuseColor.rgb *= ((1.0 - min(1.0, mirror)) + newMerge.rgb * mixStrength)`. Lift via `@pmndrs/vanilla` `MeshReflectorMaterial` (vanilla port exists) or copy the chunk above.
- Wet look recipe (**mine**): asphalt `roughness` texture with puddle mask driving roughness 0.05-0.15 in puddles vs 0.7 elsewhere; planar reflection mix weighted by that mask; dark albedo (0.05-0.1); env `specularIntensity` up; add headlight/tail-light emissives so they streak in the reflection; bloom on emissives.
- Cheaper alternative with no second scene pass: rely on PBR IBL (low-roughness floor + good HDRI) plus SSR (`webgl_postprocessing_ssr` SSRPass is legacy and noisy; WebGPU has `ssr_stochastic`/`ssr_mirror`). Decide after profiling.

## 6. Anti-aliasing (verified facts)
- Default `new WebGLRenderer({ antialias: true })` = MSAA on the canvas; **lost once you use EffectComposer** unless the composer's render target is multisampled:
```js
const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);   // MSAA preserved in WebGL2
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new OutputPass());                  // tone map + sRGB here
```
- `SMAAPass` (`webgl_postprocessing_smaa`) - cheap post AA, helps with specular shimmer on thin geometry; MSAA does not fix shader aliasing from clearcoat highlights; high-frequency flake normals shimmer -> mipmap + anisotropy, lower `normalScale` with distance.
- `TAARenderPass` (`webgl_postprocessing_taa`): README says it **accumulates only when the scene is static** ("When there is no motion... accumulates jittered camera samples") - **unsuitable for a driving car**; fine for the paused showroom/inspect view (accumulate when idle = super-sampled still).
- WebGPU path: `TRAANode` (`three/addons/tsl/display/TRAANode.js`) is true temporal reprojection AA using velocity MRT; note in source: **"MSAA must be disabled when TRAA is in use"**. Also `webgpu_upscaling_taau` / `fsr1` for rendering at lower res.

## 7. Wheel motion blur and speed
- Official car example: wheels just `rotation.x = time * 2PI`, plus a **scrolling ground grid** (`grid.position.z = -(time) % 1`) to fake forward speed with a stationary car (verified). For us the car actually moves, so use real motion + the following.
- **Blurred-rim trick (industry-standard, sources: UE/BeamNG/overtake.gg forum threads; no three.js-specific writeup found)**: crossfade three states by wheel angular speed `w = v/r`: (a) sharp rim mesh rotating; (b) rim + semi-transparent blurred-disc overlay; (c) static (non-rotating) blurred disc with spokes streaked + no rim rotation. Linear/velocity motion blur breaks when the wheel rotates a large fraction of a turn per frame (Epic docs), hence a radial-blur overlay. **(mine)** Build the overlay as a `CircleGeometry` placed just outboard of the rim face, material `MeshBasicMaterial({ map: radialBlurTex, transparent: true, depthWrite: false })`; generate `radialBlurTex` offline (render rim texture, average N rotations by 0..30 deg, keep alpha) or procedurally in a canvas; drive `overlay.material.opacity = smoothstep(a0, a1, |w|*dt/2PI)` and the real rim's visibility down at the top end. Keep tyre sidewall rotating (low-contrast so no strobing); also clamp the visible rotation per frame to avoid the "wagon-wheel" backwards-spin alias (when `|dtheta| > ~PI/spokes` switch to blurred state).
- WebGPU full-screen velocity motion blur (verified code): `scenePass.setMRT(mrt({ output, velocity }))`, `motionBlur(beauty, vel.mul(blurAmount))` (16 taps, taps span +-0.5*velocity), output via `RenderPipeline`; vignette in same node graph. Use it for camera/body motion, but **exclude wheels** (or accept) and keep `blurAmount` ~0.5-1.
- Speed-sense list (mostly standard practice, partially from racing-game source): FOV widening with speed (`camera.fov = base + k*v`, update projection); camera shake + slight trailing lag; radial vignette; instanced **skid marks** (`InstancedMesh` of planes at wheel contact, ring buffer, `depthWrite:false`, see racing-game `Skid.tsx`) and dust/spark sprites; roadside instanced props (cones/barriers/lights) passing at speed; `Fog` matched to horizon colour; light streaks via bloom on emissive tail lights; heat-haze none needed. Panning camera with slow shutter feel = motion blur with large `blurAmount` only on background (needs depth mask) - optional.

## 8. Post-processing stack suggestion
Order (WebGL composer): RenderPass(MSAA HalfFloat) -> (optional GTAO) -> UnrealBloomPass (threshold ~1.0 to bloom only HDR emissives; strength 0.15-0.4) -> subtle vignette/film grain (custom ShaderPass) -> OutputPass (Neutral/AgX). Keep bloom threshold >= 1 so paint highlights do not bloom unexpectedly.

## 9. Performance notes
- Cap `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))`, 1.5 on touch (LUSTRE did this); dynamic resolution if frame time > budget.
- Planar reflector + contact shadow + transmission each re-render the scene: budget them; use `layers` to render only needed objects.
- Disable iridescence/clearcoat-normal on low tier; share one body material; `KTX2` for textures; Draco/Meshopt for the car glb.
- Do not let a `CubeCamera`/probe capture the car itself (Babylon forum guidance; applies equally).

## Recommendations for Suspension Lab
1. **Baseline**: r187, `WebGLRenderer` + `NeutralToneMapping` (A/B with AgX), exposure ~0.85-1.0, studio env from lightformer-style `PMREMGenerator.fromScene` for the inspect/x-ray view, a low-sun HDRI + `GroundedSkybox` (following the car) for the track view. Both lighting rigs behind one swappable `Environment` module.
2. **Car paint**: the official recipe (`metalness 1, roughness .5, clearcoat 1, clearcoatRoughness .03`) + procedural flake normal and orange-peel `clearcoatNormalMap`; optional subtle iridescence variant. Material module exposes colour/finish presets (gloss, satin/matte, pearl).
3. **Grounding**: chassis-parented baked AO plane (bake from our model) + realtime ContactShadows (256-512, car layer only) + one car-following directional shadow. AccumulativeShadows only for the static garage view via `@pmndrs/vanilla`.
4. **Wet asphalt**: port `MeshReflectorMaterial` (via `@pmndrs/vanilla`) at half resolution with a roughness/puddle mask - not a mirror `Reflector`.
5. **AA**: MSAA 4x on the composer RT (+ SMAA optional); TAARenderPass only when paused/inspecting (accumulates when still). Avoid TAA while driving unless we move to WebGPU TRAANode.
6. **Wheels**: implement the sharp-rim -> blur-overlay crossfade driven by angular velocity (wheel-arch motion is the money shot for a suspension demo); keep real rotation for the tyre.
7. **Speed**: FOV/shake/instanced skids/roadside props + bloom on lights; full-screen motion blur is a WebGPU-only nice-to-have.
8. **Licensing**: all code above is MIT/Zlib/Apache. Do **not** ship the Ferrari glb without confirming its licence (reported CC BY 4.0 -> attribution) and prefer our own/CC0 car model; HDRIs from Poly Haven (CC0, verify each).
9. Unverified/gaps: no documented Active Theory/Lusion car techniques found; Codrops has no car tutorial found; PlayCanvas/Babylon notes are forum-snippet level only.
