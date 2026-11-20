# 01-03 SUMMARY — Worker health/time, asset pipeline, live smoke script

**Status:** complete · commits `18e6be3` (routes), `d6fb008` (pipeline + attribution), `31fcfa9` (smoke script)

## Built
- **`worker/routes/health.ts`**: `GET /api/health` → `HealthResponse { ok: true, version: env.APP_VERSION, time }`,
  `Cache-Control: no-store`. **`worker/routes/time.ts`**: `GET /api/time` → `{ t: Date.now() }`, no-store. GET only
  (other methods fall through to the JSON 404).
- **`assets-src/ATTRIBUTION.json`**: 10 entries covering all 24 source files (DB11 with the exact §15 `modified`
  text; one entry per Poly Haven HDRI / texture set with its real author; Kenney audio; skid sound by Landeplage).
- **`scripts/build-assets.mjs`** (§11), exports `buildAssets({ srcDir, outDir, log })`, CLI exits 1 on failure:
  cleans outputs; every file must be covered by an attribution entry with title/author/license/licenseUrl/sourceUrl,
  and entries may not list files that do not exist; `.glb` → NodeIO(ALL_EXTENSIONS + meshopt) `dedup()` +
  `prune({ keepLeaves: true })` + EXT_meshopt_compression (quantize), then re-read: FAIL if any named node was
  dropped or fewer than 4 nodes match `/wheel/i`, `/caliper/i`, `/brakedisc/i`; other files copied unchanged;
  output `<dir>/<base>.<sha256-8>.<ext>`; manifest `{ version: 1, assets, attributions }`; FAIL > 24 MiB per file;
  WARN if initial set (car + airfield HDRI + asphalt maps) > 12 MB.
- **`scripts/smoke-live.mjs [baseUrl]`**: `/` 200 with `#stage`; `/api/health` ok + version + no-store;
  `/api/time` skew < 5 s; `/asset-manifest.json` 200; first asset 200 with `immutable`. Exit 1 on any failure.
- Tests: `tests/worker/health-time.test.ts` (3), `tests/scripts/build-assets.test.ts` (8: hashed names + manifest,
  stale-output cleanup, missing attribution fails, missing licence / stale entry fails, > 24 MiB fails, glb without
  4 wheel nodes fails, real DB11 keeps all named nodes, repo ATTRIBUTION.json covers assets-src).

## Source verification (all 24 files kept; nothing removed)
| Files | Check |
|---|---|
| 3 HDRIs + 16 texture JPGs (Poly Haven, CC0) | md5 of every file equals `api.polyhaven.com/files/<id>`; authors from `/info/<id>` |
| 4 audio OGGs (Kenney Starter-Kit-Racing) | fresh `git clone` (HEAD 2f2e5f2): sha256 byte-identical; README: "Assets included in this package (2D sprites, 3D models and sound effects) are CC0 licensed … The skid sound effect was made by Landeplage and is also CC0 licensed"; repo LICENSE (MIT) covers code |
| DB11 glb (CC BY 4.0) | sha256 4d5641e5… equals the GitHub mirror cited in research 06; embedded `asset.extras` names Black Snow / CC-BY-4.0 / the Sketchfab source |

## Manifest (real `npm run build` output)
24 assets, 16.10 MiB total, initial set 5.30 MB, 10 attributions. Largest file 1.52 MiB.
```
0.10 MiB /assets/audio/engine-motorcycle.aed3b357.ogg     0.55 MiB /assets/textures/asphalt_track/asphalt_track_ao_1k.7bced281.jpg
0.11 MiB /assets/audio/engine.6d665dfc.ogg                0.82 MiB …/asphalt_track_diff_1k.05c4e79c.jpg
0.01 MiB /assets/audio/impact.964c5fcf.ogg                0.79 MiB …/asphalt_track_nor_gl_1k.18caf024.jpg
0.04 MiB /assets/audio/skid.e62a42c0.ogg                  0.44 MiB …/asphalt_track_rough_1k.0646d0cf.jpg
1.10 MiB /assets/car/aston-martin-db11.819d6035.glb       cobblestone_floor_08 ×4: 0.23 / 0.56 / 0.96 / 0.39 MiB
1.36 MiB /assets/hdri/derelict_airfield_01_1k.3a4d3206.hdr concrete_floor_01 ×4: 0.39 / 0.72 / 0.87 / 0.34 MiB
1.50 MiB /assets/hdri/evening_road_01_1k.a09703a8.hdr     grass_ground ×4: 0.92 / 0.84 / 1.25 / 0.31 MiB
1.52 MiB /assets/hdri/ferndale_studio_03_1k.6ef28f78.hdr
```
Asset ids follow §11 (path without extension, e.g. `car/aston-martin-db11`, `hdri/derelict_airfield_01_1k`,
`textures/asphalt_track/asphalt_track_diff_1k`, `audio/engine`), not the illustrative ids in the `Assets.url` doc
comment of `contracts/app.ts`.

## Deviations / known gaps
1. **No glTF `validate` run**: neither `gltf-validator` nor `@gltf-transform/cli` is installed and package.json is
   frozen. Substitute: the written GLB is re-parsed by NodeIO with meshopt decoding and its node names are checked.
   If a real validator is wanted, it needs an R4 dependency addition (`gltf-validator`, Apache-2.0).
2. Brake discs: the DB11 has 5 nodes named `amdb11_brakedisc_*` (4 corners + an extra `_RR`), so the guard is "≥ 4".
3. `prune` logs "Removed types… Primitive (26)": duplicate primitives orphaned by `dedup()`; all 320 named nodes
   survive (asserted). Wheels now share one mesh, which is fine for per-node regrouping.
4. CREDITS.md (not owned here) still says audio is "see the in-app credits panel"; for the orchestrator / 04-02:
   Kenney Starter-Kit-Racing sounds (CC0, Kenney; skid by Landeplage, CC0) and Poly Haven authors are now in the
   manifest attributions.

## Verification (real output)
```
$ npm run check
✔ no dependency violations found (52 modules, 100 dependencies cruised)
 Test Files  4 passed (4)
      Tests  30 passed (30)
$ npm run build
build-assets: 24 assets, 16.10 MiB total, initial set 5.30 MB, 10 attributions
dist/suspension_lab/index.js       71.30 kB │ gzip: 19.44 kB │ map: 136.24 kB
✓ built in 72ms  (worker)   ✓ built in 79ms  (client; dist/client/assets 17M, nothing > 24 MiB)
$ vite preview --port 4173 & node scripts/smoke-live.mjs http://localhost:4173
ok   GET / serves the app shell
ok   GET /api/health — version dev
ok   GET /api/time within 5 s of local clock — skew 0 ms, rtt 6 ms
ok   GET /asset-manifest.json — 24 assets, 10 attributions
ok   first manifest asset is served immutable — /assets/audio/engine-motorcycle.aed3b357.ogg
smoke-live: all checks passed
$ node scripts/smoke-live.mjs http://localhost:4999 ; echo $?   → 5 checks FAILED, exit 1
$ npx wrangler deploy --dry-run
✨ Read 51 files from the assets directory dist/client · Total Upload: 69.63 KiB / gzip: 18.91 KiB
env.ROOM (Room) Durable Object · env.STATS · env.AI · env.RL_ENGINEER · env.RL_ROOMS · env.ASSETS · env.APP_VERSION
--dry-run: exiting now.
```
Not deployed (01-04 does the first deploy).
