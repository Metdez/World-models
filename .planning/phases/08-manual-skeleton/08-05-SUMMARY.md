# 08-05 SUMMARY — phase-8 gate fixes

## 1. Camera e2e (`tests/e2e/08-04-camera.spec.ts`)
- **Cause: the spec, not the camera and not `__app.driveIntent`.** The test intent reaches the same HumanDriver
  reverse logic as the keyboard (brake > 0.3, throttle < 0.05, |u| < 0.5 m/s held 0.25 s). With the fixed spec
  the car reverses at u = −7.0 m/s. The original spec failed for two reasons:
  - **Idle hand-back.** The test intent is not a device source, so the drive feature's idle timer (12 s of
    wall-clock render time without input) handed the car back to Auto during the slow SwiftShader waits.
    u = 14.4 m/s is an Auto speed.
  - **Speed overshoot.** Fixed pedals overshot under SwiftShader (each frame is a 0.1 s sim step). The car hit
    22–25 m/s before steering 0.5, so the "corner" became a spin onto the grass. In my reproduction of the old
    spec, still in Manual after 30 braking frames, it was sliding sideways at u = −0.06, |v| ≈ 4.9 m/s, so
    reverse could not start before the hand-back.
- **Fix:**
  - The spec dispatches a synthetic `pointerdown` every second (a visitor at the booth).
  - A per-frame P cruise holds 12 m/s, straight and with steer 0.3.
  - Every phase asserts `mode === 'manual'`.
  - The camera code is unchanged.
- **Measured (real runs):**
  - Build `main-BSX9mqJH`:
    - straight: angle 0.00°, dist 5.94 m, 12.2 m/s
    - corner: angle 16.8°, slip −18.8° at 10.9 m/s, on the grass
    - reverse: angle 0.04°, dist 5.65 m, u −7.0 m/s
    - explore: dist 6.35 m
    - close-up: dist 2.69 m
  - Final build `main-Dd-hYmfs` (also contains the working tree's in-progress 09-xx sim-core):
    - straight: angle 0.01°, 12.2 m/s
    - corner: angle 2.8°, slip 0.1°, 12.1 m/s
    - reverse: angle 0.06°, u −6.4 m/s
    - explore: angle 0.12°
- **Final screenshots:** corner square behind at 0.44 g, reversing square behind the heading. The two earlier
  shots are judged below.
- **Screenshots** (`shots/08-04-*.png`):
  - Straight: square behind the car, the horizon at about 40 %, the car in the lower-middle third. Good.
  - Corner: the car is shown three-quarter from behind and offset right. The camera sits between the heading and
    the velocity, which is the intended slip blend. With 19° of slip it reads as a slide. It is acceptable, but the
    car is large and low in the frame, so check this in the real-GPU tuning pass.
  - Reversing: the camera stays behind the heading, so the car drives toward the camera. This is the 08-04
    design and is readable. In the same shot, the distant road shows dark patches where the terrain mesh covers
    the ribbon (see section 2).

## 2. "Front-right wheel goes light" on the grass: ground vs drawing
Scripts: `scratchpad/item2/{gvr-head,loads,auto,cross,cliff}.ts`, against the committed sim-core (HEAD snapshot,
because the working tree has 09-xx files in progress).
- **Drawn corridor agrees with the sim.**
  - Method: 48 stations around the lap, l from −45 to 45 m every 0.1 m. The sim side is `world.sample` with a
    cold projection; the drawn side is the max of the low-tier ribbon and the terrain mesh triangles.
  - Road, kerb and apron: max 13 mm (p99 8 mm).
  - Runoff grass: max 18 mm away from cliffs.
  - Edge blend (17.5–18.5 m): p50 18 mm, max 102 mm (banked curve at s ≈ 1492, 4 m terrain cells).
  - Grass: p50 3–6 mm, max 0.2–0.3 m inside the R 20 m hairpin, where the projection is degenerate.
- **Sim ground is discontinuous (sim-core, for 09-04).**
  - `world/terrain.ts loopTerrainHeight` uses the edge height of the NEAREST centreline point. Where two loop
    sections at different heights compete, the terrain jumps on the medial axis.
  - Steps over 0.1 m within 5 cm, inside `inBounds` (|l| ≤ 60):
    - right side, s 0–216 at |l| 20.1–21.1 m: up to 2.38 m
    - right side, s 219–1650 at |l| 20–59 m: up to 3.46 m
    - left side, s 749–807: up to 0.32 m
  - The renderer's 4 m grid draws these as ramps. Near them the mismatch is up to 0.6 m in the edge band (s 12.7,
    l −18.5: sim 0.04 m, drawn 0.64 m) and 1.8–2.4 m on the grass. Near s ≈ 13 the ramp also pokes 88 mm through
    the ribbon's runoff grass.
- **Plant ground depends on the projection hint (sim-core, for 09-04).**
  - A wheel's warm-started projection stays on the old section after it crosses the medial axis. In my run the
    plant's contact patches stayed at z 0.71–0.77 m while a cold `world.sample` at the same (x, y) gives 1.30 m.
    The car is then drawn about 0.57 m sunk into the grass, with loads unchanged.
  - With per-station warm hints over the whole grid, the gap reaches 3.28 m.
  - When the projection falls back to a global search, a wheel's ground can jump by the full step.
- **Airborne check: no wheel lifts just off the kerb.**
  - The kerb is flush (s = 100: asphalt −4 mm, kerb −5 to −7 mm, apron −3 to −8 mm vs the centre). The corridor
    edge drops 13–36 mm over 17.5–18.5 m, then a smooth dip follows.
  - In a replay crossing kerb → apron → grass at 16–17 m/s and 0.9 g, the minimum load was 1.29 kN.
  - Steady on the grass at 0.47 g: FR (the outer wheel) 5.3 kN, FL 2.9 kN, RL 3.1 kN, RR 5.3 kN.
  - Zero loads do happen, equally in Auto and Manual, on the launch section (s 0–90, road features at 36 m/s), and
    as transients at the engage and at steer-in. The liftoff events are real.
  - The screenshot's chip "Load FR 0.0 kN" is frozen at the event moment by design (an event caption, visible for
    6 s), while LAT 0.48 g is live. It describes a past moment, not the steady state on the grass.
- **Proposed fix for 09-04:** make the off-corridor terrain a single-valued, continuous function of (x, y).
  - Evaluate the edge formula for every centreline candidate within d_min + W (W ≈ 10–20 m) and blend with
    smoothstep weights on (d_i − d_min)/W, or blend toward `farField` where two sections compete.
  - Use the hint only to speed up the search. When |l| > LOOP_CORRIDOR, check it against the global strided
    search so the ground never depends on history.
  - The renderer then bakes its vertices from that same function. 08-05 does not change the renderer: on the
    drawn corridor it already matches within 13–18 mm, and the large differences come from the sim side.
- Also seen: with steer 0.5 on the grass the car's sideslip grows slowly to about −60° at 0.47 g (a slow spin).
  That is 09-01/09-02 territory.

## 3. Insights and telemetry while driving
- **Section captions:** they fire only where a section applies: always in Auto, and while driving only on the loop
  corridor (`rules.ts onSection`). Signals still gate every caption. Event captions (wheel light, grip limit, bump
  stop) describe the car itself and keep firing. The 8 s gap and the 40 s cooldown per rule prevent spam.
- **Swap delta chip:** lap records take Auto samples only (`LapRecord.write`), and `computeDelta` returns null
  outside Auto. A swap while driving shows "Strut → Wishbone" with a "Compared in Auto" label and no numbers.
  `drive:mode` breaks the record run.
- **Ghost trace:** driven samples have s = NaN, so no ghost is drawn and nothing is written to a lap record. The
  legend reads "<name> · Auto only" while driving. Back in Auto, the ghost resumes for Auto samples.
- **Caption position:** it already stacked above the pill and hint through `--sl-hud-susp-h`. The old corner
  screenshot predates 08-03's hint fix; the new straight and reversing shots show the caption clear of the hint
  and pill. It now also adds `--sl-drive-action-h`: the drive action row widens the pill-to-hint gap but is not
  part of `--sl-hud-drive-h`.

## Verification (real output)
- `npx vitest run tests/features/{telemetry-panel,insights,camera,track}.test.ts`: `Tests 62 passed (62)`,
  including the new cases:
  - Manual History: no ghost, no record
  - Manual insights: corridor gate, events, no delta
- `npm run check`:
  - typecheck fails only in `src/sim-core/**` (09-xx in progress): `kinematics/{metrics,spatial,table}.ts`
    TS2554 and `math/det.ts` TS2532.
  - depcruise: `✔ no dependency violations found (241 modules, 798 dependencies cruised)`.
  - vitest: `Test Files 3 failed | 70 passed | 1 skipped (74)`, `Tests 2 failed | 809 passed | 11 skipped (822)`.
    None of the failures is in my files:
    - `tests/sim-core/compliance.test.ts` (09-04, untracked, in progress)
    - `tests/tmp0901/probe.test.ts` (someone's temporary probe)
    - the `simulation.test.ts` step-cost check (5477 ms, under parallel load)
- e2e on a private build (own outDir, port 4195, `--trace off`, build `main-Dd-hYmfs`, which includes the working
  tree's in-progress sim-core). Passed:
  - `08-04-camera.spec.ts` (3.3m)
  - `04-01-camera.spec.ts` × 2 (views 52.2s, attract 51.4s)
  - `04-03-hud.spec.ts` × 2 (readouts/insight/delta/ghost 1.4s, screenshots 3.5m)
- `04-05-layout.spec.ts` fails 2 tests, for a reason outside 08-05's files. Its canvas-reachability probe now hits
  the drive pill: `"845,907: sl-drive-seg", "998,907: sl-drive-seg"` at 1920×1080, in follow, engineer and screen.
  The pill is an 08-03 element at the bottom centre, and 08-03 did not run 04-05. The probe list in the spec, or
  the pill's hit area, needs an owner decision. 08-05 changed only the insight's offset, which is 0 px without an
  action row.
- Earlier run of `08-04-camera.spec.ts` on `main-BSX9mqJH`: `✓ … (1.9m) 1 passed`.

## Deviations / notes
- Someone killed `vite preview` processes during my runs (twice). I switched to a programmatic `preview()` script
  (`scratchpad/sl0805-serve.mjs`).
- `.wrangler/deploy/config.json` was restored to `dist/` after every preview start.
