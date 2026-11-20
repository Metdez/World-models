# 10 - Shader research for Three.js engineering-visualisation look

Date: 2026-11-20. Method: npm registry, raw.githubusercontent.com, the three.js 0.187.0 npm tarball (unpacked and grepped, so every TSL export / example name below marked VERIFIED was seen in source), web search. GitHub API was blocked in this sandbox, so star counts and last-commit dates are NOT available (marked "n/a"). Snippets written by me are marked ORIGINAL (no licence issue, but UNTESTED: they were not run in a browser).

---------------------------------------------------------------------
## A. State of the art (Nov 2026)

### Versions (VERIFIED, npm registry)
| package | latest | licence | note |
|---|---|---|---|
| three | **0.187.0** (published 2026-10-30; 0.186.0 2026-09-08, 0.186.1 2026-09-24) | MIT | monthly cadence |
| three-custom-shader-material | 6.4.0 | MIT | peer three>=0.159; README has no WebGPU/TSL mention (grep empty) => WebGLRenderer only |
| postprocessing (pmndrs) | 6.39.6 | Zlib (permissive, OK) | README has no WebGPU mention => WebGLRenderer only |
| three-mesh-bvh | 0.9.18 | MIT | |

### WebGPURenderer + TSL maturity
- Import paths: `import * as THREE from 'three/webgpu'` and `import { ... } from 'three/tsl'`. Materials are `*NodeMaterial` (MeshStandardNodeMaterial, MeshBasicNodeMaterial, Line2NodeMaterial, ...). VERIFIED in 0.187 examples.
- **Automatic WebGL2 fallback is built in**: `WebGPURenderer` falls back to a `WebGLBackend` when WebGPU is unavailable; `{ forceWebGL: true }` forces it (VERIFIED src/renderers/webgpu/WebGPURenderer.js). TSL compiles to WGSL or GLSL from one graph, so one codebase covers both.
- Post-processing class was renamed `PostProcessing` -> **`RenderPipeline`** (around r183; search result, and 0.187 examples use `new THREE.RenderPipeline(renderer)` with `.outputNode` - VERIFIED). Old tutorials using `PostProcessing` are stale.
- The 0.187 addon set under `three/addons/tsl/display/` is large (VERIFIED listing): BloomNode, GTAONode, SSAONode, SSGINode, SSRNode, SSSNode, TRAANode, SMAANode, FXAANode, DepthOfFieldNode, MotionBlur, **OutlineNode**, **SobelOperatorNode**, **OITPassNode** (weighted-blended order-independent transparency), GodraysNode, LensflareNode, Lut3DNode, FilmNode, CRT, PixelationPassNode, ChromaticAberrationNode, etc. That is a full replacement for the old EffectComposer/pmndrs stack.
- Parity items relevant to us, all VERIFIED as shipped examples in `examples/files.json`: `webgpu_clipping`, **`webgpu_clipping_stencil`**, `webgpu_lines_fat`, `webgpu_lines_fat_wireframe`, `webgpu_postprocessing_outline`, `webgpu_postprocessing_ao/bloom/bloom_selective`, `webgpu_sky`, `webgpu_ocean`, `webgpu_materials_transmission`. Addons `three/addons/lines/webgpu/{Line2,LineSegments2,Wireframe}.js` exist. `SkyMesh.js` (TSL Preetham sky; its doc says WebGPURenderer-only, use `Sky` for WebGLRenderer) and `WaterMesh.js` exist.
- Official manual says WebGPURenderer is where all new feature work goes ("no plans to add larger new features" to the old renderer). Third-party guidance: pin the three version, API still moves between monthly releases (e.g. PostProcessing rename).
- Real-world proof it works for a cinematic scene: **ektogamat/threejs-conference ("Threejs-Punk")**, MIT, three ^0.185, WebGPU+TSL, wet pavement, car-surface rain, GTAO/bloom/DoF `RenderPipeline`, BVH. Its README documents gotchas: Safari may block the animation loop until shaders compile (do a split warm-up compile), Safari: cap DPR; TSL `reflector()` inside a PassNode binds texture as sampled+attachment on WebGPU, so it renders its mirror in a separate `renderer.render` into its own RT.

### Browser support (web.dev "WebGPU is now supported in major browsers", late-2025 snapshot; Nov-2026 coverage % is UNVERIFIED - caniuse not reachable)
- Chrome/Edge: desktop since v113 (Win/Mac/ChromeOS; Linux later), Android Chrome 121+ (Android 12+, Qualcomm/ARM).
- Safari 26: macOS/iOS/iPadOS/visionOS.
- Firefox: Windows 141, macOS Tahoe ARM64 145; Linux / Android / Intel-Mac were "in progress" at that snapshot (may have shipped since: unverified).
- Net: a desktop-first product gets native WebGPU on essentially all current Chrome/Edge/Safari and Firefox-Windows; the long tail (older Firefox, Linux, old GPUs/blocklisted drivers) lands on the WebGL2 backend. That is exactly what `WebGPURenderer` auto-fallback is for.

### Decision: WebGLRenderer+GLSL vs WebGPURenderer+TSL
| | WebGLRenderer + GLSL (ShaderMaterial / onBeforeCompile / CSM) | WebGPURenderer + TSL (NodeMaterial) |
|---|---|---|
| Pros | Most snippets in the wild are GLSL (copy-paste); pmndrs/postprocessing, CSM, drei, THREE.MeshLine all work; battle-tested, stable; stencil caps, clipping, onBeforeCompile hooks known-good | Future of three.js; one graph -> WGSL+GLSL; auto WebGL2 fallback; compute shaders (spring/suspension particles, trails in storage buffers); official OIT, GTAO, SSGI, Outline, Sobel nodes; materials compose with PBR lighting via `colorNode/roughnessNode/normalNode/emissiveNode/positionNode/opacityNode`; no `#include` string patching (the fragile part of onBeforeCompile) |
| Cons | Legacy path (no new features); string-patching breaks across three releases; GLSL does not run on WebGPU backend; one-off shader compile hitches | API churn each monthly release (pin version, e.g. 0.187.0); fewer copy-paste snippets (must translate GLSL -> TSL); WebGL2-fallback backend has edge-case gaps (test it explicitly with `forceWebGL`); no CSM / pmndrs postprocessing; Safari compile-stall gotcha; ecosystem libs (R3F/drei) lag |
| Post gotchas | pmndrs/postprocessing is excellent but WebGL-only; EffectComposer + MSAA needs `multisampling`; outline/selective bloom needs layer juggling | Use `RenderPipeline` + `pass(scene,camera)` + MRT; `reflector()`/planar reflection inside a pass can conflict (separate RT); transparent+OIT only for NormalBlending non-transmission; MSAA with OIT only on native WebGPU backend; keep passes half-res on mobile |

**Recommendation: WebGPURenderer + TSL with automatic WebGL2 fallback, pinned `three@0.187.0`.** Rationale: the product needs many custom looks (x-ray, heatmap, grid, asphalt, hologram) that are each small, compose with PBR, and are ~30-line TSL graphs; official Outline/OIT/GTAO/Bloom nodes cover post; compute shaders are available for trails and spring visualisations. Keep GLSL snippets (Section B) as a translation reference only. Fallback plan: if a feature misbehaves in the WebGL2 backend, gate it behind a feature flag per module (each effect module exposes `supports(renderer)`), not a second renderer. If the team wants a zero-risk path, WebGLRenderer + GLSL + pmndrs/postprocessing is still fully viable today, but is a dead-end for new three.js features.

---------------------------------------------------------------------
## B. Liftable code, by effect

Licence legend: OK = MIT/BSD/Apache/ISC/Zlib/CC0. three.js core+addons = MIT (VERIFIED /LICENSE).

### 1. X-ray / ghost / fresnel rim / cutaway

**1a. Fresnel rim ghost body (additive or alpha), TSL, ORIGINAL (names VERIFIED to exist in three/tsl: `normalView`, `positionViewDirection`, `oneMinus`, `pow`):**
```js
import * as THREE from 'three/webgpu';
import { normalView, positionViewDirection, pow, saturate, uniform, vec3, float, mix } from 'three/tsl';

export function makeGhostMaterial({ color = 0x66ccff, power = 2.5, baseAlpha = 0.06 } = {}) {
  const m = new THREE.MeshBasicNodeMaterial();
  const uColor = uniform(new THREE.Color(color));
  const uPower = uniform(power);
  const ndv   = saturate(normalView.dot(positionViewDirection));   // 1 facing camera, 0 at silhouette
  const rim   = pow(float(1).sub(ndv), uPower);                    // fresnel
  m.colorNode   = uColor;
  m.opacityNode = rim.mul(0.9).add(baseAlpha);
  m.transparent = true;
  m.depthWrite  = false;            // body must not occlude the suspension
  m.blending    = THREE.AdditiveBlending;
  m.side        = THREE.FrontSide;
  return m;
}
```
GLSL equivalent (ORIGINAL, for onBeforeCompile / ShaderMaterial):
```glsl
// vertex: vNormal = normalize(normalMatrix*normal); vView = -(modelViewMatrix*vec4(position,1.)).xyz;
float f = pow(1.0 - saturate(dot(normalize(vNormal), normalize(vView))), uPower);
gl_FragColor = vec4(uColor, f*0.9 + uBase);
```
Draw order for "see the suspension through the body": render opaque chassis/suspension first, then ghost body with `depthWrite=false`, `renderOrder` high. Because the ghost shell does not write depth, no depth peeling is needed; inner faces (BackSide) can be given a second, dimmer pass for a "glass" look.

**1b. Dithered (screen-door) transparency - zero sorting, works with depth write, ORIGINAL using three's `interleavedGradientNoise` (VERIFIED export in three/tsl; also `screenCoordinate` VERIFIED):**
```js
import { interleavedGradientNoise, screenCoordinate, uniform } from 'three/tsl';
const uFade = uniform(0.35);                 // 1 = solid, 0 = gone (animate per panel for x-ray reveal)
mat.opacityNode = float(1);                  // keep opaque pipeline
mat.alphaTestNode = interleavedGradientNoise(screenCoordinate).greaterThan(uFade).select(1.0, 0.0); // discard where noise>fade => verify direction when wiring
mat.alphaTest = 0.5;
```
GLSL (ORIGINAL; IGN formula from Jimenez 2014 "Next Generation Post Processing in Call of Duty", public technique):
```glsl
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
if (ign(gl_FragCoord.xy) > uFade) discard;   // combine with TAA (TRAANode) to smooth the pattern
```
Pair with `TRAANode` (VERIFIED in addons/tsl/display) so the dither integrates to smooth translucency.

**1c. Order-independent transparency (official):** `three/addons/tsl/display/OITPassNode.js` -> `renderPipeline.outputNode = oitPass(scene, camera)` (weighted blended OIT, McGuire & Bavoil; MIT with three). Only NormalBlending, non-transmission transparent materials qualify. This is the no-depth-peeling answer for stacked glass panels / multiple ghost layers. VERIFIED source.

**1d. Clipping-plane cutaway with stencil caps (solid look at the cut):**
- Source: `https://github.com/mrdoob/three.js/blob/dev/examples/webgpu_clipping_stencil.html` (WebGPU/TSL version, MIT) and `webgl_clipping_stencil.html` (WebGL). Both fetched and read.
- Pattern (WebGPU version, per plane i, `stencilBit = 1<<i`):
  1. For each plane, add to the object a group of 2 meshes with `colorWrite=false, depthWrite=false, depthTest=false, stencilWrite=true, stencilFunc=AlwaysStencilFunc, clippingPlanes=[plane]`; WebGL version uses BackSide `IncrementWrap` + FrontSide `DecrementWrap`; WebGPU version uses `InvertStencilOp` with `stencilWriteMask = stencilBit`.
  2. A cap `PlaneGeometry` mesh per plane with `stencilWrite=true, stencilRef=0, stencilFunc=NotEqualStencilFunc, stencilFail/ZFail/ZPass=ReplaceStencilOp, clippingPlanes = other planes`, `onAfterRender: renderer.clearStencil()` (WebGL), renderOrder just after the stencil group; plane follows the clip plane (`plane.coplanarPoint(po.position); po.lookAt(...)`).
  3. Real material gets `clippingPlanes: planes` (+ `clipShadows`). Renderer needs `{ stencil: true }` and (WebGL) `renderer.localClippingEnabled = true`.
- Gotcha: the stencil trick needs a **closed (watertight) mesh**. A car body shell from a GLB is rarely watertight -> do the cutaway on the *suspension/chassis proxy* or fake the cap, or use dithering/ghosting for the body instead. Hold-open option: `webgpu_clipping` (no caps).

### 2. Blueprint / technical wireframe and edge outlines

- **Fat lines (built-in, MIT):** `three/addons/lines/{Line2,LineSegments2,LineGeometry,LineSegmentsGeometry,LineMaterial,Wireframe,WireframeGeometry2}.js`; WebGPU variants in `three/addons/lines/webgpu/{Line2,LineSegments2,Wireframe}.js` (use `Line2NodeMaterial`). Example: `new LineSegments2(new LineSegmentsGeometry().fromEdgesGeometry(new THREE.EdgesGeometry(geo, 30)), new LineMaterial({color, linewidth: 1.5, worldUnits:false, dashed:false}))`; remember `material.resolution.set(w,h)` on resize (WebGL LineMaterial).
- **Conditional (silhouette+crease) edges, MIT (Garrett Johnson):** `https://github.com/gkjohnson/threejs-sandbox/tree/master/conditional-lines/src/` -> `ConditionalEdgesGeometry.js` (144 lines, builds control0/control1/direction attributes from mesh adjacency), `ConditionalEdgesShader.js` (97 lines, GLSL), `OutsideEdgesGeometry.js`; demo `https://gkjohnson.github.io/threejs-sandbox/conditional-lines/`. Repo LICENSE = MIT (c) 2018 Garrett Johnson (VERIFIED). Key shader idea (copy):
```glsl
// vertex: project line endpoints and the two "control" vertices (the opposite vertices of the two adjacent faces) to NDC
vec2 dir  = p1.xy - p0.xy;  vec2 norm = vec2(-dir.y, dir.x);
float d0 = dot(normalize(norm), normalize(c0.xy - p1.xy));
float d1 = dot(normalize(norm), normalize(c1.xy - p1.xy));
// if the two control points lie on opposite sides of the line the edge is a silhouette -> keep; same side -> crease interior -> discard
gl_Position = (sign(d0) != sign(d1)) ? c0 : gl_Position;   // degenerate-clips the segment
```
  Written for WebGL `ShaderMaterial` with #includes; port to TSL = `positionNode`/vertex-stage `vec4` returning degenerate position (untested). Gives true "technical drawing" silhouette lines for the body shell (feature lines only, no triangle noise). Note: the repo README says experiments "not necessarily ready to include in projects"; credit appreciated, not required.
- **Post outline:** `three/addons/tsl/display/OutlineNode.js` (`outline(scene,camera,{selectedObjects, edgeGlow, edgeThickness})` returns `{visibleEdge, hiddenEdge}`; VERIFIED in `webgpu_postprocessing_outline.html`). `hiddenEdge` gives the see-through-occluder silhouette - ideal for highlighting the selected suspension through the body:
```js
outlinePass = outline(scene, camera, { selectedObjects, edgeGlow: uniform(0), edgeThickness: uniform(1) });
const { visibleEdge, hiddenEdge } = outlinePass;
const col = visibleEdge.mul(visibleCol).add(hiddenEdge.mul(hiddenCol)).mul(edgeStrength);
renderPipeline.outputNode = col.add(pass(scene, camera));
```
  Also `SobelOperatorNode.js` (`sobel(node)`) for a depth/normal-buffer edge detect (blueprint look): feed it a normal/depth MRT target. For WebGL: `three/addons/postprocessing/OutlinePass.js`.
- **Blueprint look recipe:** background `#0b2a4a`, lines `#9fd4ff`, `GridHelper`/grid shader (7), conditional edges for body, flat unlit `MeshBasicNodeMaterial` with very low alpha fill, dimension arrows (6). No extra library needed.

### 3. Heat-map / force colouring
Colour ramp (viridis-ish / inferno-ish piecewise; ORIGINAL; coefficients are a common polynomial approximation of Viridis from Matt Zucker's public-domain-style shader gist "viridis" - verify before shipping; otherwise use a 3-5 stop `mix` ramp as below which is safe):
```glsl
vec3 heat(float t){            // t in [0,1]: blue(unloaded) -> cyan -> green -> yellow -> red(max load)
  t = clamp(t,0.,1.);
  vec3 a = vec3(0.05,0.20,0.85), b = vec3(0.0,0.85,0.95), c = vec3(0.1,0.9,0.2), d = vec3(1.0,0.85,0.0), e = vec3(1.0,0.1,0.05);
  return t<.25? mix(a,b,t*4.) : t<.5? mix(b,c,(t-.25)*4.) : t<.75? mix(c,d,(t-.5)*4.) : mix(d,e,(t-.75)*4.);
}
```
TSL (ORIGINAL): uniform `uLoad` (0..1) per spring/tyre; `mat.colorNode = heat(uLoad)`; glow: `mat.emissiveNode = heat(uLoad).mul(uLoad.mul(2.0))`, then `BloomNode` (selective bloom: MRT `emissive`, see wiki "emissive" MRT example, or `webgpu_postprocessing_bloom_emissive`). Spring compression per-instance: pass `compression = (L0-L)/L0` as an `instancedBufferAttribute` and read in `colorNode`. Tyre load glow = ground-contact decal (5) tinted by `heat(Fz/Fz_max)`.
Why not `viridis` for the product: a diverging blue->red ramp reads as "load" instantly; keep colour-blind-safe option (viridis) as a toggle.

### 4. Asphalt / road shader
No standalone permissively-licensed procedural-asphalt-for-three exists that I could verify; the best liftable pieces:
- **Wet ground ripples + planar reflection, TSL, MIT:** `https://github.com/ektogamat/threejs-conference` (c) 2026 Anderson Mancini and Sunag, LICENSE=MIT VERIFIED. Files: `src/tsl/rainRipples.js` (`createRainRipples({uTime,uRippleSpeed})` -> `Fn` returning a ripple normal `vec3`; sampled with `positionWorld.xz.mul(scale)`), `src/world/ground/createGround.js`, docs `docs/techniques/wet-ground.md`, `car-surface-rain.md`. Caveat: `src/tsl/surfaceRain.js` is adapted from rocksdanister/rain (BigWings MovingDropLayer) whose licence the repo does not cover => do NOT lift surfaceRain.js without checking that licence; rainRipples.js uses Dave Hoskins-style `hash12/hash22` (hash-without-sine, MIT-licensed per his shadertoy header; credit).
- **Procedural asphalt recipe (ORIGINAL, TSL):** use three's MaterialX noise (VERIFIED exports `mx_noise_float, mx_fractal_noise_float, mx_worley_noise_float`) in world XZ:
```js
import { positionWorld, mx_fractal_noise_float, mx_worley_noise_float, mx_noise_float, smoothstep, mix, vec3, float, uv, abs, fract, step, uniform } from 'three/tsl';
const p = positionWorld.xz;
const grain = mx_worley_noise_float(p.mul(220)).oneMinus();             // aggregate speckle (fine)
const mottle = mx_fractal_noise_float(p.mul(0.6), 4, 2.0, 0.5);         // large-scale patchiness (check signature in 0.187)
const base = mix(vec3(0.07,0.07,0.075), vec3(0.16,0.16,0.17), smoothstep(0.55,0.95,grain).mul(0.6).add(mottle.mul(0.15)));
// lane/edge lines from road-space UV: u across the road (0..1), v along (metres)
const u = uv().x, v = uv().y.mul(uRoadLength);
const edge  = step(abs(u.sub(0.04)), 0.004).max(step(abs(u.sub(0.96)), 0.004));          // solid edge lines
const dash  = step(abs(u.sub(0.5)),  0.004).mul(step(fract(v.div(12.0)), 0.4));          // dashed centre
const paint = edge.max(dash).mul(smoothstep(0.35,0.6,grain.add(0.2)));                   // worn paint via grain
mat.colorNode = mix(base, vec3(0.92), paint);
mat.roughnessNode = mix(float(0.92), float(0.35), uWet.mul(smoothstep(0.4,0.7,mottle)));  // wet patches = low roughness
```
  Kerbs: separate mesh strip with red/white `step(fract(v/ 1.0),0.5)` colorNode. Detail normal: `normalMap(texture(detail, positionWorld.xz.mul(8)))` or `bumpMap(grain)` (both VERIFIED exports). Triplanar for banked/uneven surfaces: `triplanarTexture(...)` (VERIFIED export).
- Noise GLSL library for the WebGL path: `https://gist.github.com/patriciogonzalezvivo/670c22f3966e662d2f83` (Gustavson/McEwan `webgl-noise`, MIT; Morgan McGuire hash/noise - check each header).
- Road geometry itself (centreline ribbon with banking + distance UVs) = **makio-meshline road surfaces** (see 6).

### 5. Contact-patch / tyre footprint decals
- `three/addons/geometries/DecalGeometry.js` (MIT, VERIFIED present): projects a box onto a mesh; fine for static skid marks. For a per-frame footprint use a cheaper approach: a flat quad parented to the ground at the contact point, shader SDF:
```glsl
// ORIGINAL: elliptical footprint, width w (m), length l (m), pressure-like falloff
vec2 q = (vUv - 0.5) * vec2(2.0);                       // quad covers contact patch bounds
float r = length(q / vec2(uHalfW, uHalfL));              // 1 at ellipse edge (superellipse: pow(abs(q.x/a),n)+pow(abs(q.y/b),n))
float a = smoothstep(1.0, 0.85, r);                      // soft edge
float pressure = a * (1.0 - 0.6*r*r);                    // brighter in the centre
gl_FragColor = vec4(heat(uLoad * pressure + 0.0), a*0.85);   // tint by Fz
```
  Size from physics: contact patch area A ~= Fz / p_tyre (p ~ 2.2 bar = 2.2e5 Pa) -> with width w from tyre spec, length l = A/w. Compression of load on the left/right rear in a corner then visibly shifts patch area and colour (honest, physical, cheap). Rotate quad by wheel steer/slip angle; draw with `depthWrite=false`, `polygonOffset` to avoid z-fight (`depthTest` true, offset -1).
- Skid/trail marks persisting behind the car: ring-buffer of quads, or makio-meshline (6) as a ground ribbon.

### 6. Animated force arrows / vector fields / trails
- **Makio64/makio-meshline** - `https://github.com/Makio64/makio-meshline`, LICENSE MIT (c) 2025 David Ronai (VERIFIED), README: three r186+, **TSL, WebGPU and WebGL2**, 14 GPU hooks (position/colour/width/opacity/dash/uv), instancing, gradients, dashes, textures, variable width, joins (miter/bevel/round), **road & ribbon surfaces** (banking, normals, distance UVs), shadows, **compute-driven trails**: `storagePositions()` ring buffers. Docs `https://meshline.makio.io/`, demos `https://meshline-demo.makio.io/`. This is the best single dependency for wheel-path trails, force-vector lines and the road ribbon. Stars/last commit: n/a (API blocked); it targets r186+, so it is current. Status: young library (2025), pin the version.
- **spite/THREE.MeshLine** (MIT c) 2016 Jaume Sanchez, VERIFIED): README "2026 update": needs three r155+, ES module; recommends `Line2/LineSegments2/LineMaterial` unless you need width-along-line, texture along line, `visibility`, `advance()` (cheap trails). WebGLRenderer only (ShaderMaterial). pmndrs/meshline is a maintained fork (licence not verified).
- **Force arrows (ORIGINAL pattern, recommended):** one `InstancedMesh` of a merged cylinder+cone (arrow along +Y); per-instance matrix = position at contact/anchor, quaternion from force direction, scale.y = |F|/Fref; per-instance colour via `instanceColor`/heat ramp (3); animate marching "flow" with `colorNode` using `fract(positionLocal.y*k - time)` stripes. Draw on top with `depthTest=false`/high renderOrder or only show via the x-ray state.
- Wheel path / motion trail: ring-buffer of N world points per wheel -> makio-meshline ribbon with `opacity = 1 - age`, or Line2 with vertex colours; for a very cheap fallback `LineSegments2.advance`-style shifting. Trail ribbons also cheap as a `PlaneGeometry` strip with `positionNode` reading a `DataTexture`/storage buffer of history points.

### 7. Ground grid / infinite grid
- **Fyrestar/THREE.InfiniteGridHelper** `https://github.com/Fyrestar/THREE.InfiniteGridHelper`, MIT (c) 2019 Fyrestar (VERIFIED LICENSE), 178 stars (per GitHub page), file `InfiniteGridHelper.js` (read in full). WebGL `ShaderMaterial`, needs `fwidth` (WebGL2 ok). Core you copy:
```glsl
float getGrid(float size) {
  vec2 r = worldPosition.xz / size;
  vec2 grid = abs(fract(r - 0.5) - 0.5) / fwidth(r);   // 1px-wide AA lines regardless of distance
  float line = min(grid.x, grid.y);
  return 1.0 - min(line, 1.0);
}
// d = 1 - min(distance(cameraPosition.xz, worldPosition.xz)/uDistance, 1);  alpha = mix(g2,g1,g1)*pow(d,3.0)
// vertex: plane of size 2x2 scaled by uDistance and re-centred on the camera each frame => "infinite"
```
- **drei `Grid`** (`pmndrs/drei/src/core/Grid.tsx`, MIT (c) 2020 react-spring, VERIFIED header): derived from Fyrestar + threlte; adds cell+section sizes/thickness/colours, `fadeDistance, fadeStrength, fadeFrom`, `followCamera`, `infiniteGrid`. Ready-to-copy GLSL (read in full): same `getGrid(size, thickness)` with `+ 1.0 - thickness`.
- **TSL port (ORIGINAL, uses VERIFIED `fwidth`, `positionWorld`, `cameraPosition`)**:
```js
const gridLine = (size, thick) => {
  const r = positionWorld.xz.div(size);
  const g = r.sub(0.5).fract().sub(0.5).abs().div(r.fwidth());
  return float(1).sub(min(min(g.x, g.y).add(float(1).sub(thick)), 1));
};
const d = float(1).sub(min(positionWorld.xz.sub(cameraPosition.xz).length().div(uFade), 1));
const a = gridLine(1,0.5).add(gridLine(10,1)).mul(pow(d, uFadeStrength));
mat.colorNode = uGridColor; mat.opacityNode = a; mat.transparent = true; mat.depthWrite = false;
```
  Recentre the mesh on the camera XZ each frame (snap to cell multiple to avoid shimmer). Also `GridHelper` built-in for static boards.

### 8. Stylised sky / atmosphere / fog
- Built-in, MIT: `three/addons/objects/Sky.js` (GLSL, WebGLRenderer) and **`SkyMesh.js`** (TSL, WebGPURenderer only; Preetham analytic daylight; params turbidity, rayleigh, mieCoefficient, mieDirectionalG, sunPosition) - VERIFIED. Example `webgpu_sky`. Render the sky into a cube once (`PMREMGenerator`/`CubeCamera`) for IBL (docs recommend hiding the sun disc when generating env).
- Stylised alternatives: vertical gradient dome `mix(horizonCol, zenithCol, smoothstep(0, 1, normalize(positionWorld).y))` with a dithered band (`interleavedGradientNoise`) to kill banking; fog: `scene.fog = new THREE.FogExp2(col, 0.012)` or TSL `scene.fogNode = fog(colorNode, rangeFogFactor(near,far))`/`densityFogFactor`; match fog colour to horizon colour. For a lab/blueprint mode: fade the road to the background colour with `fadeDistance` as in the grid shader.
- Ground-horizon blend: `GroundedSkybox.js` (VERIFIED present).

### 9. Holographic / scanline "lab" overlays
- **ektogamat/threejs-holographic-material** `https://github.com/ektogamat/threejs-holographic-material`: README states MIT (VERIFIED text: "open-source ... (MIT) license"; a separate LICENSE file path returned HTML, so confirm in the repo before shipping), React component + `src/HolographicMaterial.js` exists (200). Params: fresnelAmount/Opacity, scanlineSize, hologramBrightness, signalSpeed, hologramColor, blinkFresnelOnly, enableBlinking. GLSL/WebGL (`ShaderMaterial`-based). Demo https://threejs-vanilla-holographic-material.vercel.app/ . Good source to read for a GLSL reference.
- Three.js Journey "Hologram Shader" lesson code is course material: NOT liftable (licence unclear).
- **TSL scanline overlay (ORIGINAL)**:
```js
const scan = sin(positionWorld.y.mul(120.0).sub(time.mul(2.0))).mul(0.5).add(0.5).pow(3.0);     // moving scanlines
const flicker = mx_noise_float(vec3(time.mul(8.0), 0, 0)).mul(0.05).add(0.95);
mat.colorNode = uHoloColor.mul(scan.mul(0.6).add(0.4)).mul(flicker);
mat.opacityNode = rim(1b).mul(0.8).add(scan.mul(0.15));
```
  Screen-space variant (full-screen lab overlay): `RenderPipeline` with `CRT.js` / `FilmNode` / `PixelationPassNode` from addons/tsl/display (VERIFIED), or `screenUV.y` scanlines multiplied on the final colour. `DigitalGlitch` (addons/shaders) for glitch (WebGL EffectComposer path).

### 10. Coil spring that compresses (vertex-shader helix)
No licensed library found (Discourse thread "Create a spring" only says it can be done in shaders). Self-contained maths (ORIGINAL). Build **once** a static tube mesh (wire radius r_w) with attributes `aT` (0..1 along wire, the coil parameter) and `aPhi` (0..2pi around the wire cross-section); the vertex shader computes the centreline and extrudes:
```glsl
uniform float uLen;       // current free length L (metres) = L0 - compression
uniform float uTurns;     // active coils N (constant)
uniform float uR;         // mean coil radius
uniform float uWire;      // wire radius
attribute float aT;       // 0..1
attribute float aPhi;     // 0..2pi
void main(){
  const float TAU = 6.28318530718;
  float th = aT * uTurns * TAU;                         // coil angle
  vec3 C  = vec3(uR*cos(th), aT*uLen, uR*sin(th));      // centreline: helix along Y, compresses by shrinking uLen (pitch = uLen/uTurns)
  vec3 Tn = normalize(vec3(-uR*sin(th)*uTurns*TAU, uLen, uR*cos(th)*uTurns*TAU)); // dC/daT
  vec3 Nr = vec3(cos(th), 0.0, sin(th));                // radial
  vec3 B  = normalize(cross(Tn, Nr));
  vec3 off = (cos(aPhi)*Nr + sin(aPhi)*B) * uWire;      // tube cross-section
  vec4 wp = modelMatrix * vec4(C + off, 1.0);
  vNormal = normalMatrix * (cos(aPhi)*Nr + sin(aPhi)*B);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
```
Notes: set `uLen` each frame from the suspension solver (spring length between its two chassis/arm anchors) - the helix then compresses in the same way the real spring does, pitch shrinks, wire diameter constant; clamp `uLen >= uTurns*2*uWire` (coil-bind / solid height) to show coil bind honestly; heat-colour by compression `(L0-L)/L0` (3). To orient between two arbitrary anchor points, give the mesh a model matrix from `lookAt(anchorA, anchorB)` and set `uLen = |A-B|`. TSL translation: put the same math in `material.positionNode` and `normalNode` with `attribute('aT')`, `attribute('aPhi')`, `uniform()`s. Alternative for bump/telescopic fork spring: same mesh, axis = fork tube.

---------------------------------------------------------------------
## C. Licence audit summary
| item | licence | verdict |
|---|---|---|
| three.js core + addons (Line2, OutlineNode, OITPassNode, SkyMesh, DecalGeometry, webgpu_* examples) | MIT | usable |
| gkjohnson/threejs-sandbox (conditional-lines) | MIT (c) 2018 G. Johnson | usable (credit appreciated) |
| Fyrestar/THREE.InfiniteGridHelper | MIT (c) 2019 | usable |
| pmndrs/drei Grid | MIT (header of repo "(c) 2020 react-spring") | usable |
| Makio64/makio-meshline | MIT (c) 2025 David Ronai | usable |
| spite/THREE.MeshLine | MIT (c) 2016 Jaume Sanchez | usable (WebGL only) |
| ektogamat/threejs-conference | MIT (c) 2026 Mancini & Sunag | usable EXCEPT surfaceRain.js (derived from rocksdanister/rain, licence unchecked) |
| ektogamat/threejs-holographic-material | MIT per README (no LICENSE file confirmed) | usable, confirm |
| pmndrs/postprocessing | Zlib | usable, WebGL-only |
| pmndrs/three-custom-shader-material | MIT | usable, WebGL-only |
| Three.js Journey lesson code | course content | NOT usable |
| Stars / last-commit numbers | n/a: GitHub API blocked | unverified; only Fyrestar's 178 stars seen on page |

---------------------------------------------------------------------
## D. Recommendations for Suspension Lab
1. **Renderer:** `three@0.187.0` pinned, `WebGPURenderer` with auto WebGL2 fallback, TSL `NodeMaterial`s throughout, `RenderPipeline` for post. Add an automated smoke test that boots both backends (`forceWebGL: true`). Do split shader pre-compilation behind the loading screen (Safari stall).
2. **Module layout (swappable):** `fx/xray`, `fx/edges`, `fx/heatmap`, `fx/road`, `fx/contactPatch`, `fx/vectors`, `fx/grid`, `fx/sky`, `fx/holo`, `fx/spring` - each exports a `createX({renderer, scene, uniforms})` returning `{update(dt, state), dispose()}`.
3. **See-through body:** default = fresnel ghost shell (1a, additive, depthWrite off) + `OutlineNode` `hiddenEdge` on the selected suspension (visible through the body); animate a dithered reveal (1b) + TRAA for the hero "x-ray" transition; use stencil-cap cutaway only on a watertight proxy (strut/hub/rotor) because the Aston-like body GLB will not be closed.
4. **Technical look:** conditional edges (silhouette/crease) for the body, `LineSegments2` fat lines for links/wishbones/tie-rods (width in pixels), grid from section 7 in blueprint mode, `CRT/Film` scanline post pass for the "lab" mode.
5. **Data viz:** one shared `heat()` ramp used by spring colour, tyre patch, arrow colour; physics-driven (compression ratio, Fz/Fz_max, motion-ratio-derived link load). Contact patch ellipse sized by Fz/pressure.
6. **Trails/arrows:** `makio-meshline` (TSL, compute ring-buffer trails, road/ribbon surfaces for the track itself with banking and distance UVs) + instanced arrows. Fallback if the library proves immature: `Line2NodeMaterial`.
7. **Track:** build the road as a ribbon (makio-meshline surfaces or own sweep), asphalt TSL recipe (4) with world-space noise (no UV tiling), lane/kerb from road-space UV, optional wet patches via roughness plus rainRipples.js (MIT) for rain mode; planar reflection must be a separate render target pass (known WebGPU pass-binding gotcha).
8. **Sky/atmosphere:** `SkyMesh` -> PMREM env for IBL + `FogExp2` coloured to horizon; stylised gradient dome for the lab mode.
9. **Spring:** the shader in 10 driven by the solver's spring length, with coil-bind clamp; same component reused for motorcycle fork/shock springs.
10. **Risks to track:** TSL API churn (pin + changelog check each bump); WebGL2-fallback parity (esp. stencil, MSAA+OIT); the Nov-2026 WebGPU coverage number is unverified - check caniuse before launch; verify holographic-material LICENSE file and surfaceRain.js upstream licence before copying.
