# 04-03 — Telemetry panel + insights: SUMMARY

## What was built
- **Telemetry card** (`src/features/telemetry-panel/`), bottom-left above the "Ask the engineer" pill (research 14
  D5). Contents:
  - a g-g plot with rings at 0.5 g and 1 g and a fading 1.5 s trail (no trail with reduced motion);
  - lateral g and roll, the only two headline numbers;
  - per-corner cells laid out like the car seen from above (2×2, or 1×2 for a 2-corner frame). Each cell has a
    camber arc with a static tick and a needle that leans like the wheel, a travel bar between the kinematic travel
    limits, and a load square (load ÷ static corner load from mass and CG; amber outline when unloaded);
  - one sparkline with Camber | Travel | Load tabs for the selected corner (click a cell to choose it). The corner
    numbers show the selected metric, so the card never shows more than 6 numbers.

  The **ghost** is the previous suspension's trace at the same track positions: lap records are binned by `s`, one
  per suspension id. A dashed line plus a legend name it. All values are TRUE fields, formatted with `format.ts`.
  Canvases are DPR-aware (capped at 2). Painters allocate nothing: there are no per-call closures, colours come from
  the tokens once, and dash arrays are constants. Text is written at 15 Hz, and only when its displayed digits
  change. Sampling runs at 30 Hz of simulation time, so a paused lab freezes, slow motion gives a denser trace and
  e2e `advance()` is deterministic. Recording continues while the card is hidden.
- **Insights** (`src/features/insights/`):
  - `rules.ts`: 12 rules, either keyed by the section phenomenon (signal ≥ threshold, held for `sustain`) or by
    `sim:event` (liftoff, grip-limit, bump-stop, in amber).
  - Pacing: hysteresis (re-arm below 80 %), at most 1 caption per 8 s, a 40 s cooldown per rule, 6 s on screen in
    sim time.
  - Accessibility and events: `aria-live="polite"`, emits `insight:shown`, and stays silent during attract or with
    the HUD hidden.
  - Templates contain no digits. Placeholders are filled from the frame. No template names or ranks a suspension
    type (tested). A section chip keeps reading the live frame, so it matches the card. Event chips keep the moment's
    values.
  - **Delta chip** (`lap-record.ts`): 1 s of sim time after `sim:suspension`, it compares the previous suspension's
    value at the car's current track position with the new value. Only in steady sections (carousel, sweeper,
    run-in) does it fall back to the value just before the swap. The metric depends on the section: pitch under
    braking, travel over bumps, camber elsewhere. It reports the corner with the largest |Δ|. Example: "MacPherson
    strut → Double wishbone | CAMBER RL −0.2° → −0.9°" (the outer rear in the carousel, which matches the measured
    sim facts).

## Deviations
- **Ghost timing:** the ghost appears wherever the previous suspension has already driven, i.e. after one lap with
  it, or after a seek back. It never shows "the previous seconds", because that would compare different road. Right
  after a first swap on a fresh boot, the dashed line overlaps the live line up to the swap point and is empty after
  it. A true simultaneous ghost would need a shadow simulation of the previous suspension; I left that out.
- **Placement:** the card sits higher (margin + 88 px) below 1320 px viewport width so the centred suspension
  control cannot reach it. It also hides while `engineerOpen`, because the engineer panel grows upward into this
  column.
- **Tradeoff bars** (stretch): not built.
- **Commits:** tasks 1 and 2 are my commits (9a0c7ed, 2bda76c). Later edits (sim-time caption lifetime, layout,
  live chips, the e2e spec) were swept into the orchestrator's "WIP snapshot" commits before I committed them.
- **E2E:** the first test runs with `features=-renderer` so it can step 120+ frames quickly. The screenshot test runs
  with the full scene.

## What looks off / known gaps
- The corner glyphs are small (64×30 CSS px). They read well at DPR 2, but the travel bar and the load square are
  subtle at DPR 1.
- At viewports narrower than about 1100 px, long captions can come within 20 px of the card.
- When the live-lab presence readout is connected, it uses the same bottom-left corner as the engineer pill. That
  overlap is not mine to fix, but the card sits above both.

## Verification (real output)
```
$ npx vitest run tests/features tests/arch tests/kernel
 Test Files  27 passed (27)
      Tests  296 passed (296)
$ npm run check
✔ no dependency violations found (204 modules, 631 dependencies cruised)
 Test Files  3 failed | 52 passed | 1 skipped (56)
      Tests  5 failed | 616 passed | 11 skipped (632)
   failures: tests/sim-core/golden.test.ts ×3, kinematics-table.test.ts (multilink-front),
   simulation.test.ts ("motorcycle model is a phase-5 stub"). All are in sim-core, owned by the parallel
   sim-fix / 05-01 executors; there are none in my files. Typecheck passed.
$ npx vite build --outDir <scratch>/build0403   (served on 127.0.0.1:4613, static)
$ SHOTS_DIR=<scratch>/shots PLAYWRIGHT_BASE_URL=http://127.0.0.1:4613 npx playwright test tests/e2e/04-03-hud.spec.ts --trace off
  ✓ 1 true-value readouts, carousel insight, swap delta chip + ghost, controls (no 3D) (1.1s)
  ✓ 2 screenshots over the scene: carousel, swap ghost + delta chip (2.7m)
  2 passed (2.8m)
```
Screenshots (DPR 1, inspected):
`/tmp/claude-0/-home-user-World-models/3bea3e2a-9224-5f6d-a9f0-620b29f250e6/scratchpad/shots/04-03-{carousel,swap-delta,panel-ghost}.png`
