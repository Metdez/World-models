# 04-05 SUMMARY — HUD layout + integration pass (gap closure)

**Status:** complete (no deploy). Plan commit `30c9922`. The code was swept into the orchestrator's WIP snapshot
`adf0322` (and later snapshots) before I could commit it by path; this summary commit carries the rest.

## Built
**One layout** (research 14 D5), as shared custom properties at the top of `controls/controls.css` (`--sl-hud-zoom`,
`--sl-hud-col`, `-gap`, `-tag-h`, `-line-h`, `-top-h`, `-pill-h`, `-view-h`, `-susp-h`). Every feature reads them with
fallbacks, so the columns stack without measuring each other:
- **Left column:** vehicle tag (fixed 100 px) → Live Lab as one slim pill line (`● N IN THE LAB ── Wishbone 3`) →
  presenter join card (`#overlay:has(> .sl-live-lab:not([hidden]))` pushes it under the line) … telemetry card →
  "Ask the engineer" pill. The engineer panel is capped at the column width (it reached the suspension control).
- **Right column:** time/display groups → camber trace … poll → view control. The help card sits above the trace.
- **Centre:** amplification chip, `?debug=1` stats under it (stats-gl's inline fixed 0,0 overridden), insight caption
  capped to the gap between the columns.
- **One scale rule:** `zoom: var(--sl-hud-zoom)` on every HUD piece (×1.25 at ≥1600×860, ×1.6 at ≥2400×1300); the
  telemetry card, live line, presenter, poll, engineer, insights, trace and debug panel now follow it.
- **Visibility:** engineer and Live Lab follow H; engineer, telemetry and trace also hide in attract mode (the
  presenter card and poll stay for the room).
- **Input:** `#overlay > .sl-live-lab`, `.sl-teaching-overlays-trace` and the engineer column box no longer take
  pointer events (their own rules lost to base.css' `#overlay > *`). The spec checks a grid of points outside all HUD
  boxes hits the canvas, and that an orbit drag works with every panel open.

**Close-up:** the telemetry card folds to g-g + lateral g + roll; the far axle's construction is hidden
(`construction.draw(…, farFloor)`: 0 in close-up, 0.22 elsewhere). X-ray stays on in close-up: X is a no-op there,
announced ("X-ray stays on in close-up"), the help row reads "X-ray · always on in close-up", and the camera feature
turns it back on if anything (presenter, store) switches it off while in close-up.

**Visual tuning:** construction casing strength 0.6 → 0.85 (dark halo under the mint strokes). The x-ray ghost uses
max blending instead of additive (overlapping skin layers no longer stack into a bright wash), a softer rim (power 2.6,
×0.6) and fades skin within ~0.4–1.8 m of the eye (the close-up eye sits at the bumper).

**Integration:** loading bar counts the HDRIs as one alternates slot (boot fetches one), so assets can reach 85 %;
renderer placeholder deleted (file, ground disc, centreline, chase) together with the track's hide-shortcut; fog colour
is the HDRI at the horizon line (−1..2°) instead of the sky band 2–8° (~5× brighter on the airfield) — the light
horizon line is gone (before/after crops checked); camera-controls azimuth/polar speed 0.5; 03-02/03-04 specs
`test.describe.configure({ timeout: 120_000 })`; smoke spec waits up to 90 s for boot, 120 s per test, and the debug
test runs with `e2e=1` (no room, no attract).

## Deviations
1. **`src/features/car/db11/shaders.ts` edited** (not in my listed directories): the ghost material is where the
   uniform light-blue wash and the stacking at the bumper come from; three constants, the blend mode and a distance
   fade. Item 3 of the brief could not be done elsewhere.
2. `tests/features/environment.test.ts` horizon expectation changed with the new band (tree line ~0.1, not sky ~0.6);
   `tests/features/controls.test.ts` covers the HDRI slot and X in close-up.
3. Commits: swept into WIP snapshots (see status).

## What still looks off
- At 1280×720 with a room the left column is full: tag, line, join card, telemetry, pill leave ~28 px between the
  join card and the telemetry card. Between 1200 and 1240 px wide the telemetry card rises 32 px and would meet the
  join card on a 720 px tall screen (not a target size).
- A caption that wraps (only artificially long text does) keeps the pill radius and looks blobby.
- The close-up still shows the other front corner's construction at the left of the frame (it is the same axle; the
  RC needs both sides).
- The 05-03 vehicle toggle ("Cafe racer") widened the top-right cluster to 422 px at 1280; it still clears the amp chip.

## Verification (real output)
```
$ npm run check            -> exit 0
✔ no dependency violations found (204 modules, 633 dependencies cruised)
 Test Files  57 passed | 1 skipped (58)
      Tests  644 passed | 11 skipped (655)
$ npx vite build --outDir <scratch>/0405/after && npx vite preview --outDir <scratch>/0405/after --port 4506
$ PLAYWRIGHT_BASE_URL=http://localhost:4506 npx playwright test tests/e2e/04-05-layout.spec.ts --trace off
  ✓ desktop: follow, close-up and engineer-open layouts never overlap; the canvas stays reachable (2.6m)
  ✓ big screen with a live room: tag, presence line, join card, telemetry, poll and engineer all fit (3.9m)
  (before this plan, on a build of the previous tree: 2 failed — tag × presenter, live-lab × engineer,
   live-lab × telemetry, engineer × suspension control, top-right × trace at 1920, debug stats over the tag)
$ PLAYWRIGHT_BASE_URL=http://localhost:4506 npx playwright test smoke 03-02 03-03 03-04 04-01 04-02 04-04 --trace off
  19 passed (13.2m)   (03-04 ×3 at 1.2 m each, 03-02 closeup 59.3 s: the 120 s budget was needed)
```
Screenshots (DPR 1, inspected), session scratchpad `shots/`: `04-05-before-*.png` and `04-05-{follow,closeup,
engineer}-{1280x720,1920x1080}.png`, `04-05-screen{,-closeup,-engineer}-{1280x720,1920x1080}.png`.
The help-card `z-index` line landed after the e2e build (CSS only).
