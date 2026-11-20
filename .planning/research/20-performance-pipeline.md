# 20 - Performance & asset pipeline (Three.js, desktop browser) - as of 2026-11-20

Legend: **[V]** = verified by me this session (read source from the npm tarball / ran it here); **[U]** = unverified engineering heuristic or recalled knowledge, validate on target hardware.

## 0. Current versions (npm registry, queried 2026-11-20) [V]
| Package | Version | License |
|---|---|---|
| three / @types/three | 0.187.0 | MIT |
| @gltf-transform/cli, core, functions | 4.5.1 | MIT |
| meshoptimizer (npm) / gltfpack (npm) | 1.3.0 | MIT |
| vite | 8.3.8 (Node ^20.19 or >=22.12) | MIT |
| vitest | 5.1.1 (Node ^22.12 / ^24 / >=26) | MIT |
| @playwright/test | 1.65.1 | Apache-2.0 |
| stats-gl | 4.2.3 (peer three >=0.170-ish `*`) | MIT |
| three-perf | 1.0.11 | MIT |
| three-mesh-bvh | 0.9.18 | MIT |
| typescript | 7.0.2 (npm "latest") | Apache-2.0 |
| vite-plugin-wasm | 3.6.0 | MIT |

Use Node 22.12+ (satisfies Vite 8 and Vitest 5). Pin exact three version (addons paths and `renderer.init()` semantics move between releases).

---
## A. glTF pipeline

### A1. glTF-Transform (donmccurdy/glTF-Transform, MIT) - docs: https://gltf-transform.dev (docs site returned 403 to my fetcher; flags below read directly from `@gltf-transform/cli@4.5.1/dist/cli.mjs`)

Install: `npm i -D @gltf-transform/cli @gltf-transform/core @gltf-transform/functions @gltf-transform/extensions meshoptimizer draco3dgltf sharp`
KTX2 encoding additionally needs the **KTX-Software `toktx` binary** on PATH (https://github.com/KhronosGroup/KTX-Software/releases). `sharp` is needed for resize/webp/avif/ktx2.

Commands (all `npx gltf-transform <cmd> in.glb out.glb`):
- `inspect in.glb [--format pretty|csv|md]` - scenes/meshes/materials/textures table, extensions used, byte split geometry vs textures. Run first and after every step. Also `validate in.glb` (Khronos validator) and `copy`.
- `dedup` - merges duplicate accessors/materials/meshes/textures.
- `prune` - drops unreferenced properties. **DANGER here:** in `optimize` it is called with `keepLeaves:false`, i.e. empty leaf nodes (suspension hard-point empties, wheel-centre pivots, "Camera_Anchor", etc.) are deleted. Use `--prune false` or call `prune({ keepLeaves: true })` in a script.
- `weld` - merges equivalent vertices (needed before simplify and Draco).
- `simplify --ratio 0.5 --error 0.0001 --lock-border false` - meshoptimizer simplifier; ratio = target fraction of vertices, error = fraction of mesh radius. Function defaults: `ratio:0, error:1e-4, lockBorder:false` (so by default it is error-limited). Use only for generating LOD files, not the hero LOD0.
- `flatten` - lifts every mesh node to scene root (leaves skeleton descendants alone; nodes targeted by animation aren't moved). **Destroys the hierarchy you need for wheels.**
- `join [--keepMeshes] [--keepNamed]` - merges compatible primitives; "implicitly runs dedup and flatten first" in the CLI command. Function defaults `keepMeshes:false, keepNamed:false`.
- `instance --min 2` - EXT_mesh_gpu_instancing for meshes repeated across nodes (good for trackside props; three.js GLTFLoader imports it as InstancedMesh).
- `palette`, `sparse`, `resample` (lossless keyframe dedup), `metalrough`, `unlit`.
- `draco`: `--method edgebreaker|sequential --encode-speed --decode-speed --quantize-position 14 ...`
- `meshopt --level medium|high --quantize-position/normal/texcoord/color`
- `quantize` (KHR_mesh_quantization only, no entropy coding; good before gzip/brotli).
- `resize --width 2048 --height 2048 [--pattern "*Normal*"] [--filter lanczos3]` (or `--power-of-two ceil|floor|nearest`; never upscales).
- `etc1s` / `uastc` (toktx): common flags `--slots "{baseColorTexture,emissiveTexture}"`, `--pattern`, `--resize 2048`, `--mipmaps`(default on), `--jobs`. ETC1S: `--quality 1-255` (optimize uses 255), `--compression 0-5`. UASTC: `--level 0-4` (2 default; 4 = best), `--rdo --rdo-lambda 0.25-10` (normals: 0.25-0.75), `--zstd 1-22`.
- `webp` / `avif` (sharp): `--quality`, `--lossless`, `--slots`; shrink transfer size only (decoded to RGBA8 in VRAM).

#### `optimize` one-shot - exact flags and defaults [V, cli.mjs v4.5.1]
`npx gltf-transform optimize in.glb out.glb [flags]`; internal order: dedup -> instance -> palette -> flatten -> join -> weld -> simplify -> resample -> prune -> sparse -> texture-compress -> geometry compress.
| Flag | Default | Notes |
|---|---|---|
| `--instance <bool>` / `--instance-min` | true / (min 2) | |
| `--palette <bool>` / `--palette-min` | true | merges solid-colour materials into palette textures; **turns separate paint/glass/rubber materials into shared ones** - disable for the car (we need per-material tweaks: paint colour, glass tint) |
| `--simplify <bool>`, `--simplify-ratio`, `--simplify-error`, `--simplify-lock-border` | **true**, ratio 0, error 1e-4, false | lossy by default! disable for hero |
| `--prune`, `--prune-attributes`, `--prune-solid-textures` | true,true,true | `prune` uses keepLeaves:false (see above) |
| `--sparse` | true | |
| `--compress draco\|meshopt\|quantize\|false` | **meshopt** | |
| `--meshopt-level medium\|high` | high | |
| `--texture-compress ktx2\|webp\|avif\|auto\|false` | auto (recompress in original format) | `ktx2` = UASTC (level 4, rdo, lambda 4) for normal/occlusion/metalRough slots + ETC1S (quality 255) for the rest |
| `--texture-size` | 2048 | max dimension |
| `--flatten`, `--join` | true, true | `--join` requires flatten |
| `--join-meshes`, `--join-named` | true, true (i.e. keepMeshes=false, keepNamed=false) | **named nodes/meshes get merged by default** |
| `--weld`, `--resample` | true, true | |

#### Keeping named wheel / suspension nodes intact
The runtime drives nodes by name (e.g. `Wheel_FL`, `Hub_FL`, `Knuckle_FL`, `Arm_Upper_FL`, `Spring_FL`...). Two safe options:

1. CLI (hierarchy kept, no merging, no leaf pruning, no lossy simplify, no palette):
```bash
npx gltf-transform optimize car_raw.glb car.glb \
  --flatten false --join false --palette false --simplify false --prune false \
  --instance false --compress meshopt --texture-compress ktx2 --texture-size 2048
```
   (If you do want some joining: `--join-named false --join-meshes false` keeps named nodes/meshes unmerged but still requires `--flatten` which re-parents - not wanted for wheels; so prefer `--join false`.)
   Convention to make this robust regardless of tool: every runtime-driven node has a name AND an `extras: { role: "wheel_FL" }`; Blender glTF exporter "Custom Properties" -> extras. Then `join({keepNamed:true})` keeps them.
2. Scripted (recommended for CI, full control) - `scripts/optimize-car.mjs`:
```js
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, resample, textureCompress, toktx, meshopt, quantize, getSceneVertexCount } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read('car_raw.glb');
await doc.transform(
  dedup(),
  weld(),                                   // lossless vertex merge
  resample(),
  prune({ keepLeaves: true, keepAttributes: false }),   // keep empty pivots/hardpoints
  // textures: UASTC for data maps, ETC1S for colour; needs toktx on PATH
  toktx({ encoder: sharp, mode: 'uastc', slots: /(normal|occlusion|metallicRoughness)Texture/, resize: [2048,2048], level: 4, rdo: true, rdoLambda: 1 }),
  toktx({ encoder: sharp, mode: 'etc1s', slots: /(baseColor|emissive)Texture/, resize: [2048,2048], quality: 200 }),
  meshopt({ encoder: MeshoptEncoder, level: 'high' }),
);
await io.write('car.glb', doc);
```
   (Function signatures for toktx/textureCompress/meshopt in 4.5.1 confirmed from the `optimize` source above; `slots` accepts a RegExp - `optimize` passes `micromatch.makeRe(...)`.) Wrap `join` only on non-driven static meshes by passing `filter: (prim) => ...` (JOIN_DEFAULTS has `filter`), or run join on a separate static "car body shell" glTF.
3. Last resort in Three: GLTFLoader keeps names (it also sanitises names via PropertyBinding.sanitizeNodeName - dots/spaces are changed; **use `[A-Za-z0-9_]` names only**, and when you must look up by name use `obj.getObjectByName(name)` with the sanitised name).

### A2. gltfpack (zeux/meshoptimizer, MIT) - alternative
`npx gltfpack -i car_raw.glb -o car.glb -cc -tc -kn -km -noq`... flags verified from https://raw.githubusercontent.com/zeux/meshoptimizer/master/gltf/README.md: `-cc` meshopt compress (+extra), `-tc` KTX2/BasisU (needs toktx-like basis encoder bundled; native binary build), `-si R` simplify, **`-kn` keep named nodes + meshes attached to named nodes so they can be transformed externally**, `-km` keep named materials, `-ke` keep extras, `-vpf` float positions (avoids extra dequantization nodes - helpful if you read raw positions), `-noq` disables KHR_mesh_quantization. Pros: one binary, fast, tight meshopt. Cons: merges materials/meshes aggressively unless `-kn/-km`; quantization inserts scale nodes at the root (matters if you read positions); less scripting control than glTF-Transform. **Recommendation: glTF-Transform script for the hero vehicles; gltfpack acceptable for trackside prop packs.** (`-cc` output requires `MeshoptDecoder` set on the loader - same as below.)

### A3. Draco vs Meshopt (hero car)
Measured decoder payloads from three@0.187.0 `examples/jsm/libs` [V]:
| Asset | raw | gzip -9 |
|---|---|---|
| `draco/gltf/draco_decoder.wasm` | 192 KB | 63 KB |
| `draco/gltf/draco_wasm_wrapper.js` | 58 KB | 11.5 KB |
| `draco/gltf/draco_decoder.js` (asm.js fallback, only for no-wasm) | 512 KB | 107 KB |
| `meshopt_decoder.module.js` (wasm embedded, bundled into JS) | 29 KB | 7.7 KB |
| `basis/basis_transcoder.wasm` | 527 KB | 245 KB |
| `basis/basis_transcoder.js` | 57 KB | 15 KB |

Tradeoffs [U for ratios, V for sizes]:
- Draco: best static-geometry compression (typically smallest download), but only triangle meshes/points, **no animation compression**, decode is async in a worker pool (DRACOLoader spins up workers + 250 KB wasm), lossy quantization produces slight normal/position drift and index re-ordering (vertex order destroyed - no morph-target-friendly), decode cost is ms-per-100k-tris and happens on every load.
- Meshopt (EXT_meshopt_compression + gzip/brotli): ~10-30% bigger than Draco after brotli on some meshes but near-instant decode (wasm, ~GB/s), 8 KB decoder inlined in JS (no extra request, no worker), compresses animation/morph, keeps vertex cache order (rendering speedups from vertex-cache/overdraw optimization), lossless-ish with 16-bit quantization. Cloudflare brotli compresses the .glb transport additionally.
- For a hero car whose payload is dominated by textures (not geometry), the geometry codec choice is second-order. **Pick meshopt** (simplest loader setup, no worker/wasm hosting, plus bundler `import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'` makes it part of the JS bundle). Use Draco only if the track/terrain mesh is huge static geometry and download size is critical.
- Important: do not mix; `--compress meshopt` default of `optimize` already matches.

### A4. Textures: KTX2 (UASTC vs ETC1S) vs WebP/AVIF
- GPU memory: PNG/JPEG/WebP/AVIF all decode to **uncompressed RGBA8** in VRAM: 2048x2048 = 16 MB (+33% mips = ~21 MB); 4096x4096 = 64 MB (~85 MB w/ mips). KTX2 Basis transcodes to **BC7 (desktop, 8 bpp = 1 byte/px) / ASTC / ETC2**: 2048^2 -> ~5.3 MB with mips, 4x less VRAM and faster upload. On integrated GPUs (shared memory, bandwidth-bound) that matters.
- ETC1S: smallest files (~1-2 bpp after zstd/brotli), lowest quality (blockiness on gradients, hurts smooth car paint/ clearcoat normals, good for diffuse/albedo/emissive of props).
- UASTC: ~4-8 bpp, near-lossless, use for **normal, ORM/metalRough, occlusion**, and car-paint flake normal. `optimize --texture-compress ktx2` already uses that split (UASTC for normal/occlusion/metalRough, ETC1S for rest).
- WebP/AVIF: smallest transfer for photographic maps but CPU decode + VRAM cost + AVIF decode jank; use for **UI/poster images and the HDR-less fallback**, not for the 3D materials. AVIF normal maps are a bad idea (chroma subsampling).
- Linux Mesa caveat (in three's KTX2Loader source [V]): on Linux with AMD/Intel Mesa, ETC/ASTC extensions are exposed but software-emulated; the loader detects this and prefers BC7. Nothing to do, but don't be surprised that Linux dev machines transcode to BC.
- Colour space: set `texture.colorSpace` only for non-glTF textures you load yourself (GLTFLoader does it for glTF). KTX2 data maps must be encoded linear - toktx handles slots.
- Texture budget (hero car, desktop, ~2048 max): body paint (no texture, procedural), interior/leather 2k, brake caliper/disc 1k, tyre 2k tile, wheel 2k; total < ~60 MB VRAM, < ~8 MB transfer.

### A5. Loader setup under Vite with self-hosted decoders [V against three 0.187 sources]
Copy decoders from `node_modules/three/examples/jsm/libs/` into `public/decoders/` at build via a tiny script (or `vite-plugin-static-copy`), so they are served at stable un-hashed URLs and can be cached `immutable` by Cloudflare:
```jsonc
// package.json
"scripts": {
  "postinstall": "node scripts/copy-decoders.mjs"
}
```
```js
// scripts/copy-decoders.mjs
import { cpSync, mkdirSync } from 'node:fs';
const src = 'node_modules/three/examples/jsm/libs';
mkdirSync('public/decoders/basis', { recursive: true });
cpSync(`${src}/basis`, 'public/decoders/basis', { recursive: true });
// Draco only if used: cpSync(`${src}/draco/gltf`, 'public/decoders/draco', { recursive: true });
```
```ts
// src/assets/loaders.ts
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
// import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

export async function createLoaders(renderer: THREE.WebGLRenderer, manager: THREE.LoadingManager) {
  await renderer.init();                    // r181+: detectSupport requires an initialised renderer (detectSupportAsync deprecated)
  const ktx2 = new KTX2Loader(manager)
    .setTranscoderPath(`${import.meta.env.BASE_URL}decoders/basis/`)
    .detectSupport(renderer);
  const gltf = new GLTFLoader(manager)
    .setKTX2Loader(ktx2)
    .setMeshoptDecoder(MeshoptDecoder);
  // const draco = new DRACOLoader(manager).setDecoderPath(`${import.meta.env.BASE_URL}decoders/draco/`); gltf.setDRACOLoader(draco);
  return { gltf, ktx2 };                    // call ktx2.dispose() when all textures loaded to free its workers
}
```
(Do NOT import the transcoder via `?url` and rewrite - KTX2Loader loads `basis_transcoder.js` + `.wasm` by fetch from the path and builds a worker from the JS source; keep both files adjacent in the folder. If you want hashed names, give up the immutable-by-path convention and set the path to a hashed dir; simpler to keep `/decoders/basis/` and version it via a query/`Cache-Control: max-age=31536000, immutable` plus renaming the dir on three upgrades.) Also `GLTFLoader` has `.setDRACOLoader()` / `.setMeshoptDecoder()` / `.setKTX2Loader()` - verified present in source; it throws a clear error if a compressed asset is hit without the decoder set.

### A6. LoadingManager progress UI
```ts
const manager = new THREE.LoadingManager();
manager.onProgress = (_url, loaded, total) => ui.setProgress(loaded / total);   // note: total grows as sub-resources are discovered -> use a weighted manual bar for smoothness
manager.onLoad = () => ui.setReady();
manager.onError = (url) => ui.error(url);
```
Caveats: LoadingManager only counts items going through loaders given the manager; byte-accurate progress per file needs `FileLoader`'s `onProgress` (`ProgressEvent.loaded/total` - `total` is 0 when the server uses `Content-Encoding` chunked/brotli without `Content-Length`... on Cloudflare compressed responses lose Content-Length, so progress bars by bytes are unreliable; use a known manifest of sizes: `{url, bytes}` emitted at build time and sum loaded fractions yourself) [U]. Show the UI against a manifest of weighted steps: glTF (50%), env HDR (15%), track (15%), shader compile (20%).

### A7. Progressive loading (low-res first)
Pattern: ship `car_lod2.glb` (~300 KB; 15-25k tris, 512px KTX2) first -> render immediately -> stream `car_hero.glb` -> swap. Implementation:
1. Load LOD2 + low-res env, render at once (first interactive in < 2 s).
2. In background `await gltf.loadAsync('car_hero.glb')`, then `await renderer.compileAsync(hero, camera)` (offscreen, see A8), then **swap in one frame** (set `visible`), `dispose()` the old group.
3. For textures only: ship a single mesh with 512 textures, then `loadAsync` 2k KTX2 variants and replace `material.map` etc. (material.needsUpdate not needed for map-to-map swaps if the same slot/defines; dispose the old textures).
4. Use `<link rel="preload" as="fetch" crossorigin href="/models/car_lod2.glb">` plus `fetchpriority=high` in index.html.
Source: pattern; no library needed. HTTP range / `Cache-Control: immutable` on Cloudflare.

### A8. HDR env loading, PMREM and shader pre-compilation
- Use a **small equirect** (1k-2k `.hdr`/`.exr`; or better a **pre-baked PMREM-ready `.ktx2` / `.hdr` 1k**): RGBE 2k x 1k is ~ 2-4 MB raw; 4k HDR is 8-12 MB and PMREM cost is the same regardless of source res (PMREM output is ~256-px cube faces with mip chain). `RGBELoader` decodes on the main thread (a 4k decode is tens of ms); EXRLoader is slower/bigger. [U timings]
- `new THREE.PMREMGenerator(renderer)`: call `pmrem.compileEquirectangularShader()` [V exists in 0.187 src/extras/PMREMGenerator.js] early (during the loading screen) to prebuild its shader, then `const env = pmrem.fromEquirectangular(hdrTex).texture; hdrTex.dispose(); pmrem.dispose(); scene.environment = env;`. Do it once; keep `env` for the app lifetime. For a stylised studio/garage env you can use `pmrem.fromScene(new RoomEnvironment(), 0.04)` (zero download, ~tens of ms).
- `scene.background`: use a cheap gradient/skydome shader, not the HDR cube, if the hero look is a dark studio; if background = HDR sky, set `scene.backgroundBlurriness`/use the PMREM texture itself.
- Shader pre-compilation: `renderer.compile(scene, camera)` is synchronous (blocks); `await renderer.compileAsync(scene, camera)` uses KHR_parallel_shader_compile and polls until programs are ready [V: source of WebGLRenderer.compileAsync; resolves when all programs `isReady()`]. Recipe: add every vehicle variant, track, shadows, and x-ray materials to the scene (visible but camera-culled is fine - compile uses the object's materials, `scene.traverse` visible objects), `await renderer.compileAsync(scene, camera)`, THEN hide the loader. For objects not yet in scene (the other suspension variants, e.g. wishbone linkage meshes), temporarily add them to a `targetScene` or set `visible = true` for one `compileAsync`, then set back. Note materials with different `defines`/features (shadow on/off, fog, envMap, skinning, clearcoat) are separate programs - compile with the final lighting/shadow config enabled, otherwise first toggle will hitch. In headless SwiftShader `KHR_parallel_shader_compile` is **false** [V] so it falls back to polling - fine.
- Also warm: first shadow-map render (`renderer.shadowMap.needsUpdate = true` + one `renderer.render`), PMREM, and upload textures with `renderer.initTexture(tex)` (r1xx+; uploads to GPU without rendering) to move texture upload cost off the first interaction.

---
## B. Runtime performance

### B1. Budgets for 60 fps at 1440p on integrated GPUs [U - heuristic starting points; measure with stats-gl on real Iris Xe / Apple M-series / Radeon 680M-780M]
- 2560x1440 = 3.7 MP; integrated GPUs are **fragment/bandwidth-bound**, not vertex-bound. Run `renderer.setPixelRatio(1)` at 1440p (a 2x DPR on a retina 1440p panel = 14.7 MP). Dynamic resolution (B8) is the primary lever.
- Draw calls: <= ~150-250 (hero car LOD0 <= 60-80 draws incl. suspension parts; track <= 30; props instanced; UI none).
- Triangles on screen: ~1-1.5 M for the whole frame is comfortable on iGPUs; hero car 250-400k tris close-up (LOD0), 60-100k (LOD1 mid-distance), 15-25k (LOD2 far). Suspension X-ray extra parts ~50-100k.
- Shaders: 1 MeshPhysicalMaterial with clearcoat for the paint only; everything else MeshStandardMaterial; avoid transmission (extra full-scene pass), avoid per-pixel multi-light (<= 1 directional + env + a few baked), limit post-processing to one combined pass (bloom/ssao are the killers on iGPU; SSAO off by default).
- Shadow map 2048 (1 cascade) + PCFSoft; MSAA: `antialias:true` on iGPU costs memory; use FXAA/SMAA-lite or MSAA only at DPR 1.
- Memory: keep < 300-400 MB GPU for iGPU shared-memory comfort.

### B2. Shadows for a moving car on a big track
Options ranked for Suspension Lab:
1. **One directional light with a tight, car-following shadow frustum (recommended)**: ortho shadow camera ~ 30x30 m (+/- 15 m) centred on the car, `mapSize 2048` (texel ~1.5 cm), `shadow.bias` ~ -0.0002, `normalBias` ~0.02, `light.target` = car; every frame move the light position = car.position + sunDir * 60 and **snap the centre to shadow-texel increments** to stop edge shimmer when the map translates:
```ts
const texel = (2 * halfSize) / shadowMapSize;      // world units per texel
const q = (v: number) => Math.round(v / texel) * texel;
// in light-space: transform car pos into light view, quantize x/y, transform back
```
   Only the car and nearby barriers cast (`castShadow` selectively); track mesh receives (or is baked, below). Update every frame (car moves), but if the camera is in an orbit/inspect mode with the car stationary-ish you can freeze: `light.shadow.autoUpdate = false; light.shadow.needsUpdate = true` [V: both exist in WebGLShadowMap.js].
2. **Baked contact/ambient shadow under the car**: a transparent plane quad with a baked blurred soft AO texture (or a runtime-rendered blob, 256px, from a top-down orthographic depth/AO render once per vehicle swap, scaled with ride height) parented under the chassis and pulled up/down with body heave/roll. Cheap (1 draw), reads as "grounded" even when the main shadow is soft. Use together with (1).
3. **CSM** (`three/addons/csm/CSM.js`, exists in 0.187 [V]; also `CSMShadowNode` for WebGPU): 3-4 cascades = 3-4 shadow passes of the scene; unnecessary for a track seen mostly around the car; only use if the camera shows long distance sun shadows from grandstands. Costs ~3x shadow-pass draw calls on an iGPU - not recommended.
4. Baked lightmaps / baked AO for the static track and props (Blender -> `aoMap`/`lightMap` KTX2) so no runtime shadows are needed for static casters. Trackside props can cast fake blob shadows (BatchedMesh of quads).
- `renderer.shadowMap.type = THREE.PCFSoftShadowMap` (VSM has light bleeding and more cost). Disable `shadowMap` entirely on the "low" preset.
- Check `renderer.info.render.calls` while shadows are on: the shadow pass doubles draw calls of casters.

### B3. Instancing / BatchedMesh for trackside props
- `InstancedMesh` for N copies of one geometry+material (cones, tyre stacks, barriers, light poles, grass tufts): 1 draw call; update matrices once (static) with `instanceMatrix.needsUpdate=false` after setup; set `mesh.computeBoundingSphere()` correctly after setup (default instanced frustum culling uses the base geometry's bounding sphere - wrongly culls or never culls) or set `frustumCulled=false` for a track-wide batch and split by track sector instead (e.g. 8-12 sectors, each its own InstancedMesh, so frustum culling works per sector).
- `BatchedMesh` (core, `THREE.BatchedMesh`, API in 0.187 [V]: `new BatchedMesh(maxInstanceCount, maxVertexCount, maxIndexCount, material)`, `addGeometry(geo)`, `addInstance(geometryId)`, `setMatrixAt`, `setColorAt`, `setVisibleAt`, `optimize()`, per-instance frustum culling `perObjectFrustumCulled = true` default, `sortObjects = true` default): use when props are *different geometries sharing a material* (barrier variants, signs, bollards) - one draw call with per-object culling and sorting. Call `optimize()` after adding for fewer draws. Per-instance culling costs CPU: set `perObjectFrustumCulled=false`/`sortObjects=false` for opaque, single-sector batches to save CPU.
- EXT_mesh_gpu_instancing from glTF (`gltf-transform instance`) loads straight into `InstancedMesh`.
- Static scenery: merge by material per sector (`BufferGeometryUtils.mergeGeometries`) - `join` in glTF-Transform does this offline.
- `three-mesh-bvh` (MIT) is useful for fast raycast picking on the hero car (hover on suspension parts) - not for rendering.

### B4. Frustum culling & LOD
- Default `frustumCulled = true` uses bounding spheres; ensure skinned/instanced objects have correct bounds. For the hero car (always on screen) cull isn't a gain; do **per-part visibility by mode** instead (hide interior/body in X-ray; `visible=false` skips the draw entirely).
- `THREE.LOD`: `lod.addLevel(mesh, distance, hysteresis)`; update with `lod.update(camera)` (done in `onBeforeRender`). Use for track props and for the *car in far shots*; with a mostly-close hero view, a single LOD0 with a "far" LOD2 swap above ~40 m is enough. Generate LODs with `gltf-transform simplify --ratio 0.25 --error 0.001` (+ `weld` first) from the same source; keep the same node names so swapping doesn't break references (wheels are separate nodes in each LOD, driven through a name map).
- Occlusion: not worth it for this scene. Use fog/near-far tightening (`camera.far` tight, e.g. 500 m) and logarithmic depth only if z-fighting demands it (it disables early-z; avoid).

### B5. Fixed-timestep simulation decoupled from render (accumulator + interpolation)
Standard "Fix Your Timestep" (Gaffer On Games: https://gafferongames.com/post/fix_your_timestep/):
```ts
const DT = 1 / 120;            // physics step (suspension springs are stiff: 1/120-1/240 recommended)
const MAX_FRAME = 0.25;        // clamp (tab switch / breakpoint) to avoid spiral of death
let acc = 0, prev = performance.now();
let prevState = sim.snapshot(), currState = sim.snapshot();

function frame(now: number) {
  let frameTime = Math.min((now - prev) / 1000, MAX_FRAME); prev = now;
  acc += frameTime;
  let steps = 0;
  while (acc >= DT && steps++ < 8) {            // cap steps per frame
    prevState.copyFrom(currState);              // swap/copy without alloc
    sim.step(DT);                               // pure, deterministic
    currState.copyFrom(sim.state);
    acc -= DT;
  }
  const alpha = acc / DT;
  view.apply(prevState, currState, alpha);      // lerp positions, slerp quats -> three objects
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(frame);   // setAnimationLoop gets the rAF timestamp; also XR-safe
```
- `THREE.Timer` (src/core/Timer.js exists in 0.187 [V]) replaces Clock (handles page visibility via `connect(document)`), but a manual accumulator is clearer.
- Sub-step the suspension (stiff spring + damper explicit integration) at 240 Hz inside a 120 Hz tick if using explicit Euler; semi-implicit Euler or RK4 for stability. Keep sim code pure TS (no three imports) so it is vitest-able and worker-portable.
- Camera interpolation: also drive the chase camera from the interpolated state.

### B6. Worker vs main thread for the simulation
- A single car + 4 suspension corners (linkage kinematics solve, a few hundred flops per step) costs microseconds - **run the sim on the main thread**. Moving to a Worker adds latency (one frame) + postMessage/SharedArrayBuffer complexity; SAB needs cross-origin isolation headers (COOP/COEP) which breaks some third-party embeds. [U]
- Reconsider a worker only if you add many vehicles/full multi-body or heavy track-surface sampling; then: sim in `new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' })` (Vite pattern [V from vite docs]), post `Float32Array` snapshots with `transfer` each tick (double-buffered), render interpolates. Keep the interface `Simulation { step(dt); snapshot(out) }` so the main/worker switch is a module swap (fits "swappable modules").
- OffscreenCanvas rendering in a worker: possible, but input/UI plumbing, stats-gl, and orbit controls become painful; not recommended unless main-thread jank from UI is demonstrated.

### B7. GC avoidance
- No `new Vector3/Quaternion/Matrix4` inside the per-step/per-frame loops: hoist module-level scratch objects (`const _v1 = new THREE.Vector3()`), use `.copy/.set/.addScaledVector/.applyQuaternion` in place, pass out-params (`fn(out: Vec3)`), plain `Float64Array` structs of arrays in the sim (SoA) and zero allocation in `step`. Avoid closures/array literals/`[...spread]`/`.map` in hot paths, avoid `Object.assign({}, ...)`, string concat for names per frame.
- Pools only for transient entities (skid marks, tyre smoke particles, spark particles): fixed-size ring buffers backed by typed arrays / InstancedMesh with `count` changes.
- Verify: Chrome DevTools Performance -> Memory "JS heap" sawtooth should be flat; or `performance.memory` in dev; also in Playwright dev-mode assert `renderer.info.memory` is stable (below).
- `renderer.info.autoReset` default true resets per render; set `false` and `renderer.info.reset()` manually if you do multi-pass (shadows/pmrem/post) to count totals.

### B8. Monitoring, adaptive DPR
- `renderer.info.render.{calls,triangles,lines,points,frame}` and `renderer.info.memory.{geometries,textures}`, `renderer.info.programs.length` [V all standard]. Expose via a debug overlay and in `window.__debug` for Playwright.
- **stats-gl 4.2.3 (MIT)** - verified README (https://github.com/RenaudRohlinger/stats-gl): 
```ts
import Stats from 'stats-gl';
const stats = new Stats({ trackGPU: true });     // GPU timer queries (EXT_disjoint_timer_query_webgl2); Safari needs flag
document.body.appendChild(stats.dom);
stats.init(renderer);   // in loop: stats.update() (after render)
```
  **three-perf 1.0.11 (MIT)**: `new ThreePerf({ renderer, anchorX:'left', anchorY:'top' })`, `perf.begin()/end()` or its React `<Perf/>`; shows draw calls/triangles/memory; React-leaning; stats-gl is the framework-free choice.
- Adaptive DPR (the thing that protects 60 fps on iGPUs): measure a smoothed frame time (EMA over ~30 frames; use `stats` or own `performance.now()` deltas); if > 18.5 ms for 1 s -> step DPR down (`min(devicePixelRatio, 2)` -> 1.5 -> 1.25 -> 1.0 -> 0.85 -> 0.75 min), and if < 13 ms for 3 s step up; hysteresis + cooldown (2 s) and `renderer.setPixelRatio(r); renderer.setSize(w,h,false)` (setSize triggers canvas realloc, ~ms hitch - so change rarely; or render to a lower-res target then upscale). Also tiered features: first drop shadow map size/PCF, then post effects, then DPR. Respect `prefers-reduced-motion`/ battery-saver (n/a on desktop).
```ts
let dpr = Math.min(devicePixelRatio, 1.5), ema = 16.7;
function adapt(dt: number) { ema += (dt - ema) * 0.05; /* thresholds with cooldown */ }
```
- Cap max canvas pixels (e.g. 1440p-equivalent 3.7 MP at DPR scaling) with `dpr = Math.min(dpr, Math.sqrt(MAX_PIXELS / (cssW * cssH)))`.

### B9. Tab visibility & context loss
- `renderer.setAnimationLoop` stops being called when the tab is hidden (rAF paused) - good; but your `prev` time jumps: the `MAX_FRAME` clamp in B5 and re-baselining on `visibilitychange` (`prev = performance.now()`) prevent a giant catch-up. Pause audio/timers; optionally `renderer.setAnimationLoop(null)` on hidden for clarity.
- Context loss: three attaches `webglcontextlost` (calls `preventDefault`, sets `_isContextLost`, render() returns early) and `webglcontextrestored` (re-inits GL state, preserves shadowMap/info settings) [V in WebGLRenderer.js 0.187]. App-level: also listen on `renderer.domElement` to show a "reconnecting" overlay, pause the sim/loop on lost, and resume on restored; three re-uploads geometries/textures lazily from CPU copies - **do not null out `geometry.attributes` data or `image` sources after upload** (a common memory optimization that breaks restore); KTX2 `CompressedTexture` mipmaps are retained so they re-upload fine. Test with `const e = renderer.getContext().getExtension('WEBGL_lose_context'); e.loseContext(); setTimeout(()=>e.restoreContext(), 1000)` (also usable in Playwright).
- Provide a WebGL-unavailable fallback screen (`WebGL.isWebGL2Available()` / try/catch around `new WebGLRenderer`, show a poster video/image).

### B10. Disposal on vehicle swap
Recipe (traverse, dispose geometries/materials/textures, release references, then verify with `renderer.info`):
```ts
export function disposeObject(root: THREE.Object3D) {
  root.traverse((o: any) => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const k in m) { const v = m[k]; if (v && v.isTexture) v.dispose(); }   // map, normalMap, envMap(if owned), etc. - do NOT dispose shared scene.environment
      m.dispose();
    }
    if (o.isSkinnedMesh) o.skeleton?.dispose();
    if (o.isInstancedMesh || o.isBatchedMesh) o.dispose?.();
  });
  root.removeFromParent();
}
```
- Shared resources (scene.environment PMREM, shared tyre material/textures) must be skipped (tag with `userData.shared = true`) or ref-counted. Cache by URL with a refcount map if two vehicles share assets.
- After swap: `renderer.info.memory.geometries/textures` should return to the pre-swap baseline; `renderer.info.programs.length` may legitimately persist (cached programs). Also `ktx2.dispose()` terminates transcoder workers when done; `dracoLoader.dispose()` likewise.
- Keep a **fixed budget of one car in memory + the next one streaming**; swap suspension variant by toggling pre-built hardpoint groups (`visible`), not reloading; only load new geometry when switching vehicle *class* (car -> motorcycle).

### B11. Mobile fallback
Desktop is the target; plan a graceful floor: detect via `matchMedia('(pointer: coarse)')` + `navigator.deviceMemory`/UA-CH + a 1 s benchmark of first frames. Mobile/low preset: DPR cap 1.5-2 (or 1), no shadows (blob only), LOD2 car (~25k tris) + 1k KTX2, no post FX, 30 fps cap (`setAnimationLoop` with a time gate), `RoomEnvironment` env, and a "view as video/poster" fallback if WebGL2 fails. Keep a `quality` preset object in a single module so adaptive DPR and presets share it. `KTX2` on mobile transcodes to ASTC/ETC2 automatically.

---
## C. Build

### C1. Vite 8 (current major: 8.3.8; Rolldown + Oxc replace Rollup + esbuild; announced 2026-03-12) - https://vite.dev/blog/announcing-vite8, https://vite.dev/guide/migration [V]
- Node ^20.19 or >=22.12. `build.target` default `baseline-widely-available` is now Chrome/Edge 111, Firefox 114, Safari 16.4.
- `build.rollupOptions` -> **`build.rolldownOptions`** (same for `worker.rollupOptions`); `esbuild` options -> `oxc`; `build.minify: 'esbuild'` deprecated (default minifier is Oxc). **Object-form `manualChunks` removed; function form deprecated; use `output.codeSplitting`** (Rolldown docs https://rolldown.rs/reference/OutputOptions.codeSplitting [V]).

```ts
// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  build: {
    target: 'baseline-widely-available',
    sourcemap: true,
    chunkSizeWarningLimit: 700,         // three core min ~ 700+ KB; see C5
    assetsInlineLimit: 0,               // never inline wasm/glb; keep CSP-friendly
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'three',  test: /node_modules[\\/]three[\\/]build/, priority: 30 },   // core
            { name: 'three-addons', test: /node_modules[\\/]three[\\/]examples[\\/]jsm/, priority: 20 },
            { name: 'vendor', test: /node_modules/, priority: 10 },
          ],
        },
      },
    },
  },
  optimizeDeps: { exclude: [] },        // three is fine pre-bundled
  server: { headers: { /* only if SAB needed: 'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp' */ } },
});
```
(Group-based splitting syntax verified from the Rolldown docs; the Vite 8 migration page itself gives no snippet - test the chunk output with `npx vite build && npx vite-bundle-visualizer` and adjust; I did not run a full build.) Import three addons from `three/addons/...` (exports map `./addons/*` -> `examples/jsm/*` [V]) so only the used loaders/controls are bundled (tree-shakable ESM); `import * as THREE from 'three'` is tree-shaken by modern bundlers when only a few classes are used, but prefer named imports `import { WebGLRenderer, Scene } from 'three'`.
- Lazy-load rarely used modules: `const { CSM } = await import('three/addons/csm/CSM.js')`, x-ray/post effects, UI panels, the motorcycle module - each becomes its own chunk; `modulepreload` for the car-critical path is automatic.
- Asset hashing: files imported from `src/` (`import carUrl from './assets/car.glb?url'`) get content-hashed names (`assets/car-3f2a1b.glb`) -> cache `immutable` forever. Files in `public/` keep their names (use for `decoders/`, large model packs addressed by a manifest; add a version query or folder name for cache-busting). `?url` returns the URL string, small assets may be inlined unless `assetsInlineLimit: 0` [V]. Make `.glb/.ktx2/.hdr` known assets: Vite treats unknown extensions as assets by default; add `assetsInclude: ['**/*.glb','**/*.ktx2','**/*.hdr']` for TS/IDE-friendly imports. Declare `declare module '*.glb?url' { const u: string; export default u; }` in `env.d.ts` (or rely on `vite/client` types).
- WASM: for wasm you import yourself (e.g. a Rust sim): `import init from './sim_bg.wasm?init'` returns `init(importObject) => Promise<WebAssembly.Instance>` [V, Vite docs]; larger-than-limit files are fetched on demand. `vite-plugin-wasm` 3.6.0 only needed for ESM-integration-style `import * as wasm from './x.wasm'` (wasm-bindgen "bundler" target). Three's decoders are loaded by fetch from `public/decoders/`, no Vite wasm handling needed. Workers: `new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' })` [V].
- Types: `tsconfig` `"strict": true, "noUncheckedIndexedAccess": true, "exactOptionalPropertyTypes": true, "noImplicitOverride": true, "verbatimModuleSyntax": true, "moduleResolution": "bundler", "target": "ES2022", "lib": ["ES2022","DOM"], "types": ["vite/client"]`; `noUncheckedIndexedAccess` adds friction in numeric hot loops over typed arrays (indexing typed arrays yields `number | undefined`); allow selective `!` in sim kernels or keep that flag off for the sim package. `@types/three` pinned to the same minor as `three` (0.187.0). TypeScript 7 (native port) is "latest" on npm - verify Vite/Vitest/typescript-eslint compat before adopting; **safe pin: typescript ~5.9/6.x if any tooling breaks** [U - I did not test TS 7 with this toolchain].
- Layout for modular design: `src/modules/<feature>/index.ts` each exporting `{ id, init(ctx), update(dt), dispose() }`; sim in `src/sim/*` (no `three` import).

### C2. Vitest 5.1.1 for pure simulation modules
```bash
npm i -D vitest@5 @vitest/coverage-v8
```
```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'node', include: ['src/sim/**/*.test.ts'], coverage: { provider: 'v8' } },
});
```
```ts
// src/sim/kinematics.test.ts
import { describe, it, expect } from 'vitest';
it('camber gain is monotonic in bump', () => { /* solve double wishbone, expect(g(10mm)).toBeGreaterThan(g(0)) */ });
expect(roll_centre_height).toBeCloseTo(0.085, 3);
```
`package.json`: `"test": "vitest run", "test:watch": "vitest"`. Use property tests on invariants (energy non-increasing with damping, symmetric left/right) and golden-number tests against hand calcs (`toBeCloseTo`). Node >= 22.12 required by Vitest 5 [V].

### C3. Playwright smoke test with WebGL in headless Chromium [V - ran here]
Result of my experiment (Playwright 1.65.1, Chrome Headless Shell 159.0.8154.6 on Linux without GPU): **WebGL2 worked with no flags at all**, and with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`, `--use-angle=swiftshader-webgl --enable-unsafe-swiftshader`, and `--ignore-gpu-blocklist ...` - renderer string `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)...))`, MAX_TEXTURE_SIZE 8192, `EXT_color_buffer_float` true, **`KHR_parallel_shader_compile` false**. Chromium docs (https://chromium.googlesource.com/chromium/src/+/da170c2267b2201954efe1c8fa5d2d89ab09f7bf/docs/gpu/swiftshader.md [from search result, not fully read]) say automatic SwiftShader WebGL fallback is deprecated and opt-in via `--enable-unsafe-swiftshader`; recommended triple `--use-gl=angle --use-angle=swiftshader-webgl --enable-unsafe-swiftshader`; do **not** pass `--disable-gpu` (it forces SwiftShader off/breaks). Because behaviour varies by Chromium version and OS, always pass the explicit flags for determinism, and on GitHub Actions `ubuntu-latest` use them as below. (`--use-angle=swiftshader` alone, as in the task text, also worked here.)
```bash
npm i -D @playwright/test@1.65.1
npx playwright install --with-deps chromium     # CI
```
```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 1280, height: 720 },
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
});
```
```ts
// e2e/smoke.spec.ts
import { test, expect } from '@playwright/test';
test('renders and loads car', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/?quality=low');                         // low preset: DPR 1, no shadows -> SwiftShader-friendly
  await page.waitForFunction(() => (window as any).__app?.ready === true, null, { timeout: 45_000 });
  const info = await page.evaluate(() => (window as any).__app.renderer.info.render);
  expect(info.calls).toBeGreaterThan(0);
  expect(info.triangles).toBeGreaterThan(1000);
  expect(errors).toEqual([]);
  await expect(page).toHaveScreenshot('hero.png', { maxDiffPixelRatio: 0.05 });   // software rendering differs from GPUs: baseline only on CI
});
```
Expose `window.__app = { ready, renderer, ... }` only when `import.meta.env.DEV || location.search.includes('debug')`. Under SwiftShader expect ~1-10 fps at best: tests should not assert frame rate; use `?quality=low` and a small viewport. Use deterministic sim seeds and `page.clock` (Playwright clock API) or a `?t=` fixed-time param for screenshot stability. `ignoreGpuBlocklist` and flags only affect Chromium; Firefox/WebKit WebGL in Playwright is separate (not needed).

### C4. Bundle-size expectations [U unless noted; run `npx vite-bundle-visualizer`]
- three core (tree-shaken `WebGLRenderer`, Scene, PBR materials, loaders): ~ 600-750 KB minified, ~150-190 KB gzip (3 core is large and not very tree-shakable; the three build is ~1.2 MB min with everything) - expect the `three` chunk ~700 KB raw / ~180 KB gzip, brotli ~150 KB. Addons used (GLTFLoader, KTX2Loader, OrbitControls, meshopt decoder 29 KB[V], RoomEnvironment): +60-120 KB raw. App code: 100-250 KB. Target first-load JS <= ~400-450 KB gzip/brotli total; first-paint HTML+CSS skeleton <= 20 KB with a CSS-only loader.
- Not in the JS bundle: `basis_transcoder.wasm` 527 KB raw/245 KB gz [V] (fetched lazily only if KTX2 present), Draco if used 192+58 KB [V].
- Assets: LOD2 car <= 400 KB; hero car 3-6 MB (meshopt+KTX2); track 2-4 MB; env HDR 1-2 MB; total interactive < 3 MB, full < 12 MB over a fast connection.
- Cloudflare: Brotli/gzip applied automatically for JS/wasm/json (not for already-compressed .ktx2/.glb meshopt payload - brotli still helps meshopt .glb ~20-30%; ensure `.glb` and `.ktx2` content types are in the compressible list or just pre-compress). Static assets with hashed names: `Cache-Control: public, max-age=31536000, immutable` via `_headers`.

---
## D. Sources
- glTF-Transform CLI source read from npm tarball `@gltf-transform/cli@4.5.1/dist/cli.mjs`, `@gltf-transform/functions@4.5.1/dist/index.js` (JOIN_DEFAULTS, SIMPLIFY_DEFAULTS); repo https://github.com/donmccurdy/glTF-Transform (MIT); docs https://gltf-transform.dev/cli (403 to fetcher), https://gltf-transform.dev/functions
- gltfpack README: https://github.com/zeux/meshoptimizer/blob/master/gltf/README.md
- three 0.187.0 source (npm tarball): `src/renderers/WebGLRenderer.js` (compileAsync, context events), `examples/jsm/loaders/{GLTFLoader,KTX2Loader,DRACOLoader}.js`, `src/objects/BatchedMesh.js`, `src/extras/PMREMGenerator.js`, `examples/jsm/libs/*` (decoder sizes), `package.json` exports.
- Vite 8: https://vite.dev/blog/announcing-vite8 , https://vite.dev/guide/migration , https://vite.dev/guide/features (wasm `?init`, workers, `?url`); Rolldown: https://rolldown.rs/reference/OutputOptions.codeSplitting
- stats-gl README: https://github.com/RenaudRohlinger/stats-gl ; Chromium SwiftShader doc: https://chromium.googlesource.com/chromium/src/+/da170c2267b2201954efe1c8fa5d2d89ab09f7bf/docs/gpu/swiftshader.md ; Fix Your Timestep: https://gafferongames.com/post/fix_your_timestep/

## E. Recommendations for Suspension Lab
1. **Pipeline**: author in Blender with strict `[A-Za-z0-9_]` node names + `extras.role`; export GLB; run a scripted glTF-Transform pass (dedup, weld, resample, `prune({keepLeaves:true})`, toktx UASTC for normal/ORM + ETC1S for colour at <= 2048, **meshopt**; no flatten/join/palette/simplify on the car). If using the CLI one-shot: `optimize --flatten false --join false --palette false --simplify false --prune false --compress meshopt --texture-compress ktx2` (defaults would merge named nodes and delete empty pivots). Always run `inspect` + `validate` in CI.
2. **Loading**: meshopt decoder bundled with JS (8 KB gz), KTX2 transcoder self-hosted under `public/decoders/basis/` (copied on postinstall), skip Draco entirely. `await renderer.init()` before `ktx2.detectSupport(renderer)`. Ship a ~300 KB LOD2 car first, stream the hero, `compileAsync` it offscreen, swap in one frame. Use a weighted manifest for the progress bar (Cloudflare compression removes Content-Length).
3. **Env/shaders**: 1-2k HDR or `RoomEnvironment` via one PMREM pass during loading; `compileAsync` all vehicle/suspension/x-ray materials with final shadow+env config before revealing the scene; `initTexture` for large textures.
4. **Runtime**: single fitted, texel-snapped 2048 directional shadow following the car + baked contact blob under it; baked AO/lightmaps on the track; no CSM. Instancing by track sector (InstancedMesh / BatchedMesh) for props. Budgets: <= ~200 draws, ~1-1.5 M tris, hero LOD0 <= 400k; adaptive DPR (cap 1.0-1.5 at 1440p) as the main iGPU safety valve, quality presets in one module.
5. **Sim**: pure-TS module (no three import), fixed 120 Hz (sub-stepped to 240 Hz for spring stability) with accumulator + interpolation, clamp dt at 0.25 s, zero allocation in `step`; keep on the **main thread** (worker only if profiling demands; keep `Simulation` interface worker-ready).
6. **Robustness**: rely on three's built-in context lost/restore plus an overlay; never null CPU-side buffers; `disposeObject` + `renderer.info` assertions on vehicle swap; swap suspension types by toggling pre-built groups, not reloading.
7. **Build/test**: Vite 8 (`build.rolldownOptions.output.codeSplitting` groups for `three`, `three-addons`, `vendor`; `assetsInlineLimit:0`; hashed assets via `?url`, un-hashed `public/decoders`), Node >= 22.12, TS strict, Vitest 5 on `src/sim/**`, Playwright smoke with `--use-gl=angle --use-angle=swiftshader-webgl --enable-unsafe-swiftshader` (verified working headless here; WebGL2 worked even with no flags) against `vite preview` with `?quality=low` and `window.__app` hooks asserting `renderer.info`, no console errors, and a loose screenshot diff.
8. **Monitoring**: stats-gl (`trackGPU:true`) in dev/`?debug`; `renderer.info` surfaced on `window.__app`; add a perf budget assertion in the Playwright test (`calls < 250`, `geometries`/`textures` stable after swap).
