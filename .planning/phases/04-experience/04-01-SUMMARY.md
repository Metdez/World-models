# 04-01 SUMMARY — Camera rig + attract mode

**Status:** built; my tests and e2e spec green; `npm run check` red only on other executors' files (see below). No deploy.
Commits: `341e1ab` plan, `468ba3e` rig + views + shots, `00cce94` attract + close-up framing + e2e, and this summary.

## Built
- **`camera`** (`rig.ts`, `damp.ts`, `index.ts`, `camera.css`). It provides CAMERA and poses `RENDER.camera` in the
  camera phase. The placeholder's own chase turns off as soon as CAMERA exists, so the camera needed no renderer edit.
  - **Car frame:** the driving-line point at the frame's interpolated `lapTime`, taken from the pure
    `sim.current.stateAt()` and yawed by the path heading. Every pose is computed and blended in this frame. It is
    smooth by construction and does not lag at speed.
  - **Follow:**
    - the anchor is exact and has no positional lag;
    - the heading lag is damped with `1-exp(-λdt)` (λ 2.2, ≤ 0.55 rad), so corners reveal the car's flank (measured
      max 14°);
    - distance, height and FOV ease with speed;
    - the aim leans toward `stateAt(lapTime + 0.6 s)`;
    - the eye stays above the road behind the car;
    - the camera snaps instead of swinging when the lap clock jumps (seek or live resync).
  - **Explore:** camera-controls drives a proxy camera. The target follows the car (`moveTo(…, false)`), and the
    orbit rotates with the car's yaw, so a 3/4 view stays 3/4 through corners. It is enabled only in explore, and the
    handover starts from the current pose.
  - **Close-up:** the camera is rigid in the body frame for each corner (`focusCorner`, `camera:focus`), so the body
    stays still and the wheel and links visibly work. It sits ahead of the front axle (or behind the rear one),
    above the hub and near the centreline, looking out and down through the x-rayed bumper at the corner. That frames
    the upper and lower arms, spring/damper, tie rod and ARB against the tyre; the framing was chosen from 7
    candidate screenshots. A 2-corner frame gets a side view instead. Entering the close-up turns x-ray on; leaving
    restores it unless the user toggled X in between.
  - **Blend:** smootherstep over 1.2 s. Position is interpolated in spherical coordinates about the car centre, so
    it arcs around the car, never through it; orientation uses slerp and FOV a lerp. Under reduced motion it becomes
    a cut with a 0.25 s dip from black.
  - **Director shots:** chase, orbit, closeup, trackside, overhead and front-view.
    - Trackside is a tripod cut on the inside of the line where the car will be mid-shot, with a telephoto FOV that
      keeps the car about the same size.
    - `clearShot()`, a view change or `user:activity` returns to the view.
- **`attract`** (`storyboard.ts`, `index.ts`, `attract.css`). The storyboard is a pure 60 s loop (research 21 §3,
  adapted). Each caption is at most 8 words, no digits.
  1. Orbit hero.
  2. Bump-strip close-up with x-ray.
  3. Chicane in slow motion (0.25×, ×2.5 motion with its own "Motion ×2.5 · values true scale" note) from the front
     view.
  4. Trackside at the carousel.
  5. The visitor's suspension, then the next two, over the same bump.
  6. Brake dive from trackside.
  7. "Touch to explore."

  Sections are found by `phenomenon` and seeked behind a 0.35/0.5 s fade. Mechanics:
  - It emits `user:activity` from DOM input (pointer, keys, wheel, touch), at most 4 per second.
  - Idle 30 s sets `store.attract`. It never does so in e2e or with `?attract=0`.
  - Any input exits with a fade and restores every key it touched (view, focusCorner, xray, overlay, amplification,
    timeScale, paused, clock, suspension).

## Measured (real)
- **Chase over a whole lap at 60 Hz:**
  - the maximum second difference of the camera position is 5.46 mm/frame², against 5.47 for the driving line
    itself, so the camera adds no jitter;
  - the lowest eye is 1.56 m above the road;
  - the heading lag peaks at 14.2°.
- **Frame-rate independence:** hairpin at 30 Hz vs 144 Hz, end pose within 5 cm and 0.01 rad (test).
- **Chase to close-up blend:** never closer to the car centre than the nearer endpoint, and settled within 1.2 s.
- **e2e:**
  - chase: body-frame eye at x −6.5, y 1.74;
  - the drag orbits about 180° around the car;
  - close-up fl: (2.70, 0.95, −0.15) with x-ray on; rr: (−2.76, 0.95, +0.15);
  - x-ray turns off on leaving;
  - attract beat 2 seeks (lap 10.13, three seconds before the bump strip), x-ray on, clock local;
  - Shift restores the state exactly.

## Deviations / notes
1. Director shots landed in the task-1 commit together with the rig. That gives 2 code commits instead of 3.
2. **Fixed bug (mine):** `src/ui/base.css` sets `#overlay > * { pointer-events: auto }`. My full-screen fade divs
   swallowed every canvas pointer event until I added `#overlay > .sl-…-fade { pointer-events: none }`. **Other
   features adding full-screen overlay children will hit the same trap.**
3. The e2e emulates reduced motion so that view switches are cuts. Real blends need about 12 frames, and SwiftShader
   renders about one frame per second. Blends are covered frame by frame in `tests/features/camera.test.ts`.
4. The e2e only asserts errors from camera/attract. Other phase-4 features are mid-work in the same tree.
5. Attract leaves `hudVisible` alone, so the amplification honesty chip from 04-02 stays reachable. It also shows its
   own note while ×2.5 is active.
6. Shake was not done (stretch).

## What looks off / known gaps
- The explore drag sensitivity is camera-controls' default. The test drag of about 27 % of the width swung about
  180°; this may want `azimuthRotateSpeed` around 0.5 on a real screen. I did not tune it without a real GPU.
- In the close-up, if the user turns x-ray off, the eye (about 0.3 m ahead of the bumper face, 0.95 m high) sees the
  opaque bumper, not the links.
- **Attract seeks land as computed, but SwiftShader is slow:** the beat-2 screenshot is taken at the hairpin, before
  the car reaches the bumps. On real hardware the 3 s lead is right.
- The orbit hero starts from wherever the camera is, which is usually behind the car. It sweeps about 73° in 8 s.
- In the close-up, the 04-04 dashed construction lines and the telemetry card overlap the left of the frame.

## Verification (real output)
```
$ npx vitest run tests/features/camera.test.ts tests/features/attract.test.ts tests/arch
  chase: max second difference 5.46 mm/frame² (driving line 5.47), lowest eye 1.56 m, max heading lag 14.2 deg
 Test Files  6 passed (6)      Tests  42 passed (42)
$ npm run lint:deps
✔ no dependency violations found (204 modules, 630 dependencies cruised)
$ npm run check    -> exit 2, typecheck errors only in files I do not own:
  tests/e2e/04-04-overlays.spec.ts(119,30) TS7006; tests/sim-core/_scratch/{cmp,tierod}.test.ts
$ npx vitest run (full) -> 12 failed | 612 passed | 11 skipped; failures in kernel/app, kernel/loop (timing),
  sim-core golden/simulation/kinematics-table, linkage-parts, sim-core/_scratch/* — none in camera/attract files
$ npx vite build --outDir <scratch>/0401/dist ; node serve.mjs <dist/client> 4291
$ PLAYWRIGHT_BASE_URL=http://localhost:4291 npx playwright test tests/e2e/04-01-camera.spec.ts --trace off
  ✓ views: chase behind the car, orbit by drag, close-up into the wheel well with x-ray (3.4m)
  ✓ attract: storyboard drives captions, shots and the store; any input restores the visitor state (1.8m)
  2 passed (5.3m)
```
Screenshots (DPR 1, inspected): `/tmp/claude-0/-home-user-World-models/3bea3e2a-9224-5f6d-a9f0-620b29f250e6/scratchpad/shots/04-01-{chase,orbit,closeup-xray,attract-hero,attract-closeup}.png`
