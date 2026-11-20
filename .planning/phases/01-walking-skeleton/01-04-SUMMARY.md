# 01-04 SUMMARY — Placeholder renderer, e2e smoke, first live deploy

**Status:** complete · commits `704296a` (plan), `324896f` (renderer), `a68c248` (debug + e2e), `d40e6d7` (e2e helper)
· **Live:** https://suspension-lab.zh-a16.workers.dev (version `a68c248`, Worker version id af03fa93-0cf2-4571-8d0a-41dd26278de3)

## Built
- **`src/features/renderer/index.ts`**: provides `RENDER` — `WebGLRenderer` (antialias; a context failure throws in
  `init` → kernel fatal overlay "This experience needs WebGL 2"), Y-up `Scene` (background #07080A), `PerspectiveCamera`
  (55°), `add()` returning a remover, `quality` = `QUALITY_PRESETS[store.quality]`, `compile()` = `compileAsync`,
  `stats()` (fps/frameMs EMA over ~60 frames, `renderer.info` calls/triangles/geometries/textures, pixel ratio).
  Pixel ratio 1 in e2e, else `min(devicePixelRatio, preset.maxPixelRatio)` (re-applied on store change, only when
  different). Resize via `ResizeObserver` on `#stage`. `CSS2DRenderer` label layer stacked over the canvas in `#stage`
  (pointer-events none), rendered every frame. No governor yet (07-01).
- **`src/features/renderer/placeholder.ts`** (deletable once 03-01/03-03/04-01 land): hemisphere light, track
  centreline polyline every 2 m from `sim.current.track.toWorld(s, 0)`, body box sized from the vehicle definition
  (wheelbase, cgHeight, front track) and one cylinder per `frame.corners` entry (tyre radius per axle), posed from
  `bodyPosition/bodyRotation` and `wheelPosition/wheelRotation` via `simToThree`/`simQuatToThree`; rebuilt on
  `sim:vehicle`. Chase camera (9 m back, 3.2 m up) only while `services.tryGet(CAMERA)` is undefined.
  `update()` allocates nothing.
- **`src/features/debug/index.ts`**: stats-gl (`trackGPU: false`) in `#overlay`, `init(renderer)`; the original
  `renderer.render` (stats-gl wraps it) is restored on dispose. Class `sl-debug-stats`.
- **`tests/e2e/helpers.ts`**: `captureConsole` (console errors + page errors + HTTP ≥ 400 responses with URL),
  `waitForReady`, `canvasVariance` (element screenshot decoded in-page → greyscale variance; works without
  `preserveDrawingBuffer` and against production), `expectHealthyBoot`.
- **`tests/e2e/smoke.spec.ts`**: (1) `/?e2e=1` ready, renderer enabled, draw calls > 0, pixel ratio 1, canvas variance
  > 5, zero `__app.errors` + console errors; (2) `?e2e=1&paused=1&t=5` + `advance(1)` → lapTime +1 s within SIM_DT
  (interpolation lag noted by 01-02); (3) `?debug=1` shows the stats-gl canvas, no errors.

## Deploy / bindings outcome
`npm run deploy` with env credentials: **all bindings accepted** on first deploy — Durable Object `ROOM` (SQLite
migration), Analytics Engine `STATS` (`suspension_lab_events`), `AI`, rate limits `RL_ENGINEER` (6/60 s) and
`RL_ROOMS` (10/60 s), `ASSETS`, `APP_VERSION`. 43 static files uploaded. No `wrangler.jsonc` change needed.

## Deviations / notes
1. The renderer keeps its per-frame closure in module scope (`FeatureModule.update` receives no context).
2. First production e2e run, ~10 s after deploy: the `?debug=1` test saw one console "Failed to load resource: 404"
   (URL not captured then). Not reproducible: afterwards 3 × 3 runs and `--repeat-each=8` (24 tests) all passed.
   Most likely edge propagation right after upload. `captureConsole` now also records failing URLs (`d40e6d7`,
   test-only, not redeployed) so a recurrence names the resource.
3. Phase-2 executors were working in the tree; `npm run check` was fully green (no failures in their files at the time).
4. `APP_VERSION` shows as "(hidden)" in wrangler's binding table (`--var`), but `/api/health` returns `a68c248`.

## Verification (real output)
```
$ npm run check
✔ no dependency violations found (75 modules, 177 dependencies cruised)
 Test Files  11 passed (11)
      Tests  121 passed (121)
$ npm run e2e
  ✓  1 [chromium] › tests/e2e/smoke.spec.ts:5:1 › boots, renders a non-blank scene, no errors (639ms)
  ✓  2 [chromium] › tests/e2e/smoke.spec.ts:17:1 › paused start is deterministic and advance() moves the lap clock (327ms)
  ✓  3 [chromium] › tests/e2e/smoke.spec.ts:30:1 › ?debug=1 shows the stats panel (357ms)
  3 passed (3.8s)
$ CI=1 WRANGLER_SEND_METRICS=false npm run deploy
Uploaded suspension-lab (5.64 sec) · Deployed suspension-lab triggers (0.50 sec)
  https://suspension-lab.zh-a16.workers.dev
Current Version ID: af03fa93-0cf2-4571-8d0a-41dd26278de3
$ npm run smoke:live
ok   GET / serves the app shell
ok   GET /api/health — version a68c248
ok   GET /api/time within 5 s of local clock — skew 16 ms, rtt 62 ms
ok   GET /asset-manifest.json — 24 assets, 10 attributions
ok   first manifest asset is served immutable — /assets/audio/engine-motorcycle.aed3b357.ogg
smoke-live: all checks passed
$ PLAYWRIGHT_BASE_URL=https://suspension-lab.zh-a16.workers.dev npx playwright test tests/e2e/smoke.spec.ts --repeat-each=8
  24 passed (16.6s)
$ live /?e2e=1 after 1.5 s: stats {"fps":58.9,"calls":6,"triangles":396,"geometries":6,"textures":0,"pixelRatio":1}, errors []
```
Screenshot (live, 1280×800, DPR 1): placeholder box + 4 wheels on the mint centreline, chase view.

## Known gaps
- No adaptive governor / post stack (07-01, 03-02). No human-verify of the live URL on a real device yet.
- Main chunk is 561 kB (three.js unsplit); budget work belongs to 07-02.
