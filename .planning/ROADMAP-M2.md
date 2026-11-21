# Roadmap — Milestone 2: Manual Drive

## Overview
Six phases (8–13), each ending deployed at https://suspension-lab.zh-a16.workers.dev. Phase 8 is a walking skeleton:
press a key, drive the SAME car on the existing loop, hand it back — live, before anything else. Phase 9 makes the
handling honest and validated (tyres, compliance, powertrain, aids, determinism, safety). Phase 10 adds the autopilot
hand-back and turns the test environment into a compact proving ground. Phase 11 adds the teaching layer (friction
rings, coach, replays, "same line, different suspension"). Phase 12 blends in Cloudflare (D1 replays, phone as
controller, Race Engineer for driving). Phase 13 makes it event-ready.
**Stop points:** after phase 8 the core promise is live; after phase 10 Manual Drive is a complete single-user product;
phases 11–13 add teaching depth, edge features and polish.

Binding references for every M2 executor: `.planning/EXECUTOR.md` (protocol — read "ROADMAP.md" there as this file and
"ARCHITECTURE.md" as ARCHITECTURE.md + ARCHITECTURE-M2.md), `.planning/ARCHITECTURE-M2.md` (contract addendum,
ownership, equations), `.planning/ARCHITECTURE.md` (M1 contract, still binding), `.planning/REQUIREMENTS-M2.md`,
`.planning/research/m2/SUMMARY.md` (decisions) and the research files each plan names.

### Conventions (as M1)
- **Wave**: plans of one wave run in parallel in one working tree; their owned file sets are disjoint. Waves run in order.
- **Owns**: the only files/globs the plan may create or edit. A feature folder is owned whole. Tests are owned by the
  plan that creates them. Frozen after 08-01: `src/contracts/**`, `src/app/features.ts`, `.dependency-cruiser.cjs`,
  `package.json`; after 12-01: `wrangler.jsonc`, `worker/index.ts`.
- **Verify** before the final commit of every plan: `npm run check` + the plan's extras; plans with visible output add
  their e2e spec, run on a PRIVATE build (`vite build --outDir <scratch>` + own `vite preview --port <n>`, then
  `PLAYWRIGHT_BASE_URL=… npx playwright test <spec> --trace off`, `?e2e=1&quality=low`) because parallel executors
  share `dist/` (M1 lesson). Every sim-core plan re-runs `tests/sim-core/golden.test.ts`: M1 goldens never change (R4).
- **Phase gate** (orchestrator, after the last wave): `npm run check && npm run build && npm run e2e && npm run deploy &&
  npm run smoke:live && PLAYWRIGHT_BASE_URL=https://suspension-lab.zh-a16.workers.dev npx playwright test
  tests/e2e/smoke.spec.ts`, plus the phase's human-verify checkpoint.
- **[S]** = stretch plan/task: may be cut at its gate (record in STATE.md Deferred Items); never a dependency of v1 work.

### Dependencies on M1 phase 7 (in progress in this tree — read-only for M2 planning)
M2 executors start only when phase 7 is complete and `npm run check` is green. M2 plans build on these phase-7 results:
- **07-02 (kernel, worker, contracts, CSP):** 08-01 rewrites kernel files and contract files AFTER 07-02's final versions.
  The C blocks in ARCHITECTURE-M2 §5 were derived from these files (SHA-256 prefixes at planning time):
  `app.ts 84409c273ab4`, `engineer.ts c9522663ae37`, `events.ts f6bc1fe30a60`, `net.ts 3fb1d7c0a9d8`,
  `services.ts 9d446353830e`, `sim.ts 90ac336c1dc1`, `store.ts 2d2e69dc1ba4`, `telemetry.ts be85da882b64`,
  `vehicle.ts 859cf5010cee` (unchanged by M2: `suspension.ts b5e16d6f64e1`, `track.ts e3327cfa8abe`,
  `units.ts 50d85e0064e7`); `src/app/features.ts f95c185ee5b5`, `wrangler.jsonc a69ed7a6806b`, `worker/index.ts
  86652866c350`. **08-01 and 12-01 first compare `sha256sum`; any difference = R4 stop** (the architect regenerates the
  affected blocks). The Limiter DO (`worker/limiter.ts`, 07-02) is reused by 12-01; protocol-v2 `auth` (07-02) is
  extended by 12-02.
- **07-01 (camera, attract, track, car, vehicle-view, renderer, environment):** 08-03 (attract), 08-04 (camera) and 10-03
  (track terrain) extend 07-01's final code; 11-04 relies on the db11 visual's x-ray ghost material.
- **07-03 (audio, controls, insights, telemetry-panel, engineer, ui, a11y):** 08-03 (controls), 09-05 (telemetry-panel),
  11-02 (audio, insights) and 12-03 (engineer) extend them; M2 UI keeps 07-03's a11y rules (focus rings, 44 px coarse
  targets, aria-live captions only, reduced motion). `tests/e2e/07-03-a11y.spec.ts` (uncommitted at planning time) must
  keep passing.
- **07-04 (matrix, runbook, CREDITS, smoke-room):** 13-01 extends the runbook and matrix; 12-02 extends smoke-room.

## Phases
- [ ] **Phase 8: Walking skeleton (live)** — contracts, kernel plumbing, manual plant v0, take the wheel, driving camera
- [ ] **Phase 9: Honest handling** — tyre + compliance, powertrain + aids, determinism sweep, integration + validation, handling HUD
- [ ] **Phase 10: Hand-back and the playground** — autopilot Returning, GroundWorld zones + annex, annex visuals, drive UX v2
- [ ] **Phase 11: Teaching layer** — friction rings + skid marks, events + coach + audio, replays, same line / different suspension
- [ ] **Phase 12: Cloudflare blend** — D1 replays + Turnstile, room driver role, engineer for driving, phone driver, shared replays [, crowd insight S, live ghosts S]
- [ ] **Phase 13: Event readiness** — matrix, audits, runbook, final deploy

## Phase Details

### Phase 8: Walking skeleton (live)
**Goal**: On the live site a visitor presses ↑ or W while the car laps, drives the same car on the existing loop
(accelerate, brake, steer, reverse, reset), and hands it back with Enter — with no visible jump on takeover and every M1
behaviour intact.
**Depends on**: M1 phase 7 complete and green.
**Requirements**: MD-01, MD-02, MD-03, MD-04 (keyboard), MD-05, MD-08, MD-09, MD-10, MD-11, MD-21 (keyboard), MD-22
(ramps, limit), MD-23, MD-24 (pill speed/gear).
**Success Criteria** (what must be TRUE):
  1. Live: ↑/W takes the wheel mid-lap without a jump (camera keeps swinging, body keeps rolling); the car accelerates
     through the gears, brakes, steers, reverses after holding ↓ at standstill; R puts it back on the line at rest;
     Enter hands back to the live lap behind a short fade (Returning arrives in phase 10).
  2. `npm run check` green; M1 goldens unchanged; `tests/sim-core/handoff.test.ts` passes the §7.10 A thresholds.
  3. The camera stays behind the driven car off the driving line and in reverse; director shots are refused while driving.
  4. Pressing 1/2/3 while driving swaps suspension without stopping the car; V releases with a cut.
  5. With the motorcycle the pill says "Auto only for this vehicle"; `?features=-drive` boots clean.
**Human verify (gate)**: drive two minutes with the keyboard on a real GPU: does it read as the same car, calm and
controllable?
**v1-critical**: all. **Stretch**: none.
**Plans**: 4

| Plan | Wave | Name | Owns (files_modified) | Depends | Acceptance / verify |
|---|---|---|---|---|---|
| 08-01 | 1 | M2 contracts, kernel drive plumbing, feature stubs | `src/contracts/**` (new `drive.ts`, `world.ts`; `sim.ts`, `telemetry.ts`, `vehicle.ts`, `store.ts`, `events.ts`, `app.ts`, `services.ts`, `net.ts`, `engineer.ts` verbatim from ARCH-M2 §C1–C11), `src/app/features.ts` (§F1), `src/features/{drive,proving-ground,tyre-vfx,coach,replay,ghost-lab,phone-drive,live-ghosts}/index.ts` (stubs), `src/kernel/{app,loop,sim-host,flags,registry,test-hooks}.ts`, `src/sim-core/drive/script.ts`, `src/sim-core/index.ts`, `.dependency-cruiser.cjs`, `worker/room-logic.ts`, `worker/schemas/event.ts`, `worker/routes/event.ts` (compile shims §5), `tests/arch/contracts-verbatim.test.ts` (§5.0 file verbatim), `tests/kernel/**`, `tests/worker/event.test.ts` | M1 done | SHA-256 pre-check (above); `npm run check` green on all three tsc programs + depcruise (sim-core may import drive/world); verbatim test: 14 contract files, 29 features; kernel tests with a fake sim + fake `drive` recording calls: `drive:request manual` → clock local, paused false, `request('manual')`; unavailable → warning, no call; `sim:seek-to` ignored outside auto; a `mode` drive event → `store.driveMode` + `drive:mode {cut}` + `acc = 0` on cut; `driveAids` change → `setAids`; flags `drive=manual`, `spawn=<id>` parsed, bad values warn; hooks `drive()`, `driveIntent()`, `driveHash()` JSON-safe; `runDriveScript` returns `'no-drive'` on the M1 sim and a stable hash with a fake drive; goldens unchanged; `?features=-<each new id>` boots (e2e smoke with `features=-drive,-coach…`) |
| 08-02 | 2 | Manual plant v0 on the loop (sim-core) | `src/sim-core/math/det.ts`, `src/sim-core/world/{terrain,project,ground}.ts`, `src/sim-core/drive/{types,human-driver,tyre,powertrain,plant,events,control}.ts`, `src/sim-core/car/car-model.ts`, `src/sim-core/ride/ride7dof.ts`, `src/sim-core/vehicle-models.ts`, `src/sim-core/simulation.ts`, `src/sim-core/content/{gt-coupe,gt-coupe-handling,gt-coupe-tyres,gt-coupe-powertrain}.ts`, `tests/sim-core/{det-math,world-ground,drive-plant,human-driver,handoff,plant-standstill}.test.ts`, `tests/arch/{det-math,no-type-tuning}.test.ts`, `tests/fixtures/08-02-*` | 08-01 | Research: m2/03, 04, 06, 07 §1, 09 §3–5, 12, 24 §a. ARCH-M2 §7.1–7.4, 7.7 (v0), 7.9 HumanDriver (no countersteer help yet), 7.10 A/D/E, 7.12, 8.1 (loop + terrain only). M1 goldens + every M1 sim-core test unchanged; det kernels ≤ 1 ulp vs `Math.*` on 10⁵-point grids incl. edge cases (±0, ±π/2, large args ≤ 2²⁰, NaN, ±Inf); `det-math` + `no-type-tuning` arch tests green on drive/, world/, det.ts; projection vs brute force on 20 000 random points within 18 m: abs(Δs) < 0.05 m, warm start ≤ 6 iterations; `GroundWorld.sample` on the corridor = `roadHeight` (1e-12) and surfaces by band; `terrainHeight` = `features/track/terrain.ts` `groundHeight` at 1 000 points (1e-9); handoff H1 at 20 lap times; scripted 60 s drive finite; full throttle 10 s from rest reaches 15–35 m/s, gears go up; manual suspension swap keeps pose/velocities (≤ one step's change); `request('auto')` = immediate release until 10-01 (comment `shortcut:`); no-alloc tripwire on the plant step; plant step cost printed; Auto frame fills the new CornerFrame/DriveFrame fields (§7.3 (4)) |
| 08-03 | 3 | Take the wheel (drive feature v1) | `src/features/drive/**`, `src/features/controls/**`, `src/features/attract/**`, `tests/features/{drive,controls,attract}.test.ts`, `tests/e2e/08-03-drive.spec.ts` | 08-02 | Research: m2/07, 22. ARCH-M2 §9, §10.1–10.2 (keyboard only; Enter emits `drive:request {mode:'auto', immediate:true}` in this phase), DRIVE service with the keyboard source. Unit: code→intent table, fresh-press takeover, neutral-before-retake rule, held set cleared on blur, idle cue timing (pure), controls `keyAction` returns null for a/s/w/d outside auto, attract never starts outside auto. e2e (`?e2e=1&quality=low&paused=1`): ArrowUp → `__app.drive().mode === 'manual'`; hold ArrowUp + `advance(3)` → speed > 8 m/s; ArrowLeft → yaw increases; stop + hold ArrowDown + `advance(2)` → u < 0; R → at rest near the line; Enter → mode auto; `?vehicle=cafe-racer` pill text; zero console errors; pill screenshot to the SUMMARY |
| 08-04 | 3 | Manual chase camera | `src/features/camera/**`, `tests/features/camera.test.ts`, `tests/e2e/08-04-camera.spec.ts` | 08-02 | Research: m2/08 (icurtis1 MIT constants). ARCH-M2 §10.3. Pure tests: manual target (slip window, lead clamp, reverse = heading-based), 0.8 s blend weight, hard cut on `cut`/reset/15 m jump, frame-rate independence (30/60/144 fps same pose ±1 cm after 2 s), ground clearance from `world.sample`; director shot refused outside auto. e2e: manual with held steer for 2 s → camera behind the car (angle between camera→car and heading < 25°); reverse 2 s → still behind; explore/close-up still work in manual |

Task outline: 08-01: (1) contracts + features.ts + stubs + depcruise + verbatim test + compile shims; (2) kernel
(sim-host, loop mirror, flags, catalog world, hooks) + `drive/script.ts` + tests. 08-02: (1) det kernels + world
(terrain move, projection, ground) + tests; (2) tyre v0, powertrain v0, human driver, plant, control, simulation/car-model
wiring + handoff/standstill tests; (3) Auto field fill + golden/no-alloc/cost. 08-03: (1) DRIVE service + keyboard +
pill/hint/idle; (2) controls/attract gating + e2e. 08-04: (1) provider + blend + tests; (2) e2e.

### Phase 9: Honest handling
**Goal**: The driven car is physically grounded and honest: full tyre model with camber/toe and relaxation, compliance
from the hardpoints with one shared bushing table, automatic powertrain and labelled aids, jacking, safety nets, a
deterministic sim-core, and a validation suite whose bands pass — with the per-suspension report showing small,
computed differences and no universal winner.
**Depends on**: Phase 8.
**Requirements**: MD-12, MD-13, MD-14, MD-15, MD-16, MD-17, MD-18, MD-19, MD-20, MD-22 (countersteer help), MD-24, MD-60.
**Success Criteria**:
  1. `tests/sim-core/handling-*.test.ts` pass every band of ARCH-M2 §11 (T1–T8, T11–T18, T20, S1–S3); the no-universal-
     winner table is printed and copied into the 09-04 SUMMARY.
  2. `tests/arch/det-math.test.ts` covers all of `src/sim-core`; `tests/e2e/09-03-determinism.spec.ts` shows the Node and
     Chromium drive hashes equal; M1 goldens unchanged.
  3. The compliance report (3 types × 2 axles, ±2× band) is in the 09-01 SUMMARY and every gate holds or is reported.
  4. Live: aids toggles and lamps work; the "approximate" badge appears in a hard slide; a 5 % slope hold has no creep.
**Human verify (gate)**: same course with each suspension and aids on/off: differences subtle and plausible, nothing
exaggerated, keyboard still approachable.
**v1-critical**: all.
**Plans**: 5

| Plan | Wave | Name | Owns | Depends | Acceptance / verify |
|---|---|---|---|---|---|
| 09-01 | 1 | Tyre model and compliance derivation | `src/sim-core/drive/tyre.ts`, `src/sim-core/drive/compliance.ts`, `src/sim-core/content/gt-coupe-tyres.ts`, `tests/sim-core/{tyre,compliance}.test.ts`, `tests/fixtures/09-01-*` | Phase 8 | Research: m2/04, 05, 12 §3, 23; Chrono BSD-3 ideas. ARCH-M2 §7.4 full body (signature frozen), §7.5 derivation. Y1: sign checks (slide left → Fy < 0, driving κ → Fx > 0, ε > 0 → thrust left), camber and toe sweeps monotone, Cα(N) shape and μ(N) from `peakMu`, friction circle never exceeded, steady-state relaxation (uy = σ·vy/abs(vx)) and step lag ≈ σ/v ±10 %, continuity through v = 0, low-speed damping bounded (impulse limit). C1: properties (halving rates doubles coefficients; ×1000 → ≈ 0; left/right mirror), gates, printed report incl. ±2× band; shape parameters only within §7.4 bands |
| 09-02 | 1 | Powertrain, brakes and aids | `src/sim-core/drive/powertrain.ts`, `src/sim-core/drive/aids.ts`, `src/sim-core/content/gt-coupe-powertrain.ts`, `tests/sim-core/{powertrain,aids}.test.ts` | Phase 8 | Research: m2/06 (Jolt MIT, GEVP MIT shapes). ARCH-M2 §7.7, §7.8. P1 with fake io: upshift at light vs full throttle as specified, no hunting on a slow speed ramp, kick-down, shift cut/ramp timing, LSD split = Jolt formula, engine-braking torque at 4000 rpm = a + b·rpm, reverse cap and throttle scale, no creep at zero throttle; ABS keeps κ ≥ −0.2 on a fake wheel with a saturating tyre; TCS scale curve; stability: oversteer → outer front, understeer → inner rear, signs mirrored left/right; aids off → identity |
| 09-03 | 1 | Determinism sweep and cross-engine hash | `src/sim-core/{track,kinematics,path,moto}/**`, `src/sim-core/math/{interp,mat,quat,rng,vec3,linsolve}.ts`, `src/sim-core/ride/tyre.ts`, `src/sim-core/content/{proving-loop,susp-macpherson,susp-double-wishbone,susp-multilink,cafe-racer,moto-classic,moto-modern,moto-telelever,gt-geometry}.ts`, `tests/arch/det-math.test.ts`, `tests/e2e/09-03-determinism.spec.ts` | Phase 8 | Research: m2/12 §6, 24 §a. ARCH-M2 §7.12. Replace every transcendental `Math.*`, `Math.hypot` and non-integer `**` in the owned files with det kernels / explicit multiplies; widen `det-math.test.ts` to all of sim-core EXCEPT `car/car-model.ts`, `ride/ride7dof.ts` (09-04 owns them this phase and widens the test again); ALL M1 goldens (car and moto) and kinematics references unchanged — any change: STOP (R4) with the diff; e2e spec computes `runDriveScript(sim, 7, 60)` in the Playwright Node process (imports sim-core) and compares with `page.evaluate(() => __app.driveHash(7, 60))` on Chromium: equal. Record "Firefox/WebKit not installed" in the SUMMARY |
| 09-04 | 2 | Plant integration, safety and validation | `src/sim-core/drive/{plant,human-driver,control,types}.ts`, `src/sim-core/car/car-model.ts`, `src/sim-core/ride/ride7dof.ts`, `src/sim-core/simulation.ts`, `src/sim-core/vehicle-models.ts`, `tests/arch/det-math.test.ts`, `tests/sim-core/handling-*.test.ts`, `tests/sim-core/plant-*.test.ts`, `tests/sim-core/handoff.test.ts`, `tests/fixtures/09-04-*` | 09-01, 09-02, 09-03 | Research: m2/03 §4–7, 05, 12, 20, 23. ARCH-M2 §7.2 full order, §7.3 (linkVertical), §7.5 runtime, §7.6, §7.8, §7.9 (countersteer help), §7.10, §11. Det sweep of car-model/ride7dof (goldens unchanged) and det-math test widened to ALL sim-core; T1–T8, T11–T18, T20, S1–S3, H1, N1 per §11 (test-only plant options: linear tyre, rigid loads); linkVertical = M1 pair to 1e-9 in the symmetric case; compliance off reproduces the kinematics-only plant bit-for-bit; NaN containment restores and counts; 5 % slope with brake: < 1 mm in 10 s; printed per-suspension report (roll gradient, K, skidpad, 100–0, ride-street RMS) in the SUMMARY; plant step median ≤ 25 µs |
| 09-05 | 2 | Handling HUD: aids, lamps, approximate badge | `src/features/drive/**`, `src/features/telemetry-panel/**`, `tests/features/{drive,telemetry-panel}.test.ts`, `tests/e2e/09-05-hud.spec.ts` | 09-01, 09-02 (contracts already frozen) | ARCH-M2 §10.2, §10.5, §13. Aids popover (four toggles, "Assist: simplified model") writes `store.driveAids`; lamps from `frame.drive` flags (text + icon, never colour alone); "approximate" badge from `frame.drive.approximate`; telemetry history records only in auto; e2e: toggle ABS off → `__app.state().driveAids.abs === false`; scripted hard stop via `__app.driveIntent` shows the ABS lamp; badge visible during a forced slide; 07-03 a11y walk still passes |

Task outline: 09-01: (1) tyre body + tests; (2) compliance derivation + report. 09-02: (1) powertrain + tests; (2) aids +
tests. 09-03: (1) sweep track/path/math/ride-tyre + goldens; (2) kinematics/moto/content + goldens; (3) e2e hash. 09-04:
(1) tyre/powertrain/aids/compliance/jacking integration; (2) safety + sleep + countersteer help; (3) validation suite +
report. 09-05: (1) aids UI + lamps + badge; (2) telemetry rule + e2e.

### Phase 10: Hand-back and the playground
**Goal**: Handing back is smooth (the autopilot drives the same plant back to the line, then latches to the rails;
rejoining the live lap is an explicit, faded cut), and the existing test environment becomes a compact proving ground
with stations reached by spurs — all on one GroundWorld for physics and pictures; gamepad and touch join the keyboard.
**Depends on**: Phase 9.
**Requirements**: MD-04 (gamepad/touch), MD-06, MD-07, MD-21, MD-30, MD-31, MD-32, MD-33, MD-34, MD-35.
**Success Criteria**:
  1. Enter while driving shows RETURNING; the car drives itself back onto the line and the pill turns AUTO without a jump;
     "Off the live lap · Rejoin" re-syncs behind a fade; idle hand-back works (cue at 9 s, return at 12 s).
  2. Both spurs lead to the annex; the ride street, steering circle, slalom, ISO 3888-2 lane and braking platform are
     drawn exactly where the physics puts them (node test ≤ 1 mm) and drivable; leaving the region fades and resets.
  3. `?spawn=steering-pad&drive=manual` starts at rest on the circle; the stations list works.
  4. A standard gamepad and touch controls drive the car; `?features=-proving-ground` removes the annex cleanly.
  5. Draw calls ≤ 250 at `high` with the annex in view.
**Human verify (gate)**: tour every station with keyboard and gamepad; does each station make a visible point?
**v1-critical**: all; wet look on the platform is v1 but may degrade to plain darker asphalt.
**Plans**: 4

| Plan | Wave | Name | Owns | Depends | Acceptance / verify |
|---|---|---|---|---|---|
| 10-01 | 1 | Autopilot in the plant: Returning and latch | `src/sim-core/drive/{reference,path-driver,control}.ts`, `src/sim-core/simulation.ts`, `tests/sim-core/{path-driver,returning,continuity}.test.ts` | Phase 9 | Research: m2/09 (PythonRobotics MIT), 20 (T9). ARCH-M2 §7.9 PathDriver, §7.10 B/C/D, §11 T9/H2/H3. Projection-based reference with lineOffset knots; T9 ISO 3888-1 at 80 km/h inside the gates; H2 500 seeded starts latch ≤ 20 s within a 30 m corridor, 50 off-loop starts ≤ 60 s (fake world zone OK until 10-02 lands), no NaN; H3 continuity of character; latch emits `converged` + `mode {cut:false}`; timeouts release with a cut; `request('auto')` now = Returning, `immediate` = D |
| 10-02 | 1 | GroundWorld zones and proving-ground content | `src/sim-core/world/{zones,ground}.ts`, `src/sim-core/content/proving-ground.ts`, `tests/sim-core/{world-zones,proving-ground}.test.ts`, `tests/arch/world-copy.test.ts` | Phase 9 | Research: m2/11. ARCH-M2 §8 (all coordinates). Spur ends within 1 cm / 0.01° of §8.3; zone priority, 0.5 m edge blends (no height step > 2 cm over 0.1 m anywhere on a 0.25 m grid over the field), patches (split-μ lanes), roughness seeded from the world id, `inBounds` and margins, field flattening + skirts in `terrainHeight`; every station spawn on asphalt and ≥ 10 m inside its zone; annex clearance from the loop centreline ≥ 40 m except the spur corridors; world copy without digits (`world-copy.test.ts`); a plant drive across each spur has no NaN and no road-input step > 3 cm |
| 10-03 | 2 | Proving-ground visuals; terrain from GroundWorld | `src/features/proving-ground/**`, `src/features/track/**`, `tests/features/{proving-ground,track}.test.ts`, `tests/e2e/10-03-ground.spec.ts` | 10-02 | ARCH-M2 §8.4. `proving-ground` contributes the world (`registries.worlds`) and draws zones, markings (circle, lane lines, gate cones), instanced cones, signs, wet patches; `track` builds terrain from `sim.current.world.terrainHeight` (its local `terrain.ts` copy removed; sim-core's `world/terrain.ts` is the single source). Node: rendered vertex heights = GroundWorld ±1 mm; terrain unchanged without a world (vertex equality vs the M1 build); ≤ 25 draws for the annex, total ≤ 250 at `high`; e2e screenshots of five stations (to SUMMARY); `?features=-proving-ground` boots and hides everything |
| 10-04 | 2 | Drive UX v2: Returning UI, stations, gamepad, touch, rumble | `src/features/drive/**`, `tests/features/drive*.test.ts`, `tests/sim-core/proving-ground-manoeuvres.test.ts`, `tests/e2e/10-04-drive.spec.ts` | 10-01, 10-02 | Research: m2/07 §2–4, 18 (rumble), 22. ARCH-M2 §10.1–10.4. Enter → Returning (non-immediate), "Rejoin" chip → immediate; idle cue/return (×2.5 on `?screen=1`); stations list + `?spawn`; out-of-bounds fade + reset; gamepad adapter (fake `navigator.getGamepads` via `page.addInitScript` in e2e), touch slider + pads (coarse-pointer emulation 1024×768), rumble feature-detected + toggle; T10 ISO 3888-2 per suspension with PathDriver (max pass speed table printed); e2e: Returning → AUTO latch via `advance`, spawn, gamepad steer sign, touch drive, reduced-motion fade = cut |

Task outline: 10-01: (1) reference + PathDriver + recovery; (2) control/simulation Returning + latch + tests. 10-02: (1)
zones + ground composition; (2) content + tests. 10-03: (1) zone meshes + materials; (2) props/signs/markings + terrain
switch + tests/e2e. 10-04: (1) Returning/rejoin/idle/stations/OOB; (2) gamepad + touch + rumble; (3) T10 + e2e.

### Phase 11: Teaching layer
**Goal**: The car teaches while you drive and right after: friction rings and skid marks show grip; a quiet coach names
what happened; a moment replay shows it again slowly; "same line, different suspension" shows what the other
suspension would have done on the visitor's own line with a disclosed autopilot.
**Depends on**: Phase 10.
**Requirements**: MD-40, MD-41, MD-42, MD-43, MD-44, MD-45, MD-50, MD-61.
**Success Criteria**:
  1. Rings grow on the loaded tyres and warm to the accent only past the limit; skid marks appear only then.
  2. A lift-off slide on the steering pad produces one coach line, a Q replay at quarter speed that ends exactly where it
     started, and a share link that replays the run on another tab.
  3. G after ≥ 5 s of driving shows the ghost car with the other suspension on the visitor's line and the A/B traces with
     the disclosure caption.
  4. Engine and tyre audio follow rpm and grip use (when unmuted); M1 insights stay quiet while driving.
**Human verify (gate)**: does the A/B comparison make the suspension point without exaggeration?
**v1-critical**: rings, coach, recorder + moment replay + fragment share, A/B traces. **Stretch**: skid marks, 3D ghost
car (traces remain), audio extension.
**Plans**: 4

| Plan | Wave | Name | Owns | Depends | Acceptance / verify |
|---|---|---|---|---|---|
| 11-01 | 1 | Tyre VFX: friction rings and skid marks | `src/features/tyre-vfx/**`, `tests/features/tyre-vfx.test.ts`, `tests/e2e/11-01-vfx.spec.ts` | Phase 10 | Research: m2/13, 19 (folio-2025 MIT pattern). ARCH-M2 §10.5. Pure: ring radius/dot mapping from CornerFrame (fx, fy, capacity), colour threshold, 2-corner frame (bike) renders nothing; ribbon ring buffer (no per-frame allocation, reset on `cut`); ≤ 1 + 4 draw calls; label "model"; its own "Grip rings" chip in the action row (ARCH-M2 §10.2), on by default outside auto; e2e screenshots in a scripted slide (`driveIntent`) |
| 11-02 | 1 | Drive events, coach, audio | `src/sim-core/drive/events.ts`, `src/features/coach/**`, `src/features/insights/**`, `src/features/audio/**`, `tests/sim-core/drive-events.test.ts`, `tests/features/{coach,insights,audio}.test.ts`, `tests/e2e/11-02-coach.spec.ts` | Phase 10 | Research: m2/13, 15 §3, 18. ARCH-M2 §7.11, §10.5. Detectors on scripted plant runs: lift-off slide (rear) fires with `lift`, understeer push fires `front`, lock-up only with ABS off, wheelspin only with TCS off, hysteresis; coach templates without digits, ≤ 1 per 12 s, max 3 per kind, station card on zone entry; insights quiet outside auto; audio mix pure functions bounded and finite (engine from `engineRpm`/throttle outside auto, tyre cue from max gripUse ≥ 0.75), still muted by default |
| 11-03 | 1 | Replays: recorder, format, share link, moment replay | `src/sim-core/replay/**`, `src/sim-core/drive/control.ts`, `src/sim-core/simulation.ts`, `src/features/replay/**`, `tests/sim-core/{replay,replay-golden}.test.ts`, `tests/features/replay.test.ts`, `tests/e2e/11-03-replay.spec.ts` | Phase 10 | Research: m2/24 §b–c, 15 §1. ARCH-M2 §7.10 F/G, §7.13. Encode/decode round trip, CRC, keyframes every 1 200 ticks with snapshots in memory; replay re-simulates bit-identically (same build); takeover during replay → manual (branching); end → manual at the exact pre-replay state (moment replay); `#r=` fragment ≤ 60 s (deflate-raw + base64url, fallback encoder tested); mismatched vehicle refused, older `SIM_VERSION` labelled; replay golden fixes `SIM_VERSION`; e2e: record 10 s, open the generated link in a new page, final `__app.drive()` state equal |
| 11-04 | 2 | Same line, different suspension (A/B ghost) | `src/sim-core/ghost/**`, `src/features/ghost-lab/**`, `tests/sim-core/ghost.test.ts`, `tests/features/ghost-lab.test.ts`, `tests/e2e/11-04-ghost.spec.ts` | 11-03 | Research: m2/24 §d, 13 §3. ARCH-M2 §7.14, §13.3. `replayLine` from a recording window; A/A traces identical (control); B differs only through tables (identical-tables control = identical); ghost in lockstep with the replay; x-ray ghost shell ≤ 40 draws (else traces only, documented); strip chart (steer, front/rear slip, roll vs line distance) with the disclosure caption; G/pill chip; returns to manual at the end |

Task outline: 11-01: (1) rings; (2) ribbons + toggle + e2e. 11-02: (1) detectors; (2) coach + insights gate; (3) audio.
11-03: (1) format + recorder; (2) control/simulation replay mode; (3) feature: moment replay + share link + e2e.
11-04: (1) ghost runs + traces; (2) ghost car + strip chart + e2e.

### Phase 12: Cloudflare blend
**Goal**: Cloudflare does what only the edge can: longer runs are shared through D1 behind Turnstile and the global
Limiter; a phone becomes the steering wheel of the big screen through the room Durable Object; the Race Engineer explains
driving events from sim-core facts; anonymous analytics count drive sessions.
**Depends on**: Phase 11 (12-02/12-03 only need phase 8 contracts; scheduled here to keep phase 8–11 focused).
**Requirements**: MD-51, MD-52, MD-53, MD-54, MD-55 [S], MD-56 [S].
**Success Criteria**:
  1. A 2-minute run saves to D1 and opens on another device through `#rid=`; a bad token is 403, a burst is 429; expired
     rows disappear on later writes.
  2. On `?screen=1` the driver QR pairs a phone; the phone drives the screen's car (touch by default, tilt optional);
     audience phones receive no input frames; pulling the phone's network returns the car to Auto within ~1 s with a banner.
  3. "Why did it do that?" after a lift-off slide answers about that slide using only telemetry numbers, or the labelled
     rule answer.
  4. Analytics Engine receives `drive-session` and `station-visit` points.
**Human verify (gate)**: phone driving on the venue-like network (cellular hotspot); measure `sync` RTT and frame age p50/p95.
**v1-critical**: 12-01, 12-02, 12-03, 12-04, 12-05. **Stretch**: 12-06, 12-07.
**Plans**: 7 (2 stretch)

| Plan | Wave | Name | Owns | Depends | Acceptance / verify |
|---|---|---|---|---|---|
| 12-01 | 1 | Replays on D1 + Turnstile; worker frozen files | `wrangler.jsonc` (§W1), `worker/index.ts` (§W2), `worker-configuration.d.ts`, `worker/secrets.d.ts`, `worker/routes/replays.ts`, `worker/routes/insight.ts` (501 stub), `worker/schemas/replay.ts`, `worker/migrations/0001_replays.sql`, `public/_headers`, `tests/worker/replays.test.ts`, `tests/arch/contracts-verbatim.test.ts` (`M2_KINDS = 'CFW'`), `.planning/ARCHITECTURE-M2.md` (W1 `database_id` only) | Phase 11 (format 11-03) | Research: m2/15 §1, 21. ARCH-M2 §12.1, §W1–W2. SHA-256 pre-check of `wrangler.jsonc`/`worker/index.ts`; `wrangler d1 create` + real id in both places; migrations local/remote; Hono `app.request` tests with fake D1/Limiter/fetch: 201 + id, dedupe by sha256, 400 bad/oversized/undecodable, 413, 403 Turnstile fail, 503 not_configured / daily cap, 429 burst, purge-on-write, GET 200/404/expired; CSP adds Turnstile (07-02's zero-violation e2e still green); deploy + live `curl` checks; secret set by the orchestrator (or `not_configured` recorded) |
| 12-02 | 1 | Room driver role | `worker/room.ts`, `worker/room-logic.ts`, `worker/schemas/room.ts`, `worker/routes/rooms.ts`, `scripts/smoke-room.mjs`, `tests/worker/room*.test.ts` | Phase 8 contracts | Research: m2/17 §5, 14, 21. ARCH-M2 §12.2. Reducer tests: driver pending → auth with driverKey (timing-safe) → welcome; wrong key 4401; newer driver closes older 4409; `in` relayed only to screens with `r`, never to audience/viewers; `tel` only screen → driver; per-role buckets (90/s burst 30 for drivers), 128 B cap → 1009; presence `drivers`; rooms route returns `driverKey`; smoke-room driver scenario locally and on production (≥ 140 of 150 frames delivered, audience 0) |
| 12-03 | 1 | Race Engineer for driving + drive analytics | `worker/engineer/**`, `worker/routes/engineer.ts`, `worker/schemas/engineer.ts`, `worker/routes/event.ts`, `worker/schemas/event.ts`, `src/features/engineer/**`, `src/features/analytics/**`, `tests/worker/engineer*.test.ts`, `tests/worker/event.test.ts`, `tests/features/analytics.test.ts`, `tests/fixtures/12-03-*`, `tests/e2e/12-03-engineer.spec.ts` | Phase 11 (detectors 11-02) | Research: m2/15 §3, 21 (model list). ARCH-M2 §12.4–12.5. Schema accepts/rejects the `drive` block; driving fact cards pinned to sim-computed orderings where they claim one; number check covers drive numbers; fallback sentence per event kind; one recorded real model answer for a lift-off event (fixture) parsed; client builds the block from `frame.drive` + last `drive:event`, skips seek actions outside auto; analytics `drive-session`/`station-visit` (DNT, off in e2e); e2e with `page.route` mock |
| 12-04 | 2 | Phone driver | `src/remote/**`, `remote.html`, `src/features/phone-drive/**`, `src/features/live-lab/**`, `tests/features/{phone-drive,live-lab-driver}.test.ts`, `tests/e2e/12-04-phone.spec.ts` | 12-02 | Research: m2/17. ARCH-M2 §12.3. live-lab exposes `driverKey` from `CreateRoomResponse`; phone-drive (screen only): driver QR card, `'phone'` source via DRIVE, one-packet interpolation, 250 ms decay / 1 s Returning failsafe + banner, link badge, `tel` 5 Hz; remote driver panel: touch default, tilt with permission flow + 2-tap calibration + One-Euro filter, wake lock, 30 Hz + edge frames, `bufferedAmount` skip; pure tests for tilt angle maths, filter, failsafe timeline; e2e two pages (screen + phone) on a private `vite preview` (workerd): phone touch input moves the screen car; closing the phone page → Returning within 1.5 s |
| 12-05 | 2 | Server-shared replays (client) | `src/features/replay/**`, `tests/features/replay.test.ts`, `tests/e2e/12-05-share.spec.ts` | 12-01 | ARCH-M2 §12.1. Runs > 60 s (or always, via a "Save link" chip) → Turnstile widget (site key in `turnstile.ts`; test key in e2e) → POST → `#rid=` link with copy-to-clipboard; opening `#rid=` fetches and plays; errors shown calmly (cap, busy, not configured → offer fragment link when it fits); e2e with `page.route` mocks |
| 12-06 | 2 | [S] Crowd insight per station | `worker/routes/insight.ts`, `src/features/coach/**`, `tests/worker/insight.test.ts`, `tests/features/coach.test.ts` | 12-01, 12-03 | Research: m2/15 §5. ARCH-M2 §12.5. AE SQL with `AE_SQL_TOKEN`, weighted buckets, min-n 30, Cache API 10 min; coach station card line labelled "how visitors drove this model"; absent token → 501 and nothing shown |
| 12-07 | 2 | [S] Live ghosts of other visitors | `worker/room.ts`, `worker/room-logic.ts`, `worker/schemas/room.ts`, `src/features/live-ghosts/**`, `tests/worker/room-ghosts.test.ts`, `tests/features/live-ghosts.test.ts` | 12-02 | Research: m2/14 §5–8, 21. ARCH-M2 §12.5. `gst` ≤ 10 Hz per viewer, 100 ms aggregated `gsts` with nearest-24 interest, interval stops after 10 s idle; client 250 ms interpolation buffer, fade when stale, translucent shells instanced, no collisions/names/ranking; off by default (`defaultEnabled: false`) |

Task outline: 12-01: (1) D1 + migration + route + tests; (2) wrangler/index/headers + verbatim test + deploy.
12-02: (1) reducers + schemas; (2) DO glue + smoke. 12-03: (1) worker cards/prompt/numbers/fallback; (2) client block +
analytics + e2e. 12-04: (1) live-lab key + phone-drive screen side; (2) remote driver panel; (3) e2e.

### Phase 13: Event readiness
**Goal**: Manual Drive is boring to run at a booth: every feature can be switched off cleanly, budgets hold, copy and
credits are audited, the runbook covers the new flows, and production is verified.
**Depends on**: Phase 12.
**Requirements**: MD-20 (render budget), MD-60, MD-61, MD-62, MD-70.
**Success Criteria**:
  1. `?features=-<id>` matrix green for all 29 features; zero console errors in Manual on every station.
  2. Copy audit (no digits) and credits audit (every lifted source in CREDITS.md and the panel) pass.
  3. Runbook: booth Manual Drive (idle return, `?screen=1` timings, phone driver pairing, offline fallback with the
     network cut, Workers Paid decision, rollback).
  4. Measured on real hardware and recorded: ≥ 60 fps at 1440p (`high`, discrete GPU) driving across the annex with rings
     on; ≤ 250 draw calls.
**Plans**: 1

| Plan | Wave | Name | Owns | Depends | Acceptance / verify |
|---|---|---|---|---|---|
| 13-01 | 1 | Matrix, audits, runbook, final deploy | `tests/e2e/13-01-matrix.spec.ts`, `tests/arch/content-copy.test.ts`, `docs/EVENT-RUNBOOK.md`, `CREDITS.md`, `src/features/credits/**`, `tests/features/credits.test.ts` | 12-01…12-05 | Feature-off matrix incl. M2 features; content-copy extended to world, coach templates, pill and caption strings; CREDITS + `code-credits.ts` list stdlib-js (Apache-2.0 + Sun notice), Jolt, PythonRobotics, icurtis1, folio-2025, GEVP if lifted, with exact notices; runbook sections; final deploy + production smoke + checkpoint:human-verify (performance numbers, premium look while driving) |

## Wave summary
| Phase | Wave 1 | Wave 2 | Wave 3 |
|---|---|---|---|
| 8 | 08-01 | 08-02 | 08-03, 08-04 |
| 9 | 09-01, 09-02, 09-03 | 09-04, 09-05 | — |
| 10 | 10-01, 10-02 | 10-03, 10-04 | — |
| 11 | 11-01, 11-02, 11-03 | 11-04 | — |
| 12 | 12-01, 12-02, 12-03 | 12-04, 12-05, 12-06 [S], 12-07 [S] | — |
| 13 | 13-01 | — | — |

Ownership cross-check (same wave, disjoint): W1 of phase 9 — 09-01 owns `drive/{tyre,compliance}.ts` + tyres content,
09-02 `drive/{powertrain,aids}.ts` + powertrain content, 09-03 the M1 sim-core folders (not `car/`, `ride/ride7dof.ts`,
`drive/`, `world/`); W2 — 09-04 sim-core plant files + `tests/arch/det-math.test.ts` (09-03's file, next wave),
09-05 features only. Phase 11 W1 — 11-02 `drive/events.ts`, 11-03 `drive/control.ts` + `simulation.ts` + `replay/`.
Phase 12 W1 — 12-01 replays/insight/index/wrangler, 12-02 room files, 12-03 engineer + event files; W2 — 12-04
remote/phone-drive/live-lab, 12-05 replay feature, 12-06 insight route + coach, 12-07 room files (12-02 was W1).

## Progress
| Phase | Plans Complete | Status | Completed |
|---|---|---|---|
| 8. Walking skeleton (live) | 0/4 | Not started | - |
| 9. Honest handling | 0/5 | Not started | - |
| 10. Hand-back and the playground | 0/4 | Not started | - |
| 11. Teaching layer | 0/4 | Not started | - |
| 12. Cloudflare blend | 0/7 | Not started | - |
| 13. Event readiness | 0/1 | Not started | - |

---
*Roadmap M2 created: 2026-11-21*
