# 10-04 SUMMARY — Drive UX v2: Returning UI, stations, gamepad, touch, rumble

## Built (`src/features/drive/**`)
- **Hand-back** (`handback.ts`, pure): Enter / pill / idle / pad A in Manual → `handBackKind(zone, lineOffset, annex)`:
  on or beside the loop (finite line offset ≤ 40 m, not an annex zone) = `request('auto')` (Returning); from the annex
  (world zone ids + `field`) or off the loop corridor = hint "Returning to the lap" + fade + immediate release.
  Returning: the pill's active segment reads RETURNING plus a chip "Finding the line…" / "Rejoining the lap…" (from
  `DriveHost.autopilot.state`) and a **Rejoin now** button (faded immediate release). Any driving input takes the wheel
  back (fresh edge → `request('manual')`, no cut). Latch (`mode{auto,cut:false}`) = no fade.
- **Fade**: `.sl-drive-fade` under the HUD, JS-driven: 0.15 s out before an action we start (station, annex release,
  Rejoin, out-of-bounds), 0.35 s in after every cut (`mode{auto,cut:true}`, `reset` events, also R). Reduced motion:
  none (the cut stays a cut).
- **Stations**: a pin button in the pill ("Stations" text in Auto, icon in Manual), popover titled "Drive the proving
  ground" (Auto) / "Stations" (Manual): name + the world's `experiment` line, a dashed "Tyre grip, not suspension" tag
  for `suspension:false`. Pick → fade, takeover if needed, `drive:reset {spawn}`; the hint then shows the station name
  and its `caption` (what to watch) for 9 s; one announcement. No numbers, no scores. `?drive=manual&spawn=<id>` already
  worked through the kernel (tested). Popovers: one at a time, Escape (also with focus elsewhere), outside click.
- **Out-of-bounds**: plant `out-of-bounds` event → note "Back inside the proving ground" + fade + reset at the nearest
  of (station spawns, driving line via `world.project`); while returning → faded immediate release.
- **Gamepad** (`gamepad.ts`): standard mapping only, `getGamepads()` every frame, left stick X axial dead zone 0.12 +
  exponent 1.6, RT/LT analog (dead zone 0.04), X handbrake, A toggle / Y reset on press edges (a button held while
  plugging in is not a press), last-used pad preferred, hot-plug note + one announcement, `has-pad` prompt variant and
  pad control hint.
- **Rumble** (`rumble.ts`): only Manual + pad active + toggle on; weak = 0.3·smoothstep of RMS travel rate + 0.2 at the
  grip limit; strong = 0.12 s pulse on a bump-stop / kerb strike (0.4) or ABS start (0.25); cap 0.5; `dual-rumble`
  120 ms at ≤ 20 Hz when `effects` includes it (or lacks the list but has `playEffect`); reset on hand-back, blur,
  unplug. Toggle "Controller rumble" in the Assists popover, shown only with a rumble-capable pad.
- **Touch** (`touch.ts`): coarse pointers in Manual: left slider (relative drag, 4 px dead band, spring back, pointer
  capture, `touch-action: none`), right GAS (84 px) above BRAKE (64 px), 76 px wide; pedals ramped in the source (5/s up,
  10/s down) so the intent is analog; only the controls take pointer events; above the HUD corners (z 3) while driving.
  Auto on touch: "Tap Manual to drive". On coarse ≤ 1100 px the aid lamps keep icon + warn border (text hidden; the
  Approximate badge keeps its word) so the pill clears the pedals.
- Arbiter unchanged (most recent deliberate source, 1 s hysteresis, disarm on hand-back): no mode flicker.
- **Keyboard**: unchanged except that Enter now starts Returning on the loop (the plan's purpose).
- **sim-core**: `RETURN_TIMEOUT` 20 → 40 s (orchestrator decision 1) and the returning test's strings/floor.

## Measured (real output)
- H2 with 40 s: `latched within 40 s 463 (92 %)`, median 20.1 s, p90 32.5 s, worst 40.0 s (was 228 within 20 s);
  H2-road `latched within 40 s 200` (median 6.6, p90 15.5, worst 34.3 s). Floor raised to 400/500.
- **T10** (`tests/sim-core/proving-ground-manoeuvres.test.ts`, ISO 3888-2 on the pad, PathDriver on a recordedLine
  through the gates, held speed, aids on, body footprint): every run finite; **largest passing speed in the sweep
  30.1 / 30.0 / 30.1 km/h (MacPherson / double wishbone / multi-link)**; 15–25 km/h hit gate 2 by 18–26 cm, ≥ 35 km/h by
  0.9–2.4 m with 1.6–3.4 m line error. The PathDriver (0.6 rad/s steering slew, grip-limited steer, built as a gentle
  return driver) cannot follow this abrupt lane: the table measures the driver, not the suspension (margins differ by
  ≤ 2 cm between suspensions). A dedicated manoeuvre driver (sim-core, not mine) would be needed for a meaningful
  max-pass-speed table. Not asserted beyond finiteness + line geometry.

## Verification
- `npm run typecheck` clean; depcruise `✔ no dependency violations found (254 modules, 875 dependencies cruised)`.
- vitest full: `Test Files 1 failed | 91 passed | 1 skipped (93)`, `Tests 1 failed | 916 passed | 11 skipped (928)` —
  the failure is 10-02's `world-zones` "sample does not allocate" heap-profile test under parallel load; alone `Tests 8
  passed (8)`. Mine: `drive-input` 13, `drive` 17, `returning` 4, T10 2 — pass. Goldens pass.
- e2e on a private build (`vite build --outDir <scratch>/dist`, `vite preview --port 4291`, config restored after the
  preview was up, served bundle checked, `--trace off`, `?quality=low`):
  - `10-04-drive.spec.ts`: **6 passed** — hand-back/latch without fade/takeover while returning/Rejoin fade; stations
    (popover, keyboard Enter/Tab/Escape, spawn, annex faded release, `?spawn`); gamepad (mocked `getGamepads`: trigger
    takeover, stick right → steer < 0 and yaw decreasing, A hand-back, rumble switch, unplug); reduced motion = cut;
    touch phone 844×390 and tablet 1024×768 (CDP touch: gas + slider drag left → steer > 0, ≥ 48 px, canvas centre
    not covered).
  - `08-03-drive.spec.ts` 2 passed (test 1 timed out once at boot under load while H2 ran; passed on rerun),
    `09-05-hud.spec.ts` 2 passed, `04-05-layout.spec.ts` 2 passed, `07-03-a11y.spec.ts` 4 passed.
- **Gamepad was not tried with a real controller** (none here): mapping/conditioning unit-tested, Gamepad API mocked in
  e2e; rumble only checked against a fake actuator.
- Screenshots (looked at): `…/scratchpad/shots/10-04-returning.png`, `10-04-stations.png`, `10-04-station-note.png`,
  `10-04-touch-phone.png`, `10-04-touch-tablet.png`.

## Deviations / notes
1. Task 1 and 2 landed in one feature commit (6eda0ad); my three test files were swept into the orchestrator's WIP
   snapshot d9eca64 before my test commit.
2. Outside the owned list (orchestrator-approved): `src/sim-core/drive/control.ts` (constant + comment),
   `tests/sim-core/returning.test.ts` (strings, floor), `tests/e2e/08-03-drive.spec.ts` (Enter now → Returning: the step
   asserts "not manual" instead of "auto").
3. Hand-back rule: zone `terrain` beside the loop (runoff, finite line offset) also Returns — decision 2 says "zone not
   loop → release"; I read it as "annex zone → release" because the loop's own runoff is where H2 was measured.
4. T10 does not meet the roadmap's intent (a per-suspension max-pass-speed table that says something about suspension):
   see Measured.
5. **Pre-existing layout issue (not my files)**: at 844×390 and 1024×768 the telemetry card overlaps the drive pill's
   left part in Auto and Manual, and on the phone an insight caption wraps into a narrow column. The touch slider now
   covers the "Ask the engineer" pill while touch-driving (deliberate: thumbs first). Needs telemetry-panel / 04-05
   layout attention.
6. The idle hint/`aria-live` rules from 07-03 kept: one polite region, one announcement per mode change, note, station.

## Lifted code
None (dead-zone/curve forms are the research's own formulas; no third-party code).
