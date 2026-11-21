# 08-04 SUMMARY — Manual chase camera

## Built
- `src/features/camera/manual.ts`: the `MANUAL` constants (every threshold is an estimate and lives in this one block:
  blend 0.8 s, slip window 30°, slip fade 30–90°, velocity band 3–10 m/s, tau 0.35 s, lead ±18°, dead zone 1.5°,
  look-ahead 5 m·L/2.8, soft/hard lag 0.55/1.2 rad, z decay 12/s, clearance 0.7 m, cut jump 15 m);
  `manualHeading()` (ψ + w_vel·slip + lead with a continuous dead zone; reverse and standstill go by the heading) and
  `dampRamp` / `dampAngleRamp` (exact for a linearly moving target, so they add no frame-rate dependent lag).
- `rig.ts`: `CameraRig.mix` (0 Auto … 1 Manual, eased over 0.8 s with smootherstep). **mix = 0 runs the M1 code
  unchanged.** I checked this against the HEAD rig: 6000 frames (a lap-clock jump, a close-up blend and an orbit shot)
  gave bit-identical poses. Outside auto, `driven()` cross-fades the car frame (anchor = lerp of the path point and
  (drive.x, drive.y, smoothed bodyPosition.z); the heading is wrap-lerped) and the chase target. `Chase.stepTo()`
  moves the existing channels toward the target with ramp smoothing. The follow rate rises with the lag (soft limit)
  and is clamped hard at 1.2 rad. Eye ≥ `world.sample(eye).h + 0.7`, blended with the Auto clearance. Hard cuts:
  `cut()`, and an anchor jump > 15 m. Director shots are refused outside auto, and one still playing is cleared. Under
  reduced motion a mode switch is a cut with the dip from black.
- `index.ts`: `drive:mode` with `cut` or a `reset` drive event → `rig.cut()`; `rig.reducedMotion` comes from the store
  each frame.
- Tests: `tests/features/camera.test.ts` has +15 cases (27 total). They cover:
  - the target maths
  - `dampRamp` exactness
  - Auto never mixing
  - 30/60/144 Hz giving the same pose within 1 cm after 2 s of cornering with slip
  - Auto→Manual→returning→auto with no jump
  - cuts
  - `world.sample` clearance
  - a spin, reverse and standstill noise
  - kerb chatter vs a crest
  - shots refused
  - close-up and explore while driving
  - a `withFakeDrive` reverse run
  - no allocation (retained heap < 64 KB, identity-stable objects)
- `tests/e2e/08-04-camera.spec.ts`: the case is held steer → behind < 25°, reverse → behind < 25°, explore and
  close-up while driving, and 3 screenshots. It skips when `drive().available` is false. The orchestrator's WIP
  snapshot ad3dec2 already swept it in, unchanged.

## Deviations
- **Slip fade:** past ±30° the slip offset fades to 0 by 90°. The steady-state steer yaw term fades the same way.
  This is an addition to the spec's plain clamp. Without it the target jumped 30° when the speed band dropped out
  mid-spin, and the steer term flipped sign as u reversed. A synthetic spin had camera yaw-rate peaks of 5.7 rad/s
  and position jitter of 102 mm/frame². With the fade the camera stays below its target's peak rate (4.7 vs
  6.7 rad/s) and its yaw acceleration stays under half the target's.
- **Soft lag limit:** the spec's hard 0.55 rad clamp is replaced by a soft limit in manual. A hard clamp gives a
  velocity step in a spin. Auto keeps its hard clamp.
- **Anchor z:** it is the smoothed `bodyPosition.z`, as the spec says. Measured in Auto, the body origin sits 2–3 cm
  under the road point, so the framing matches Auto.
- **FOV widening:** none added. The existing small speed-linked CHASE FOV range (45→54°) applies.

## Verification (real output)
- `npx vitest run tests/features/camera.test.ts`: 27 passed. Printed results:
  - auto↔manual: second difference 2.84 mm/frame² (driving line 1.71)
  - spin: camera yaw rate 4.74 rad/s (target 6.69), yaw acceleration 38.6 rad/s² (target 163.1)
- `npm run check`, after 08-02's later in-progress edits:
  - typecheck fails only in `src/sim-core/car/car-model.ts` (cannot find `../drive/plant`, an 08-02 file in progress).
    `tsc -p tsconfig.app.json` and `tsconfig.node.json` show no other errors.
  - depcruise: `✔ no dependency violations found (238 modules, 747 dependencies cruised)`.
  - vitest: `Test Files 1 failed | 63 passed | 1 skipped (65)`, `Tests 1 failed | 733 passed | 11 skipped (745)`.
    The one failure is `tests/arch/purity.test.ts` on `src/sim-core/world/project.ts: window` (08-02's file).
  - Earlier, `tests/features/vehicle-view.test.ts` failed one heap check under full-suite load. It passes alone and
    passed in the later run.
- Private build (own outDir, port 4194; `.wrangler/deploy/config.json` restored): `04-01-camera.spec.ts` 2 passed;
  `08-04-camera.spec.ts` **skipped: Manual Drive plant (08-02) not in this build**. The real-plant e2e and its 3
  screenshots are **pending**.
- Note for private builds: `vite preview` reads `.wrangler/deploy/config.json`. Restore it only after the preview has
  started, or the preview serves `dist/`. My first run hit this.

## For later
- Once 08-02 lands: run `08-04-camera.spec.ts` on a private build (SHOTS_DIR = scratch shots) and look at the
  screenshots.
- The `MANUAL` constants need a tuning pass on a real GPU.
