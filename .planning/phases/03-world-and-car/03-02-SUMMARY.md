# 03-02 SUMMARY — Renderer post stack + environment

**Status:** complete · commits `fc38d53` (plan), `7f586e7` (composer + governor), `13b2648` (environment),
`8466130` (e2e) · not deployed (per instructions)

## Built
- **`renderer/post.ts`** — pmndrs `postprocessing` 6.39.6 `EffectComposer` with `HalfFloatType` buffers:
  `RenderPass` → `N8AOPostPass` (high only; half-res, radius 0.9 m, intensity 2.5, `Medium`) → ONE merged
  `EffectPass` [`SMAAEffect(SMAAPreset.HIGH)` (medium/high), `BloomEffect` (mipmapBlur, threshold 3 linear,
  intensity 0.3; medium/high), `VignetteEffect` (0.38/0.3), `ToneMappingEffect(ToneMappingMode.AGX)`], `dithering`
  on against banding. Pass list rebuilt on `store.quality`; final passes cached per bloom/smaa combination.
  n8ao is `import()`ed on demand (own 205 kB chunk; main chunk 779 kB vs 965 kB eager). Names verified against
  `node_modules/postprocessing/build/types/index.d.ts` and `node_modules/n8ao/src/N8AOPostPass.js`
  (`setQualityMode('Medium')`, `configuration.{aoRadius,distanceFalloff,intensity,halfRes}`); n8ao ships no types →
  `renderer/n8ao.d.ts`.
- **`renderer/index.ts`** — `WebGLRenderer({ antialias:false, depth:false, stencil:false })`, `NoToneMapping`,
  shadow map enabled up front (`PCFShadowMap`; r187 warns that `PCFSoftShadowMap` was removed), `info.autoReset =
  false` + one reset per frame so `stats().calls` covers shadow + AO + post. Start tier `(pointer: coarse)` → low
  (unless `?quality`/e2e). `RenderService.quality` = preset with the governed ratio as `maxPixelRatio` (cached
  object, no per-read allocation). `compile()` = await AO module → `compileAsync(scene, camera)` → one full composer
  render (warms shadow + post programs). `init` awaits the AO module so the high tier's first frame has AO.
- **`renderer/governor.ts`** — pure §10 governor: 60-frame EMA; > 18.5 ms for 2 s → ratio −0.1 (≥ min); < 14 ms for
  5 s → +0.05 (≤ max); at min AND still slow for 5 s → one tier down, once per session (`console.info` logged).
  Off in e2e and with `?quality=`; the EMA still feeds `stats()`.
- **`environment/hdri.ts`** — `clampHdr` clamps HDRLoader's RGBA half-float data in place by integer compare
  (non-negative halfs order like their bits), returning sun direction (excess-energy-weighted, three's
  `equirectUv` convention), colour, clipped irradiance and the 2–8° horizon band colour; `snapToTexel`.
- **`environment/index.ts`** — looks: `airfield` (`hdri/derelict_airfield_01_1k`, clamp 48) for follow/explore,
  `studio` (`hdri/ferndale_studio_03_1k`, clamp 160, background ×0.35) for closeup; PMREM via
  `fromEquirectangular` (shader precompiled), PMREM texture as environment and blurred background
  (`backgroundBlurriness` 0.06 / 0.25); linear fog coloured from the horizon band; one `DirectionalLight` sun with
  the HDRI's direction/colour and intensity = clipped irradiance × scale (clamped), shadow box ±12 m following the
  mean contact patch, texel-snapped in light space, map size from `quality.shadowMapSize` (0 → no cast);
  contact blob (64² superellipse alphaMap, one draw, yaw from body, fades with heave). First look blocks init;
  the other preloads on `app:ready`. Everything restored/disposed on dispose.
- **Placeholder** (`renderer/placeholder.ts`): PBR materials, shadow casting, 600 m ground disc receiving the
  shadow; hemisphere fill reduced to 0.4; hides itself when a vehicle visual is registered (03-03 lands).

## Measured HDRI facts (1k files)
derelict_airfield: peak 31231 at px (614, 204) → sun ≈ 18° elevation; p99 4.6; clipped irradiance ≈ 2.7 →
sun intensity 2.7. evening_road peak 17 (no clamp needed). ferndale_studio softboxes peak 4820, p999 41.

## Deviations / notes
1. Governor "at min for 5 s" counts only while still slow (a device running fine at min keeps its tier).
2. SMAA merged into the single EffectPass (§18 "one combined effect pass") instead of its own pass after the grade
   (research 13 B6); edge detection therefore sees linear HDR input. Revisit if thin-edge AA looks weak on GPUs.
3. No MSAA on the composer (SMAA only); low tier has no AA (preset `smaa:false`).
4. Extra owned test `tests/features/environment.test.ts` (§3 feature-owner naming): clamp on the real airfield HDRI,
   fallback, equirect convention, texel snap.
5. e2e warning assertion ignores only Chromium's "GPU stall due to ReadPixels" notice, which page screenshots trigger
   (seen on the pre-change build too).
6. For the orchestrator: the placeholder (incl. its ground disc) must be deleted once 03-01/03-03/04-01 are in; it
   auto-hides when a vehicle visual is registered, but its ground stays only while it is visible.
7. No code lifted; no new assets. CREDITS: postprocessing (Zlib) and n8ao (ISC) are already listed in §15 code credits.

## Known gaps
- Looks tuned by eye in SwiftShader only (fps meaningless there); bloom/AO strength and exposure need a real-GPU
  pass with the DB11 (03-03) and the textured track (03-01). Fog distances (80–700 m) assume 03-01's terrain.
- Studio key light comes from the brightest softbox (low angle, long shadow); fine for a close camera.
- Main chunk 779 kB (postprocessing); bundle splitting is 07-02's.

## Verification (real output)
```
$ npm run check
✔ no dependency violations found (101 modules, 247 dependencies cruised)
 Test Files  23 passed (23)
      Tests  253 passed (253)
  (first run: 9 failures in tests/sim-core/kinematics-table.test.ts — phase-2 executor mid-work; green on re-run)
$ npm run e2e        (includes npm run build)
dist/client/assets/N8AO-chMiC6I3.js   204.66 kB │ gzip: 105.70 kB
dist/client/assets/main-ByaDWFvO.js   779.31 kB │ gzip: 233.63 kB
✓ built in 768ms
  ✓  1 03-02-env.spec.ts › low tier: HDRI-lit scene without shadow/AO/bloom, zero console errors and warnings (6.7s)
  ✓  2 03-02-env.spec.ts › high tier: post-processing ON (N8AO, bloom, SMAA, AgX) + sun shadow, zero console errors and warnings (18.3s)
  ✓  3 03-02-env.spec.ts › closeup swaps to the studio HDRI; runtime tier changes recompile cleanly (27.0s)
  ✓  4 smoke.spec.ts › boots, renders a non-blank scene, no errors (7.4s)
  ✓  5 smoke.spec.ts › paused start is deterministic and advance() moves the lap clock (3.4s)
  ✓  6 smoke.spec.ts › ?debug=1 shows the stats panel (6.7s)
  6 passed (1.2m)
stats (SwiftShader, 1280×800, DPR 1, t=5): low {calls 10, tris 475}; medium t=20 {calls 33}; high {calls 85, tris 1404}
```
Screenshots (DPR 1, inspected): before `03-02-before-follow.png`, `03-02-before-high.png`; after
`03-02-low.png`, `03-02-high.png`, `03-02-high-follow.png`, `03-02-high-closeup.png`, `03-02-v3-low-t20.png`,
`03-02-v2-medium-t20.png`, `03-02-v2-high-t12.png` in the session scratchpad `shots/` folder. Judged: no blown
highlights (sun clamped; studio softbox hotspot stays grey-white), no visible banding (dithered), no black frames,
sRGB output correct (sky/foliage natural, AgX slightly desaturated as expected). Fixed during review: the contact
blob was invisible (three's alphaMap reads green, not alpha).
