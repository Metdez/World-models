# Roadmap: Suspension Lab

## Overview
Seven phases, each ending deployed at https://suspension-lab.zh-a16.workers.dev. Phase 1 ships a walking skeleton
(scaffold, frozen contracts, kernel, placeholder renderer, Worker API, first deploy). Phase 2 builds the honest core:
a pure, tested simulation (track, speed profile, kinematics solver, 7-DOF ride). Phase 3 makes it beautiful (world,
DB11, procedural suspension, x-ray). Phase 4 makes it understandable (cameras, HUD, insights, overlays, attract).
Phase 5 adds the motorcycle class. Phase 6 adds what only the edge can do (Live Lab, presenter remote, poll, AI
Race Engineer, analytics). Phase 7 hardens performance, delivery, accessibility and event readiness.
**Stop points:** after phase 3 the product is a correct, good-looking suspension comparison; after phase 4 it is the
complete single-user experience (the minimum demo-able product); phases 5–7 add breadth, edge features and polish.

Binding references for every planner/executor: `.planning/ARCHITECTURE.md` (contract, ownership, tests),
`.planning/research/SUMMARY.md` (decisions), Ponytail rules (ARCHITECTURE §19).

### Conventions used below
- **Wave**: plans in the same wave run in parallel; their `files_modified` are disjoint. Waves run in order.
- **Owns**: the only files/globs the plan may create or edit (ARCHITECTURE §3, §9.3). Tests named per §16.
- **Verify** commands every plan runs before its final commit: `npm run check` (= typecheck + lint:deps + test)
  plus the listed extras. Plans with visible output add their e2e spec.
- **Phase gate** (run by the orchestrator/verifier after the last wave, not a plan):
  `npm run check && npm run build && npm run e2e && npm run deploy && npm run smoke:live &&`
  `PLAYWRIGHT_BASE_URL=https://suspension-lab.zh-a16.workers.dev npx playwright test tests/e2e/smoke.spec.ts`.
  E2E specs of parallel plans that need a sibling plan (e.g. parts need vehicle-view) are first run here.
- **v1-critical / stretch** is marked per plan and per task; a stretch item may be dropped at the phase gate without
  breaking the product (record it in STATE.md Deferred Items).

## Phases
- [ ] **Phase 1: Walking skeleton (live)** — scaffold, frozen contracts, kernel, placeholder renderer, Worker health/time, first deploy
- [ ] **Phase 2: Simulation core** — proving loop, speed profile, kinematics solver + 3 car suspensions, 7-DOF ride, facade
- [ ] **Phase 3: World and car rendering** — track mesh, environment + post, DB11 with hubs, procedural suspension, x-ray
- [ ] **Phase 4: Experience layer** — cameras, HUD, telemetry, insights, teaching overlays, attract mode, credits
- [ ] **Phase 5: Motorcycle** — planar kinematics + 4-DOF + lean, three presets, procedural cafe racer
- [ ] **Phase 6: Cloudflare edge** — rooms (Live Lab, presenter remote, poll), AI Race Engineer, analytics
- [ ] **Phase 7: Polish, performance, event readiness** — perf budgets, delivery hardening, accessibility, runbook, final verify

## Phase Details

### Phase 1: Walking skeleton (live)
**Goal**: A deployed, end-to-end skeleton where every layer exists and is wired: contracts frozen, kernel running a
fixed-step stub simulation, a placeholder 3D scene driven by telemetry, the Worker answering `/api/health` and
`/api/time`, all Cloudflare bindings validated by a real deploy.
**Depends on**: Nothing (first phase)
**Requirements**: ARCH-01, ARCH-02, ARCH-03, ARCH-05, ARCH-06, DEP-01, DEP-02, DEP-03 (headers, CSP report-only), DEP-04 (size guard), UI-04 (tokens), CRED-01 (attribution manifest)
**Success Criteria** (what must be TRUE):
  1. https://suspension-lab.zh-a16.workers.dev shows a placeholder box car with four wheel cylinders circling a stub track, no console errors.
  2. `/api/health` returns `{ ok: true, version: <git sha> }`; `/api/time` is within 5 s of local time; `npm run smoke:live` passes.
  3. `npm run check` is green with dependency-cruiser rules active; all 21 feature stubs are registered; `?features=-debug` boots clean.
  4. `/?e2e=1` exposes `window.__app` with `ready === true` and an empty `errors` list (Playwright smoke passes locally and against production).
  5. The first deploy accepted the DO (SQLite), AI, Analytics Engine and Rate Limiting bindings, or STATE.md records which binding was dropped and the fallback.
**v1-critical**: everything in this phase. **Stretch**: none.
**Plans**: 4 plans

| Plan | Wave | Name | Owns (files_modified) | Depends | Acceptance / verify |
|---|---|---|---|---|---|
| 01-01 | 1 | Scaffold, toolchain, contracts, stubs | `package.json`, `package-lock.json`, `tsconfig*.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `wrangler.jsonc`, `worker-configuration.d.ts`, `.dependency-cruiser.cjs`, `.gitignore`, `index.html`, `remote.html`, `CREDITS.md`, `public/_headers`, `public/favicon.svg`, `scripts/build-assets.mjs` (stub), `src/contracts/**`, `src/app/features.ts`, `src/features/*/index.ts` (21 stubs), `src/ui/**`, `src/remote/main.ts`, `worker/index.ts`, `worker/room.ts`, `worker/routes/*.ts` (stubs), `tests/arch/purity.test.ts`, `tests/arch/contracts-verbatim.test.ts` | — | `npm run check` green; contracts-verbatim test extracts §5 blocks from ARCHITECTURE.md and byte-compares; `grep -c "export { default as" src/app/features.ts` = 21; `npm run build && npx wrangler deploy --dry-run` succeeds; chromium installed |
| 01-02 | 2 | Kernel, composition root, stub simulation | `src/kernel/**`, `src/app/main.ts`, `src/sim-core/index.ts`, `src/sim-core/math/**`, `src/sim-core/stub/**`, `tests/kernel/**`, `tests/sim-core/math.test.ts` | 01-01 | tests: registry, services, flags table (§8), topo sort + cycle error, cascade disable, init-failure isolation, loop with random dts gives identical step counts per sim-second, live-clock slew/seek, disposal baseline; stub sim implements `Simulation` (circle R 60 m, 15 m/s, sinusoidal travel) incl. pure `stateAt`/`lapTimeAt` |
| 01-03 | 2 | Worker API, asset pipeline, live smoke script | `worker/routes/health.ts`, `worker/routes/time.ts`, `scripts/build-assets.mjs`, `scripts/smoke-live.mjs`, `assets-src/ATTRIBUTION.json`, `tests/worker/health-time.test.ts`, `tests/scripts/build-assets.test.ts` | 01-01 | Hono `app.request` tests for both routes (no-store header, version from env); pipeline per ARCHITECTURE §11: hashed names, manifest, attribution enforcement (test with a temp dir missing an entry fails), DB11 node-name assertion, size guard; every assets-src file has a verified source + licence (unverifiable files removed, noted in SUMMARY); `npm run build` produces `dist/` |
| 01-04 | 3 | Placeholder renderer, e2e smoke, first live deploy | `src/features/renderer/**`, `src/features/debug/**`, `tests/e2e/smoke.spec.ts`, `tests/e2e/helpers.ts` | 01-02, 01-03 | renderer provides RENDER (WebGLRenderer, Y-up scene, camera behind the car, resize, CSS2D layer, `stats()`), placeholder track polyline from `sim.current.track.toWorld`, box + 4 cylinders from POSE fields via `simToThree`; debug feature shows stats-gl with `?debug=1`; `npm run e2e` green; `npm run deploy` with env credentials; `npm run smoke:live` + production smoke green; binding outcome recorded |

Task outline (planner expands; 2–3 tasks each):
- 01-01: (1) toolchain + configs + install all §1 deps + `npx playwright install chromium` + `npm run typegen`; (2) contracts verbatim + `src/ui` (tokens from research 14 D2/D3, base.css with Fontsource imports, `dom.ts` `h()`/`mount()`, `format.ts` deg/mm/kmh/kN/gUnits) + `index.html` (`#stage`, `#overlay`); (3) stubs (features, worker routes, Room DO, remote, build-assets stub writing an empty manifest) + `.dependency-cruiser.cjs` + arch tests.
- 01-02: (1) registry/services/store/bus/flags/clock/assets + tests; (2) feature manager + loop + sim-host + live clock + test hooks + tests with fake raf/sim; (3) math lib + stub simulation + `main.ts` (fatal overlay, `vite:preloadError` reload once).
- 01-03: (1) health/time routes + tests; (2) ATTRIBUTION.json + build-assets + tests; (3) smoke-live script + build + dry-run.
- 01-04: (1) renderer + placeholder scene; (2) debug feature + Playwright smoke spec + helpers (`waitForReady`, console capture, canvas non-blank); (3) deploy + live smoke (+ checkpoint:human-verify: open the live URL).

### Phase 2: Simulation core
**Goal**: The honest heart: a pure, deterministic sim-core in which the GT car drives the real proving loop, with
three car suspensions solved from hardpoints that reproduce the Chrono-derived reference values and produce the
documented differences through a 7-DOF ride model — visible already on the live placeholder car.
**Depends on**: Phase 1
**Requirements**: SIM-01, SIM-02, SIM-03, SIM-04, SIM-05, KIN-01, KIN-02, KIN-03, KIN-04, RIDE-01, RIDE-02, RIDE-03, RIDE-04, ARCH-04, PERF-02 (sim), HON-01 (copy test), HON-02 (naming)
**Success Criteria**:
  1. `npm test` reproduces every Chrono reference value (ARCHITECTURE §7.3) and the shipped definitions meet every tuning gate and ordering (§7.4); the printed kinematics table is in the 02-02 SUMMARY.
  2. A 10 s golden run (seed 42) hashes identically across runs; `step()`/`sample()` allocate nothing.
  3. On the live site the placeholder car laps the proving loop in 65–85 s, rolls/pitches with the ride model and its wheels move with travel.
  4. At the carousel apex (fixed `?t=`), `__app.frame()` shows the outside front wheel losing more camber to the road with MacPherson than with multi-link, and least with double wishbone (e2e).
  5. `?suspension=` swaps take effect within one step while the car keeps driving (no path discontinuity).
**v1-critical**: all. **Stretch**: RC lateral migration metric; ISO class D pave detail beyond per-stone noise.
**Plans**: 4 plans

| Plan | Wave | Name | Owns | Depends | Acceptance / verify |
|---|---|---|---|---|---|
| 02-01 | 1 | Track builder, road surface, speed profile | `src/sim-core/track/**`, `src/sim-core/path/**`, `src/sim-core/content/proving-loop.ts`, `tests/sim-core/track*.test.ts`, `tests/sim-core/path*.test.ts`, `tests/fixtures/02-01-*.ts` | 01-02 | track gates §7.5 (closure < 1 mm/1e-6 rad, solved straights > 50 m, total 1.3–1.7 km, clearance ≥ 30 m, curvature continuity); `roadHeight` finite/continuous, each feature amplitude as specified, kerb/bump only in their lateral bands, crest |a_z| ≤ 0.6 g at target speed; speed profile: lap 65–85 s with GT limits fixture, |ay| ≤ lateral(+1 %), ax within limits, `stateAt` pure and periodic, `timeAtS`∘`stateAt` consistent ±1 ms |
| 02-02 | 1 | Kinematics solver + three car suspensions | `src/sim-core/kinematics/**`, `src/sim-core/content/susp-*.ts`, `src/sim-core/content/gt-geometry.ts`, `tests/sim-core/kinematics*.test.ts`, `tests/sim-core/db11-fit.test.ts`, `tests/fixtures/02-02-*.ts` | 01-02 | TDD: §7.3 reference table + property tests; `solveAxleKinematics` per §7.2.2 (no allocation in `sample`); `gt-geometry.ts` (wheelbase, track F/R, tyre radius F/R, wheel-centre height) measured from the GLB by `db11-fit.test.ts`; three defs fitted per §7.4 with copy (no digits); `kinematics-gates.test.ts` passes and prints the table |
| 02-03 | 1 | 7-DOF ride model + tyre grip | `src/sim-core/ride/**`, `tests/sim-core/ride*.test.ts` | 01-02 | per §7.2.3: static deflection = load/rate ±1 %; body modes 1.2–1.8 Hz, hop 10–15 Hz (impulse-response period); steady-state lateral load-transfer sums ±2 % of closed form (05 §3.1); braking pitch with anti-pitch 0/0.25 matches 05 §3.2 ±5 %; lift-off clamp; asymmetric damping; semi-implicit stability at SIM_DT; `gripUse` monotone in |fy|, decreases with |camber to road| beyond 3° |
| 02-04 | 2 | Simulation facade, GT coupe, integration | `src/sim-core/index.ts`, `src/sim-core/simulation.ts`, `src/sim-core/vehicle-models.ts`, `src/sim-core/car/**`, `src/sim-core/moto/model.ts` (stub that throws "motorcycle model arrives in phase 5"), `src/sim-core/content/gt-coupe.ts`, delete `src/sim-core/stub/**`, `src/features/car/index.ts`, `src/features/track/index.ts`, `tests/sim-core/simulation*.test.ts`, `tests/sim-core/golden.test.ts`, `tests/sim-core/no-alloc.test.ts`, `tests/arch/no-id-branching.test.ts`, `tests/arch/content-copy.test.ts`, `tests/e2e/02-04-sim.spec.ts` | 02-01, 02-02, 02-03 | `createSimulation` per §7.6 + VehicleModel seam §7.2.4; GT coupe §7.5 with ARB tuned to 1.0–1.2 °/g (DW); `car`/`track` features contribute content; tests: stateAt identical across suspensions, setSuspension continuity, seek settles, amplification affects POSE only, events fire once with hysteresis, golden hash, no-alloc; e2e camber ordering at carousel; phase gate deploy |

Task outline:
- 02-01: (1) primitives → dense arrays, closure solve, BuiltTrack sample/sectionIndexAt/toWorld/lineOffset + gates; (2) `roadHeight` (swell, bank, ISO 8608 LUT 2 cm seeded, features, kerbs) + tests; (3) speed profile, `stateAt`, `timeAtS` + tests.
- 02-02: (1) LM solver + spatial residuals + metrics, TDD against §7.3; (2) LUT/table/curves/summary + property tests; (3) GLB fit → `gt-geometry.ts`, three fitted definitions + gates report.
- 02-03: (1) 7-DOF integrator, equilibrium, stops, lift-off; (2) geometric/elastic load transfer + anti-pitch; (3) tyre grip + modal tests.
- 02-04: (1) car model + Simulation + tests; (2) GT coupe + content contributions + arch tests; (3) golden + no-alloc + e2e (+ phase gate).

### Phase 3: World and car rendering
**Goal**: Premium visuals on top of the honest sim: the proving loop as a real place, HDRI lighting and a restrained
post stack, the DB11 driving with hub-grouped wheels, and every suspension type built procedurally from solver
points, readable through an x-ray body.
**Depends on**: Phase 2
**Requirements**: VIS-01, VIS-02, VIS-03, VIS-04, VIS-05, PERF-03 (tiers + governor), HON-02 (badges hidden)
**Success Criteria**:
  1. The live site shows the DB11 lapping a textured track with kerbs, markings, cones, terrain, HDRI lighting, a car-following shadow and post-processing; `?quality=low` renders without shadow/AO/bloom.
  2. Wheels sit on the drawn road (contact patch within 1 cm of the mesh surface along a lap) and spin/steer/travel.
  3. Pressing X ghosts the body smoothly; each of the three suspensions is visibly a different linkage, with identical role colours, moving with the wheel (x-ray screenshots at the carousel apex attached to the phase verification).
  4. Suspension swaps and x-ray toggles cause no shader-compile hitch (all suspension visuals pre-built and compiled at vehicle load).
  5. Follow view stays ≤ 250 draw calls (`__app.stats()`), no console errors.
**v1-critical**: track ribbon + kerbs + markings, HDRI IBL + sun shadow, DB11 hub regroup + re-material, linkage parts (arms, links, upright, damper, spring, disc/caliper), x-ray.
**Stretch**: N8AO, bloom tuning, terrain distance-field blend, anti-roll-bar visual, CV boots, orange-peel paint normal.
**Plans**: 4 plans (all wave 1)

| Plan | Wave | Name | Owns | Depends | Acceptance / verify |
|---|---|---|---|---|---|
| 03-01 | 1 | Track view | `src/features/track/**`, `tests/features/track.test.ts`, `tests/e2e/03-01-track.spec.ts` | Phase 2 | ribbon bands (asphalt, kerb, runoff) sampled from `roadHeight` at `quality.trackResolution`, UVs in metres; markings + kerb stripes via `onBeforeCompile`; CC0 asphalt/grass/concrete textures via `ctx.assets`; terrain plane dipping away; instanced cones from `track.props`; start line; ≤ 30 draw calls; node test: vertex z equals `roadHeight` at sample points |
| 03-02 | 1 | Renderer post stack + environment | `src/features/renderer/**`, `src/features/environment/**`, `tests/features/renderer-governor.test.ts`, `tests/e2e/03-02-env.spec.ts` | Phase 2 | postprocessing composer: Render → N8AO half (high) → Bloom/Vignette/AgX tone map → SMAA, HalfFloat, reacts to `store.quality`; governor per §10 (pure logic tested); HDRI per view (follow/explore: derelict_airfield; closeup: ferndale_studio), PMREM, blurred background, sun following the car (texel-snapped, size from quality), contact blob, fog; `RenderService.compile()` |
| 03-03 | 1 | DB11 visual + vehicle-view runtime | `src/features/car/**`, `src/features/vehicle-view/**`, `tests/features/vehicle-view.test.ts`, `tests/e2e/03-03-car.spec.ts` | Phase 2 | `db11` VehicleVisual: load by asset id, root rotation (§4), hub group per corner identified by world position, rim+tyre+disc spin, caliper steers only, MeshPhysicalMaterial clearcoat paint/glass/rubber, badges + stock suspension meshes hidden (name list in SUMMARY), `setXray` fresnel ghost; car feature also contributes the visual; vehicle-view pre-builds all suspension visuals of the vehicle hidden, compiles, toggles on `sim:suspension`, routes `highlight` with timeout, x-ray fade 0.4 s; e2e contact-patch-on-road check + screenshots |
| 03-04 | 1 | Procedural linkage parts + kit3d | `src/kit3d/**`, `src/features/linkage-parts/**`, `tests/features/linkage-parts.test.ts`, `tests/features/kit3d.test.ts`, `tests/e2e/03-04-parts.spec.ts` | Phase 2 | kit3d per research 22 B0–B7 (tube, rigid frame-from-3, upright hull + creased normals, A-arm, telescoping damper, CPU constant-wire-radius spring with coil-bind clamp, disc + caliper, materials from COMPONENT_COLORS); `spatial-linkage` SuspensionVisual built from constraints/members/roles + `CornerFrame.pointOrder`, zero-alloc update, emissive highlight; node tests: builds for all 3 defs, no NaN, spring wire radius constant across lengths |

Task outline:
- 03-01: (1) ribbon + materials/markings; (2) terrain, cones, start line, quality reaction; (3) tests + e2e.
- 03-02: (1) composer + quality reactions + governor; (2) environment (HDRI per view, sun, contact blob, fog); (3) compile hook + e2e.
- 03-03: (1) DB11 visual; (2) vehicle-view runtime (prebuild/toggle/xray/highlight); (3) e2e road-contact + screenshots.
- 03-04: (1) kit3d helpers + tests; (2) spatial-linkage visual; (3) node tests + e2e spec (runs at the phase gate).

### Phase 4: Experience layer
**Goal**: Turn the simulation into show-don't-tell: three camera views, a minimal premium HUD with one-click
suspension swaps, live telemetry, contextual insights with true values, engineer overlays (roll centre, ghost pose,
camber trace), honest amplification, an attract mode that sells it untouched, and credits.
**Depends on**: Phase 3
**Requirements**: CAM-01, CAM-02, UI-01, UI-02, UI-03, UI-04, EDU-01, EDU-02, EDU-03, EDU-04, EDU-05, EDU-06, EDU-07, ATR-01, CRED-01 (panel), HON-01, HON-03, A11Y-01 (baseline)
**Success Criteria**:
  1. One click (or 1/2/3) swaps suspension while the car keeps driving; F/E/C switch Follow/Explore/Close-up with smooth blends; X toggles x-ray.
  2. The telemetry panel (g-g, per-corner gauges, sparkline with ghost of the previous suspension) runs at 30 Hz; insights appear at matching sections quoting live values; a delta chip follows each swap.
  3. Engineer overlay shows live roll-centre/instant-centre construction lines, the ghost rest pose and the camber trace; with amplification on, the "Motion ×2.5 · values true scale" chip is always visible and A returns to ×1.
  4. Untouched for 30 s (or `?attract=1`) the attract storyboard loops; any input exits with a fade.
  5. The credits panel shows the exact DB11 CC BY text and the Chrono BSD-3 notice; every P4 feature passes a 2-corner (motorcycle) frame test.
**v1-critical**: CAM-01, UI-01, UI-02 (g-g + gauges), UI-03, EDU-01, EDU-02, EDU-03 (RC lines + ghost + camber trace), EDU-04, EDU-05, ATR-01, credits.
**Stretch**: CAM-02 trackside/overhead shots, camera shake, EDU-06 tradeoff bars, EDU-07 part labels, load arrows/contact patches, sparkline ghost.
**Plans**: 4 plans (all wave 1)

| Plan | Wave | Name | Owns | Depends | Acceptance / verify |
|---|---|---|---|---|---|
| 04-01 | 1 | Camera rig + attract mode | `src/features/camera/**`, `src/features/attract/**`, `tests/features/camera.test.ts`, `tests/features/attract.test.ts`, `tests/e2e/04-01-camera.spec.ts` | Phase 3 | CAMERA service; follow = spring-damped chase with look-ahead from `stateAt(lapTime+Δ)`; explore = camera-controls targeting the moving car; closeup = body-frame anchor per corner (`focusCorner`/`camera:focus`), x-ray on; pose blend ≤ 1.4 s, `1-exp(-λdt)` damping, reduced-motion fade; director shots (stretch: trackside/overhead/front-view); attract: idle 30 s, storyboard (research 21 §3) driving store + shots + ≤ 8-word captions, emits `user:activity`, restores prior state on exit; tests: damping frame-rate independence, scheduler timeline |
| 04-02 | 1 | HUD controls + loading + credits | `src/features/controls/**`, `src/features/credits/**`, `CREDITS.md`, `tests/features/controls.test.ts`, `tests/e2e/04-02-controls.spec.ts` | Phase 3 | layout per research 14 D5 with tokens; suspension segmented control from `vehicle.suspensions` + `copy.label` (radiogroup, roving tabindex); view control; vehicle toggle (hidden when one class registered); fullscreen; keyboard map (UI-01); pause / slow-mo 0.25× / "Live" chip; amplification chip (HON); loading overlay (weighted progress, hides on `app:ready`); credits panel from manifest + `code-credits.ts`; CREDITS.md complete; e2e: clicks + keys change store and frame |
| 04-03 | 1 | Telemetry panel + insights | `src/features/telemetry-panel/**`, `src/features/insights/**`, `tests/features/telemetry-panel.test.ts`, `tests/features/insights.test.ts`, `tests/e2e/04-03-hud.spec.ts` | Phase 3 | canvas g-g with trail, per-corner camber arc + travel bar + load square (2 or 4 corners), sparkline (metric tabs) with ghost snapshot on `sim:suspension`, 30 Hz ticker; insight rules keyed by section phenomenon + sim events, templates without digits filled via `format.ts`, ≤ 1 per 8 s, hysteresis, aria-live; delta chip (value before swap vs after 1 s settle); tradeoff bars (stretch) from `kinematics()` summaries + qualitative words |
| 04-04 | 1 | Teaching overlays | `src/features/teaching-overlays/**`, `tests/features/teaching-overlays.test.ts`, `tests/e2e/04-04-overlays.spec.ts` | Phase 3 | active when `store.overlay === 'engineer'` (closeup defaults it on): per-axle front-view construction lines (contact patch → IC, RC dot with short trail) from POSE fields; ghost rest pose from `sim.restPose`; camber-vs-travel trace canvas with moving dot and previous suspension faint; stretch: load arrows + contact-patch ellipses (colour by gripUse, warn > 1), CSS2D part labels in closeup (≤ 8); zero-alloc updates; 2-corner frame test |

Task outline:
- 04-01: (1) rig + three views + blends; (2) director shots; (3) attract timeline + tests + e2e.
- 04-02: (1) HUD shell + segmented controls + toggles; (2) keyboard, time controls, amplification chip, loading overlay; (3) credits panel + CREDITS.md + e2e.
- 04-03: (1) telemetry panel; (2) insights engine + delta chip + aria-live; (3) tradeoff bars (stretch) + e2e.
- 04-04: (1) construction lines + ghost pose; (2) camber trace + load arrows/patches; (3) part labels (stretch) + e2e.

### Phase 5: Motorcycle
**Goal**: A second vehicle class on the same principle: a procedural cafe racer that leans, dives and squats for
geometric reasons, with three presets whose differences (pro-dive vs anti-dive, linear vs rising rate) are visible.
**Depends on**: Phase 4
**Requirements**: MOTO-01, MOTO-02, MOTO-03, MOTO-04, MOTO-05
**Success Criteria**:
  1. V (or the toggle) swaps to the cafe racer on the same loop in one step; HUD, insights, overlays and cameras show two corners.
  2. In the brake zone the Classic fork compresses visibly more than the Telelever at the same deceleration; the Modern linkage shows a rising rate (motion ratio curve) in the overlay.
  3. The bike leans into corners with the correct sign and magnitude (closed form within 1°) and countersteers on turn-in.
  4. Attract mode includes the motorcycle beat when the feature is enabled.
**v1-critical**: MOTO-01, MOTO-02 (telescopic, swingarm, linkage), MOTO-03 Classic + Modern, MOTO-04, MOTO-05.
**Stretch**: Telelever preset (ship two presets if late), chain anti-squat line overlay, spoked wheels.
**Plans**: 3 plans

| Plan | Wave | Name | Owns | Depends | Acceptance / verify |
|---|---|---|---|---|---|
| 05-01 | 1 | Motorcycle simulation + content | `src/sim-core/moto/**`, `src/sim-core/content/cafe-racer.ts`, `src/sim-core/content/moto-*.ts`, `tests/sim-core/moto*.test.ts` | Phase 4 | per ARCHITECTURE §7.7: planar kit + LUT; 4-DOF ride; lean/steer; `createMotoModel` implements VehicleModel §7.2.4; tests: pro-dive (AD < 0) vs Telelever (AD > 0), rising-rate MR, trail formula, sag 25–40 %, bounce 2.0–2.8 Hz, braking pitch vs 08 §4.5 ±5 %, lean closed form ±1°; `createSimulation` runs the bike with golden hash; copy has no digits |
| 05-02 | 1 | Procedural cafe racer + moto suspension visuals | `src/features/motorcycle/visual/**`, `src/features/motorcycle/parts/**`, `tests/features/motorcycle-visual.test.ts`, `tests/fixtures/05-02-moto-frame.ts` | Phase 4 | Thruxton-style body from primitives (tube frame, extruded tank, seat hump, clip-ons, headlight, exhaust, lathe wheels/tyres), lean about the contact line, steering head rotation; `moto-planar` SuspensionVisual (RSU with gaiters vs USD gold stanchions, Telelever arm, twin shocks vs single-sided swingarm + monoshock + rocker/dog-bone) using `src/kit3d` and COMPONENT_COLORS; node tests with the fixture frame (no NaN, zero-alloc update) |
| 05-03 | 2 | Motorcycle integration | `src/features/motorcycle/index.ts`, `tests/e2e/05-03-motorcycle.spec.ts`, and (alone in its wave) adjustments under `src/features/{camera,attract,controls,telemetry-panel,insights,teaching-overlays}/**` | 05-01, 05-02 | `motorcycle` contributes vehicle, presets, both visuals; vehicle toggle works; bike camera framings (chase height, f/r close-ups on fork/swingarm); bike insights (fork dive + trail change, lean, squat); attract bike beat; e2e: lean sign at carousel (right turn → roll < 0), fork travel Classic > Telelever at brake-zone `t` |

### Phase 6: Cloudflare edge
**Goal**: The features only the edge makes possible: everyone on the same lap with a live crowd distribution,
a phone that drives the big screen, an audience poll, an AI Race Engineer grounded in live telemetry, and
anonymous analytics — all degrading gracefully offline.
**Depends on**: Phase 4 (phase 5 not required; if phase 5 is skipped, motorcycle ids are simply absent)
**Requirements**: EDGE-01, EDGE-02, EDGE-03, EDGE-04, AI-01, AI-02, AI-03, AI-04, OBS-01
**Success Criteria**:
  1. Two browsers on the live site show "2 watching", the distribution of their suspension picks, and the car at the same track position (lap-time difference < 0.15 s).
  2. `/?screen=1` shows a room code + QR; the phone remote (host) changes suspension/view/x-ray/slow-mo/section on the screen within 1 s.
  3. The host opens a poll; audience phones on `/r/<CODE>` vote; bars update on the screen; one vote per client.
  4. "Why did it do that?" returns a 1–3 sentence answer quoting only telemetry numbers, optionally highlighting a part or switching suspension; forced quota/error yields the labelled fallback.
  5. Analytics Engine receives anonymous events; all endpoints reject oversized/invalid input and rate-limit.
**v1-critical**: EDGE-01, EDGE-02, EDGE-04, AI-01..04. **Stretch**: EDGE-03 poll, OBS-01, in-world 3D poll bars.
**Plans**: 4 plans

| Plan | Wave | Name | Owns | Depends | Acceptance / verify |
|---|---|---|---|---|---|
| 06-01 | 1 | Room Durable Object + Live Lab | `worker/room.ts`, `worker/room-logic.ts`, `worker/routes/rooms.ts`, `worker/schemas/room.ts`, `src/features/live-lab/**`, `scripts/smoke-room.mjs`, `tests/worker/room*.test.ts`, `tests/e2e/06-01-live.spec.ts` | Phase 4 | DO per ARCHITECTURE §12.4; reducers unit-tested (presence, ctl seq, poll tally, rate bucket, host-key timing-safe compare); routes POST /api/rooms (RL_ROOMS), GET /ws/:code, GET /r/:code; `smoke-room.mjs` against `vite preview` and production (2 viewers, host ctl, vote; `--load 300`); live-lab: ROOM service, roles from flags, time sync → `clock.setOffset`, `pick` on sim events, presence chip + distribution bar, offline/e2e mode |
| 06-02 | 1 | AI Race Engineer | `worker/engineer/**`, `worker/routes/engineer.ts`, `worker/schemas/engineer.ts`, `src/features/engineer/**`, `tests/worker/engineer*.test.ts`, `tests/fixtures/06-02-*.json`, `tests/e2e/06-02-engineer.spec.ts` | Phase 4 | per §12.5: recorded real response fixture (task 1 spike), `model.ts` normaliser, `numbers.ts` check, fallback; route validation + rate limit + timeout + fallback model; facts cards (no numbers); client panel (question, "Why did it do that?" with 1 s telemetry ring buffer, event label from phenomenon + state, `x-client-id`), whitelisted action dispatcher (store, `highlight`, `camera:focus`, `sim:seek-to`), "fallback" badge; e2e with `page.route` mock + one live check at the phase gate |
| 06-03 | 1 | Anonymous analytics | `worker/routes/event.ts`, `worker/schemas/event.ts`, `src/features/analytics/**`, `tests/worker/event.test.ts`, `tests/features/analytics.test.ts` | Phase 4 | route validates `AnalyticsEvent` → `STATS.writeDataPoint` → 204 (missing binding → 204, no-op); client: suspension pick after 2 s dwell, view change, engineer asked, session after 60 s (fps, tier) via `sendBeacon`; respects DNT; off in e2e |
| 06-04 | 2 | Presenter remote + poll + remote page | `src/features/presenter/**`, `src/features/poll/**`, `src/remote/**`, `remote.html`, `tests/features/presenter.test.ts`, `tests/e2e/06-04-presenter.spec.ts` | 06-01 | screen: code + QR (`uqr`) with `#k=` fragment, applies `ctl` state (seq-ordered) to the store, cues → `camera:focus`/`sim:seek-to`; remote page (no three.js): host panel (vehicle, suspension, view, x-ray, slow-mo, amplification, section, attract, poll open/close) and audience vote panel, partysocket, mobile layout with `src/ui` tokens; poll bars on the screen HUD; e2e with two pages (screen + host) on `vite preview` |

### Phase 7: Polish, performance, event readiness
**Goal**: Prove the budgets on real hardware, harden delivery (CSP enforced, caching, version skew, offline-after-
load), finish accessibility, audit honesty and credits, and make the live-event setup boring and repeatable.
**Depends on**: Phase 6 (runs after phase 4 if phases 5–6 are cut)
**Requirements**: PERF-01, PERF-02 (render), PERF-03, PERF-04, DEP-03 (enforce CSP), DEP-04, A11Y-01, CRED-01 (audit), HON-03 (audit), DEMO-01
**Success Criteria**:
  1. Measured on real hardware and recorded: ≥ 60 fps at 1440p on a discrete GPU (`high`), ≥ 45 fps on an iGPU (`medium`); ≤ 250 draw calls; no frame > 50 ms on first swap / x-ray / vehicle switch.
  2. CSP enforced with zero violations across the e2e suite; hashed assets immutable; initial payload ≤ 12 MB.
  3. Keyboard-only and reduced-motion walkthroughs pass; contrast checks pass.
  4. The `?features=-<id>` matrix (every feature) boots clean; honesty and credits audits pass.
  5. Event runbook written; 300-socket room load test passes against production; final deploy green.
**v1-critical**: PERF-01..04, DEP-03, A11Y-01, DEMO-01, audits. **Stretch**: audio (engine loop + impacts), KTX2 textures, progressive LOD car.
**Plans**: 4 plans

| Plan | Wave | Name | Owns | Depends | Acceptance / verify |
|---|---|---|---|---|---|
| 07-01 | 1 | Render performance | `src/features/renderer/**`, `src/features/debug/**`, `tests/features/renderer-governor.test.ts`, `tests/e2e/07-01-perf.spec.ts` | Phase 6 | compile warm-up audit (all programs before reveal), governor tuning, shadow texel snapping, instancing/frustum audit, `renderer.info` budget assertions in e2e (calls ≤ 250, geometries/textures stable after 3 swaps), debug overlay (stats-gl GPU timing, feature list); checkpoint:human-verify with fps numbers on real hardware |
| 07-02 | 1 | Delivery hardening | `index.html`, `public/_headers`, `scripts/build-assets.mjs`, `src/kernel/**`, `tests/kernel/**`, `tests/e2e/07-02-delivery.spec.ts` | Phase 6 | CSP switched to enforce after e2e collects zero `securitypolicyviolation`; preload hints for car + HDRI; weighted loading progress from manifest bytes; `vite:preloadError` reload verified; payload budget check in build-assets; offline-after-load: solo experience continues with network cut (e2e `context.setOffline(true)`) |
| 07-03 | 1 | Accessibility, reduced motion, audio (stretch) | `src/ui/**`, `src/features/{controls,telemetry-panel,insights,credits,engineer,attract,camera}/**`, `src/features/audio/**`, `tests/e2e/07-03-a11y.spec.ts` | Phase 6 | keyboard-only walkthrough e2e, focus-visible, radiogroups, aria-live captions only, reduced-motion path (no fly-throughs/trails), contrast ≥ 4.5:1 measured; stretch: `audio` feature (engine loop pitch by speed, impact on bump-stop event, muted by default, M to toggle) |
| 07-04 | 2 | Event readiness + final verification | `tests/e2e/07-04-matrix.spec.ts`, `docs/EVENT-RUNBOOK.md`, `CREDITS.md`, `scripts/smoke-room.mjs` | 07-01, 07-02, 07-03 | feature-off matrix for every feature; suspension × view screenshot matrix; honesty audit (no digits in copy, amplification chip present whenever amp ≠ 1, grip labelled "model"); credits audit vs manifest; 300-socket load test on production; runbook (kiosk fullscreen, `?screen=1` + QR, offline fallback, Workers Paid decision, rollback); final deploy + production smoke; checkpoint:human-verify (premium look review) |

## Wave summary (all phases)
| Phase | Wave 1 | Wave 2 | Wave 3 |
|---|---|---|---|
| 1 | 01-01 | 01-02, 01-03 | 01-04 |
| 2 | 02-01, 02-02, 02-03 | 02-04 | — |
| 3 | 03-01, 03-02, 03-03, 03-04 | — | — |
| 4 | 04-01, 04-02, 04-03, 04-04 | — | — |
| 5 | 05-01, 05-02 | 05-03 | — |
| 6 | 06-01, 06-02, 06-03 | 06-04 | — |
| 7 | 07-01, 07-02, 07-03 | 07-04 | — |

## Progress
| Phase | Plans Complete | Status | Completed |
|---|---|---|---|
| 1. Walking skeleton (live) | 0/4 | Not started | - |
| 2. Simulation core | 0/4 | Not started | - |
| 3. World and car rendering | 0/4 | Not started | - |
| 4. Experience layer | 0/4 | Not started | - |
| 5. Motorcycle | 0/3 | Not started | - |
| 6. Cloudflare edge | 0/4 | Not started | - |
| 7. Polish, performance, event readiness | 0/4 | Not started | - |

---
*Roadmap created: 2026-11-20*
