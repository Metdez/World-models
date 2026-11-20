# 12 - Environment assets (HDRIs, PBR textures, props, audio) + HDR format guidance

Date: 2026-11-20. All downloads verified (file type, size, pixel dimensions). Root of downloads:
`/tmp/claude-0/-home-user-World-models/3bea3e2a-9224-5f6d-a9f0-620b29f250e6/scratchpad/assets/env/` (called `$E` below; ~265 MB raw, scratch only, not for committing as-is).

## 0. Network / host status (exact observations)
| Host | Result |
|---|---|
| api.polyhaven.com | 200 OK (`/assets?t=hdris|textures|models`, `/files/<id>`). Python `urllib` default UA got `HTTP Error 403: Forbidden` on one `/files/` call; `curl` works fine every time. Use curl or set a UA. |
| dl.polyhaven.org | files download OK (HTTP 200). Bare root `/` returns 521 (harmless; no index page). |
| ambientcg.com (`/api/v2/full_json`, `/get?file=X_1K-JPG.zip`) | 200 OK, zips download via curl -L |
| raw.githubusercontent.com, `git clone https://github.com/KenneyNL/Starter-Kit-Racing` | works. GitHub REST API (api.github.com) returns "GitHub access to this repository is not enabled for this session" (needs add_repo) - git clone is the workaround. |
| kenney.nl (`/assets/racing-kit`) | `HTTP/2 403`, `server: nginx`, `content-type: text/html; charset=iso-8859-1` (origin-side block, not a proxy `[agent-proxy]` message). Alternative: Kenney's GitHub repos (Starter-Kit-Racing, CC0 models+audio) - used. |
| poly.pizza | 403. Not used. |
| freesound.org | site 200, but `/apiv2/search/text/` = 401 (needs API token; downloads need login/OAuth). Not downloadable anonymously. Used Kenney OGGs instead. |
| opengameart.org, quaternius.com | 200 reachable (pages), but Quaternius packs are served from Google Drive/itch (not fetched; listed only). |

## 1. HDRIs (Poly Haven, licence CC0 1.0) - `$E/hdri/`
Download pattern: `curl -s https://api.polyhaven.com/files/<id>` -> `.hdri["1k"|"2k"].hdr.url` -> `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/<res>/<id>_<res>.hdr`. Files verified as `Radiance HDR image data` (`#?RADIANCE`, `FORMAT=32-bit_rle_rgbe`). "1k" = 1024x512, "2k" = 2048x1024.

| Role | id (page: https://polyhaven.com/a/<id>) | local files | size | notes |
|---|---|---|---|---|
| Proving ground / airfield, soft-ish sun | `derelict_airfield_01` (tags: runway, asphalt, grass, partly cloudy, high contrast) | `hdri/derelict_airfield_01_1k.hdr`, `_2k.hdr` | 1.42 MB / 5.73 MB | Best match for test-track backdrop. Sun peak 44288 (very hot) - needs clamp or moderated intensity for 8-bit-ish pipelines/gainmaps. |
| Overcast-ish proving ground / driving range | `driving_school` (parking, asphalt, road, tyre, partly cloudy) | `hdri/driving_school_1k.hdr`, `_2k.hdr` | 1.67 MB / 6.59 MB | Flat tarmac horizon, "backplates" tag. |
| Golden hour open road (A) | `evening_road_01` (road, asphalt, field, sunrise-sunset, medium contrast) | `hdri/evening_road_01_1k.hdr`, `_2k.hdr` | 1.58 MB / 6.32 MB | Softer, lower-contrast golden hour; safest for premium look. |
| Golden hour open road (B) | `camdeboo_road` (road, golden hour, hillside, clear, high contrast) | `hdri/camdeboo_road_1k.hdr`, `_2k.hdr` | 1.52 MB / 6.24 MB | Dramatic low sun, hills. |
| Garage / inspection bay | `autoshop_01` (indoor, garage, workshop, car, low contrast, artificial light) | `hdri/autoshop_01_1k.hdr`, `_2k.hdr` | 1.62 MB / 6.45 MB | Real garage; peak 88 (benign for gainmap). |
| Studio / light-box inspection | `ferndale_studio_03` (studio, softbox/umbrella, dark ceiling, spotlight) | `hdri/ferndale_studio_03_1k.hdr`, `_2k.hdr` | 1.60 MB / 6.35 MB | Best "x-ray/inspection" reflections: clean softboxes on dark. 12 ferndale_studio_NN variants exist. |
Total HDRI folder: 45 MB (12 files). Higher res (4k/8k, also .exr) available from same `files` JSON.

## 2. PBR textures (all CC0 1.0) - `$E/textures/`
Poly Haven layout: `textures/polyhaven/<id>/{1k,2k}/<id>_{diff,nor_gl,rough,ao}_<res>.jpg` (ARM/Displacement also available in API; not downloaded). Source: `https://polyhaven.com/a/<id>`; files via `/files/<id>` -> keys `Diffuse`, `nor_gl`, `Rough`, `AO`. All verified JPEG, 1024^2 (1k) / 2048^2 (2k). ~2.7 MB per 1k set, ~12 MB per 2k set (4 maps); diffuse alone ~0.6-1.0 MB at 1k, 2.2-4.1 MB at 2k.

| Use | Poly Haven id | note |
|---|---|---|
| Asphalt, clean | `clean_asphalt`, `asphalt_track` | track surface base |
| Asphalt, worn / pit lane | `worn_asphalt`, `asphalt_pit_lane` | use as blend layer (wear lines / patching); pit_lane for inspection-bay apron |
| Concrete | `concrete_floor_01` | barriers/pit wall/garage floor |
| Kerb rubber / tyre-mark surface | `rubberized_track` | rubberized running-track tex; substitute for kerb/rubber build-up (no real painted-kerb CC0 PBR found - recommend procedural red/white stripes in shader over `concrete_floor_01` or a flat colour + ambientCG `Rubber004` roughness) |
| Cobblestone / pave | `cobblestone_floor_08` | |
| Gravel runoff | `gravel_road` | |
| Grass runoff | `grass_ground` | |

ambientCG (licence CC0 1.0; https://ambientcg.com/view?id=<ID>): zips from `https://ambientcg.com/get?file=<ID>_<1K|2K>-JPG.zip`, extracted to `textures/ambientcg/<ID>/`, I deleted .blend/.mtlx/.tres/.usdc/Displacement/NormalDX to keep it lean. Kept per set: `_Color.jpg`, `_NormalGL.jpg`, `_Roughness.jpg`, `_AmbientOcclusion.jpg` (where the set has AO; Displacement dropped).
| ID | use | res downloaded | folder size |
|---|---|---|---|
| `Asphalt031` | asphalt (alt clean) | 1K + 2K | 23 MB |
| `Road007` | worn road asphalt | 1K | 3.2 MB |
| `Concrete034` | concrete | 1K | 1.5 MB |
| `PavingStones141` | cobble/pave | 1K + 2K | 26 MB |
| `Rubber004` | kerb rubber / tyre | 1K | 4.3 MB |
| `Grass004` | grass runoff | 1K | 6.4 MB |
| `Gravel041` | gravel runoff | 1K | 5.8 MB |
Totals: textures/polyhaven 132 MB, textures/ambientcg 70 MB. Other good candidates (not downloaded): ambientCG `Asphalt033`, `Road012A/B`, `Road008A`, `Concrete048/049`, `Ground037`; Poly Haven `asphalt_01..07`, `road_damaged_clean`, `cobblestone_floor_01..09`, `rubber_tiles`.
Texture notes for three.js: albedo -> `texture.colorSpace = THREE.SRGBColorSpace`; normal/rough/AO -> NoColorSpace (default). Poly Haven `nor_gl` and ambientCG `NormalGL` are OpenGL (+Y) = three.js default (do NOT flip). Poly Haven ships a packed `arm` (AO/Rough/Metal in RGB, glTF-compatible ORM) - fetch that instead of separate rough+ao to cut texture count 3->1 (needs `files[...]["arm"]` key). Set `anisotropy = renderer.capabilities.getMaxAnisotropy()` and `RepeatWrapping`.

## 3. Props / models
Kenney Starter-Kit-Racing (https://github.com/KenneyNL/Starter-Kit-Racing; cloned via git; repo LICENSE = MIT, README states "3D Models & sounds (CC0 licensed)"; Kenney's assets are CC0 - all reusable). Local: `$E/models/kenney-starter-kit-racing/` (GLB, 11-190 KB each, 1.2 MB total): `track-straight/corner/bump/finish/tents.glb`, `decoration-forest/tents/empty.glb`, `vehicle-motorcycle.glb`, `vehicle-truck-*.glb` (low-poly stylised; probably too cartoony for a premium look - useful only as layout/grid placeholder; trucks not relevant).
Poly Haven models (CC0), 1k glTF (separate .gltf + .bin + textures/), `$E/models/polyhaven/<id>/`:
- `old_tyre` (2.2 MB) - good for tyre stacks/walls (instance it)
- `concrete_road_barrier`, `concrete_road_barrier_02` (3.6 / 2.9 MB) - Jersey barriers
- `street_lamp_01` (2.1 MB), `modular_chainlink_fence` (7.0 MB)
Deleted (too heavy to ship): `fir_tree_01` (465 MB), `jacaranda_tree` (205 MB) at 1k - Poly Haven trees are high-poly scans; use impostor/billboard cards or Quaternius/Kenney nature kit instead. No CC0 traffic-cone, grandstand or garage found on Poly Haven (searched cone/grandstand/garage); candidates not fetched: Quaternius "Ultimate Nature/Modular Streets"/"Ultimate Space"-style packs (CC0, https://quaternius.com - served via Google Drive/itch, not scripted), Kenney "Racing Kit" (kenney.nl blocked, 403), Kenney Nature Kit. Recommendation: build cones/kerbs/tyre walls procedurally (InstancedMesh, simple geometry) - cheap and consistent.
Convert glTF to a single compact GLB: `npx @gltf-transform/cli@4.5.1 optimize in.gltf out.glb --texture-compress webp --texture-size 1024` (+ meshopt/draco). @gltf-transform/cli 4.5.1, MIT.

## 4. Audio (CC0)
Downloaded (Kenney Starter-Kit-Racing, CC0): `$E/audio/kenney-starter-kit-racing/engine.ogg` (111 KB, Vorbis stereo 44.1k ~160 kbps), `engine-motorcycle.ogg` (104 KB), `skid.ogg` (43 KB), `impact.ogg` (12 KB). Engine loops are a single sample -> drive with `playbackRate` (pitch by RPM) plus a crossfaded second layer; for a premium car sound a multi-sample RPM-banded loop set is better. Freesound CC0 engine loops are listable but require login/API key (401 anonymously) -> not downloaded; query suggestion: freesound.org text search `engine loop` filtered `license:"Creative Commons 0"`. Kenney Audio packs (Impact Sounds etc.) are on kenney.nl (403).

## 5. HDR formats in three.js (state as of three r187, @monogrid/gainmap-js 3.7.3 - both MIT, verified via npm)
| Format | Loader | Pros | Cons |
|---|---|---|---|
| RGBE `.hdr` | `RGBELoader` (examples/jsm/loaders) | trivial, lossless-ish (8-bit mantissa shared exponent), what Poly Haven ships; 2k = 5.7-6.6 MB | big; whole file decoded on CPU in JS (~100-300 ms at 2k); no GPU compression |
| OpenEXR `.exr` | `EXRLoader` | up to float32/half, best quality | much bigger (2k ~ 10+ MB), slower decode; avoid for web |
| UltraHDR / gainmap JPEG (`.jpg`) | `UltraHDRLoader` (core examples/jsm/loaders, Ultra HDR JPEG_R) or `HDRJPGLoader` from `@monogrid/gainmap-js` | 5-10x smaller than .hdr, JPEG decodes natively (hardware), SDR fallback image works anywhere, GPU-side recombination -> HalfFloat texture | lossy; sun peaks clip to maxContentBoost (my sample peak 44288 on derelict_airfield_01 -> encode with a tonemapped/clamped sun or high maxContentBoost); services that re-encode strip the gain map; PMREM still needed |
| KTX2 (BC6H/ASTC-HDR) | `KTX2Loader` | would be GPU-compressed | three's KTX2Loader/Basis path is LDR-focused; BC6H HDR cubemaps are not a mainstream, reliably transcoded path in three -> not recommended for HDRI today |
| RGBM/LDR PNG/WebP | custom | smallest simple hack | legacy (three removed RGBM/LogLuv paths from the standard pipeline); manual decode |

Measured on `derelict_airfield_01_2k` (2048x1024): .hdr = 5.73 MB; RGBM 8-bit-RGBA WebP q90 = 0.88 MB; SDR JPEG q90 base layer = 0.32 MB (gainmap adds a downscaled mono/RGB gain image, typically +0.1-0.3 MB) -> expect ~0.4-0.7 MB for a 2k gainmap JPEG vs 5.7-6.6 MB .hdr (roughly 10x smaller). `autoshop_01_2k`: RGBM WebP 0.94 MB, SDR JPEG 0.32 MB.

Practical recommendation: author with `.hdr` (source of truth), ship gainmap JPEG for background+IBL (<=1 MB each), then PMREM once at startup:
```js
import { HDRJPGLoader } from '@monogrid/gainmap-js';       // or three/examples/jsm/loaders/UltraHDRLoader.js
const loader = new HDRJPGLoader(renderer);
const result = await loader.loadAsync('/env/derelict_airfield_01_2k.jpg');
const pmrem = new THREE.PMREMGenerator(renderer);
const envMap = pmrem.fromEquirectangular(result.renderTarget.texture).texture;
scene.environment = envMap; scene.background = envMap;          // or keep the equirect for background with blur
result.dispose(); pmrem.dispose();
// fallback: new RGBELoader().loadAsync('/env/x_1k.hdr') then texture.mapping = THREE.EquirectangularReflectionMapping
```
- Use `scene.environmentIntensity`, `scene.backgroundBlurriness`, `scene.backgroundIntensity` (r163+) instead of baking.
- Make a second tiny 1k .hdr for IBL if the background stays 2k (IBL from a 256-512 px PMREM is plenty).
- Rotate with `scene.environmentRotation` / `backgroundRotation` (r162+).
- Convert: encode online with https://gainmap-creator.monogrid.com (Squoosh-like) or `@monogrid/gainmap-js/encode` (WebGL) / `/encode/webgpu` (node-based, no renderer); Google libultrahdr (`ultrahdr_app`) is the CLI alternative. glTF-Transform for geometry/texture KTX2: `gltf-transform ktx2` or `toktx --encode uastc/etc1s` (LDR PBR maps only; keep normals UASTC, albedo ETC1S/UASTC).
- Dev tools not installed here (no toktx/basisu/cwebp/exiftool); my size measurement used numpy+PIL, so the gainmap figure is an estimate (SDR base measured; gain map not encoded).

PBR texture compact formats: for 7-9 texture sets shipping 1k/2k JPG is 0.7-4 MB per map; KTX2 UASTC/ETC1S cuts VRAM 4-8x and transfer ~2-4x (ETC1S ~ 0.15-0.3 MB per 1k map); load via `KTX2Loader` + `transcoderPath`. For a hero-asphalt use 2k KTX2 (UASTC for normal); distant/other 1k ETC1S. Pack ORM into one texture.

## 6. Recommended asset budget (cinematic desktop, Cloudflare delivery)
- Initial blocking payload (first interactive frame): <= 3 MB env (1 gainmap 1k HDRI ~0.3 MB + 1-2 asphalt sets in KTX2 ~1 MB) + car GLB budgeted separately. Total environment budget: **~8-12 MB compressed** on the wire (Brotli doesn't help JPG/KTX2), lazily streaming the rest.
- HDRI: 3 environments (track golden/overcast, garage/studio) x 2k gainmap (~0.5 MB) = 1.5 MB, plus optional 4k for the hero (~2 MB). Raw .hdr 2k are 6 MB each; do not ship raw.
- Textures: asphalt (clean+worn blend) 2k ORM+albedo+normal KTX2 ~2-3 MB; concrete/kerb/grass/gravel/cobble at 1k KTX2 ~0.5 MB each => ~5 MB total. Max total GPU texture memory < 128 MB (a 2k RGBA KTX2 UASTC is 4 MB VRAM vs 21 MB uncompressed with mips).
- Props: instanced geometry, each GLB < 150 KB with meshopt; barriers/tyres share a 1k atlas.
- Audio: engine loops OGG/Opus ~100 KB each; total < 1 MB.
- Mobile: halve (1k HDRI 0.3 MB, 1k textures, <5 MB).
- Cloudflare: serve from R2/Pages with long immutable cache (`Cache-Control: public, max-age=31536000, immutable`), hash filenames, HTTP/3; `Content-Type: image/jpeg` for gainmap files (don't enable Cloudflare Polish/Image Resizing/"Mirage" on these paths - they strip the gain map metadata); `application/octet-stream`/`image/ktx2` for KTX2.

## 7. Licences summary
Poly Haven (HDRIs, textures, models): CC0 1.0 (https://polyhaven.com/license) - no attribution required. ambientCG: CC0 1.0 (https://docs.ambientcg.com/license/). Kenney Starter Kit Racing: repo MIT, assets CC0 per README (Kenney assets are CC0). None of the downloads are GPL / NC / editorial.

## Recommendations for Suspension Lab
1. Track hero scene: `derelict_airfield_01_2k` (or soft `driving_school`) as background+IBL, `evening_road_01_2k` as the golden-hour variant; `ferndale_studio_03_2k` for the inspection/x-ray mode (dark ceiling = high-contrast chrome/carbon reflections); `autoshop_01_2k` as the garage alternative. Clamp the sun (derelict_airfield peak 44k) when making the gainmap JPEG.
2. Ship gainmap JPEGs (HDRJPGLoader / UltraHDRLoader) with a 1k `.hdr` fallback; do not use EXR or KTX2 for HDRIs.
3. Track surface: shader blend of `clean_asphalt` + `worn_asphalt` (+ `rubberized_track`/`Rubber004` for racing-line rubber build-up) with world-space UVs and a noise mask; `concrete_floor_01` for pit wall/barriers; `gravel_road` + `grass_ground` for runoff.
4. Compress all PBR maps to KTX2 (UASTC normals, ETC1S colour) and pack ORM; load via KTX2Loader.
5. Props: instanced tyre walls from `old_tyre`, `concrete_road_barrier(_02)`; procedurally generated cones and striped kerbs (no suitable CC0 cone/kerb/grandstand model found); skip Poly Haven trees (65-465 MB).
6. Audio: use Kenney `engine.ogg`/`engine-motorcycle.ogg` as placeholder loops (CC0) and plan RPM-banded crossfade via Web Audio `playbackRate`; source better CC0 loops from freesound by logged-in manual download.
7. Remote hosts: kenney.nl and poly.pizza return 403 to this environment; use GitHub clones (git works, REST API does not).

## Appendix: reproduction
`curl -s https://api.polyhaven.com/assets?t=hdris` (candidate listing saved in scratchpad `scripts/hdris.json`, `tex.json`, `models.json`); download scripts `scripts/dl_ph.py`, `scripts/dl_models.py`, RGBM/SDR size test `scripts/rgbm.py` under the scratchpad.
