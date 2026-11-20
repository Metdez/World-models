# 04-02 SUMMARY — HUD controls + loading + credits

## Built
- **controls** (`src/features/controls/`): a minimal glass HUD laid out per research 14 D5, tokens only.
  - Top-left: vehicle tag card ("Suspension Lab", vehicle name, "Representative parameters · Credits").
  - Bottom-centre: suspension segmented control, the primary control. It is built from `vehicle.suspensions` plus
    `copy.label`/`copy.short`: a radiogroup with roving tabindex, arrow/Home/End keys, a sliding thumb and 1/2/3
    keycaps. The selection's `copy.descriptor` sits underneath. One click swaps the suspension.
  - Bottom-right: view control (Follow · Explore · Close-up, with F/E/C keycaps).
  - Top-right: a time group (Live / "Rejoin live", pause/play, 0.25×) and a display group (vehicle-class toggle,
    hidden while only one class is registered; fullscreen, hidden when unsupported; `?`).
  - Top-centre: the amplification chip. It shows only while `amplification ≠ 1` and reads "Motion ×2.5 · values
    true scale". Its "True scale" button goes back to ×1 in one tap. It stays visible when the HUD is hidden.
  - Keyboard (UI-01) is a pure `keyAction()`: 1–n, F/E/C, X, V, Space, S, A, H, `?`, Esc. Keys are ignored in text
    inputs and with modifiers. A focused normal button keeps Space for its own activation, and pointer clicks drop
    focus so Space stays "pause".
  - `?` opens a shortcut card. Its rows are tappable actions, and it has a Credits link.
  - The HUD hides on H and while `store.attract` is set. A quiet "Show controls" button brings it back on touch.
  - An `aria-live` region announces suspension and view changes.
  - Screens at least 1600×860 zoom the HUD ×1.25; screens at least 2400×1300 zoom it ×1.6. Below 1200 px wide the
    view control moves under the top-right cluster. At 720 px and below, the controls use short labels and a
    full-width suspension control.
  - Loading overlay: a wordmark and a hairline progress bar. Progress is weighted: 85 % comes from the bytes of
    manifest assets fetched (PerformanceObserver resource entries; audio excluded; `assets:progress` is honoured if
    anyone emits it). The rest fills on `app:ready`. The overlay then fades out and is removed.
- **credits** (`src/features/credits/`): a right-hand sheet that opens on `store.creditsOpen`.
  - It lists every manifest attribution as a TASL sentence. For the DB11 this is the exact §15 text.
  - It lists the code, data and font credits from `code-credits.ts` with copyright lines taken from each package's
    LICENSE file.
  - It reproduces the full Project Chrono BSD-3 notice verbatim (including upstream's "the nor" typo) and the MIT
    permission text.
  - It adds a shape-only note: no manufacturer data is implied.
  - Focus moves to Close when the sheet opens and returns to the opener when it closes. Esc closes it.
- **CREDITS.md** is complete and covers:
  - DB11 (CC BY 4.0, modified)
  - Poly Haven HDRIs and textures (CC0)
  - Kenney sounds and the Landeplage skid sound (CC0)
  - Chrono (BSD-3, full notice)
  - AxleLab (MIT, (c) 2026 KRoshanK)
  - three.js, the meshoptimizer decoder, postprocessing (Zlib), n8ao, camera-controls, nanostores, mitt, Hono, Zod,
    PartySocket, uqr, stats-gl and Geist (OFL-1.1)

  `tests/features/credits.test.ts` checks that it mirrors the panel and ATTRIBUTION.json.

## Deviations
- Added `tests/features/credits.test.ts`, which the roadmap does not list. It is the CREDITS.md mirror check.
- Commits: task 1 (HUD shell) and task 2 (keys, loading, unit tests) are my own commits. The credits files, the
  CSS refinements and the e2e spec were swept into the orchestrator's "WIP snapshot" commits before I committed
  them. Their content is identical to what was tested.
- `?` opens the shortcut card, which contains Credits. Credits is also one click away from the top-left tag. This
  meets ARCHITECTURE §15's "≤ 2 interactions".
- n8ao: the package says ISC but its repository LICENSE file is CC0 1.0. Both are stated.

## Issues for other plans
- **Bottom-left clash (06-01 / 06-02):** the live-lab readout (`.sl-live-lab`) and the engineer pill
  (`.sl-engineer`) both use `left: margin; bottom: margin`, so they overlap each other when live-lab is visible.
  The telemetry card (04-03) stacks above the engineer pill. Live-lab is hidden in e2e (offline), so my overlap
  test could not see it. Suggest moving live-lab to top-left under the vehicle tag (about margin + 120 px) or
  above the telemetry card.
- **04-01 camera:** `.sl-camera-fade` took pointer events (`#overlay > *`) and blocked every HUD click. 04-01's
  working tree already has the `#overlay > .sl-camera-fade { pointer-events: none }` fix (uncommitted when I
  tested). My private build included it.
- Debug (`?debug=1`): stats-gl pins itself top-left (fixed 0,0) over the vehicle tag. This happens in debug mode
  only.
- The telemetry card (04-03) does not scale on big screens, while my HUD zooms ×1.25 at 1920×1080.
- 04-03's insight caption should sit above the suspension control. The control plus its descriptor occupy about
  the bottom 100 px (125 px at 1920×1080).

## Verification (real output)
`npm run check` in the shared tree is **not green**, and none of the failures are in 04-02 files:
- typecheck errors in `tests/sim-core/_scratch/*` and `tests/e2e/04-04-overlays.spec.ts`;
- 24 vitest failures in sim-core, kernel, track and teaching-overlays from other executors' in-flight work.

My parts:
```
$ npx tsc -p tsconfig.app.json            (clean)
$ npm run lint:deps
✔ no dependency violations found (204 modules, 630 dependencies cruised)
$ npx vitest run tests/features/controls.test.ts   Tests 9 passed (9)
$ npx vitest run tests/features/credits.test.ts    Tests 29 passed (29)
```
Clean worktree (my commit + my files), vitest excluding `_scratch`: 529 passed, 3 failed. The failures were
`kernel/app.test.ts` ×2, which passes alone (9/9), and `simulation.test.ts` "step cost", which is load-sensitive
(noted in 03-03).

E2E on a private build (`vite build --outDir <scratch>/build-0402`, `python3 -m http.server 4342`):
```
$ PLAYWRIGHT_BASE_URL=http://localhost:4342 npx playwright test tests/e2e/04-02-controls.spec.ts --trace off
[1/5] loading overlay shows progress and leaves after the first frame
[2/5] one click or one key swaps suspension and view; time, amplification and HUD keys work
[3/5] layout 1280x720: nothing overlaps; screenshot
[4/5] layout 1920x1080: nothing overlaps; screenshot
[5/5] credits panel: reachable in one click, exact DB11 and Chrono notices, Esc closes
  5 passed (8.3m)
```
The first run failed in two ways:
- 3 tests failed on the camera-fade pointer block (above);
- at 1280×720 the suspension and view pills overlapped by a few px. I fixed this with tighter segment padding and
  a 1200 px breakpoint.

Screenshots (DPR 1, inspected), in `/tmp/claude-0/-home-user-World-models/3bea3e2a-9224-5f6d-a9f0-620b29f250e6/scratchpad/shots/`:
- `04-02-loading.png`
- `04-02-hud-1280x720.png`
- `04-02-hud-1920x1080.png`
- `04-02-credits.png`

## What still looks off
- At 1280×720 the vehicle tag card is fairly large next to the minimal pills.
- The suspension pill and the view pill do not share a baseline, because the descriptor line sits under the
  suspension pill.
- The loading bar mostly jumps: the bytes it counts include two alternate HDRIs that boot does not fetch (shortcut
  noted in `loading.ts`).
