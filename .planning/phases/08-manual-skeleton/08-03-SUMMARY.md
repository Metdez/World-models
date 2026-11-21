# 08-03 SUMMARY — Take the wheel (drive feature v1)

## Built
- **`src/features/drive/`** (replaces the stub)
  - `keys.ts` (pure): `KeyboardEvent.code` → digital keyboard intent (W/↑ throttle, S/↓ brake, A/← left = +steer, D/→
    right, Shift handbrake; A+D cancel), `capturesCode(code, mode)`: in Auto only W and the arrows join the held set
    (A and S keep M1 amplification / slow motion — orchestrator decision 1), in Manual every driving key. `gearLabel`.
  - `arbiter.ts` (pure): DRIVE service core. Sources are read every frame; the most recent deliberate source wins with
    1 s hysteresis; `fresh` = rising edge of deliberate input while armed; `disarm()` on every hand-back, re-armed only
    when all sources are neutral (a key still held through Enter cannot retake the wheel).
  - `idle.ts` (pure): prompt after 4 s of Auto for 8 s; control hint 6 s after takeover; hand-back at 12 s without input
    (×2.5 = 30 s with `?screen=1`), with a 3-2-1 cue over the last 3 s.
  - `keyboard.ts`: held set by `code`, `repeat` ignored, tap latch (a sub-frame tap still takes over once), cleared on
    `blur` / hidden `visibilitychange` / `contextmenu`; text inputs (engineer box) never read; modifiers ignored;
    preventDefault only while driving; Enter (not on a focused button/radio) = toggle; R (Manual only) = reset.
  - `index.ts`: provides `DRIVE`; per frame arbiter → `sim.current.drive.setIntent` (Manual only); fresh edge in
    Auto/Returning → `drive:request {manual}`; Enter / pill / idle → `drive:request {auto, immediate:true}` (+ unpause);
    R → `drive:reset {}`; a driving key while paused unpauses. Vehicles without a plant (motorcycle, and every vehicle
    until 08-02's plant lands) never emit a request: the pill reads "Auto only for this vehicle" and pulses on a
    takeover attempt.
  - Pill: one toggle button (one tab stop, `aria-pressed`, name "Driving mode: Auto. Take the wheel" / "… Manual. Hand
    back to Auto"; `aria-disabled` + explanation when unavailable), sliding thumb over AUTO | MANUAL, the key that
    switches shown on the target segment, speed (km/h via `format.ts`) and gear in Manual, accent border while driving.
    Hint line above the pill (prompt / controls / idle cue, `aria-hidden`); one polite live region: one announcement per
    mode change, one when the idle cue starts. Hidden with the HUD (H) and in attract; the idle cue stays visible with
    the HUD hidden. 36 px toggle (44 px on coarse pointers), tokens only, reduced motion via the token durations.
  - `drive.css`: bottom centre directly above the suspension control; reserves its rows through `--sl-hud-drive-h`
    (and `.sl-drive-action` row for 11-03/11-04 chips).
- **controls**: `keyAction` returns null for a/s/w/d outside Auto; Live chip while driving emits the immediate release;
  help card lists "Take the wheel" in Auto and the driving keys in Manual (only when DRIVE is provided); canvas label
  says "driven by you" in Manual; `controls.css` splits `--sl-hud-susp-h` = `--sl-hud-susp-base-h` (96 px) +
  `--sl-hud-drive-h`, so the insight caption stacks above the pill without insights changing.
- **attract**: `gate.ts` `attractMayRun` (Auto only). Never starts (idle timer held at 0 outside Auto; `store.attract`
  set while driving is reverted); a takeover during attract ends it and does not restore clock/paused/timeScale over the
  kernel's driving clock. Any key already exits attract (user:activity), so driving input always wins.

## Tests
- `tests/features/drive.test.ts` (13): code→intent table, Auto/Manual capture sets, fresh-press takeover and no flicker
  while held, neutral-before-retake across two sources, hysteresis, source removal, idle cue/hand-back timing (12/30 s),
  prompt window, keyboard source with a DOM shim (held set, repeat, blur/visibility/contextmenu clear, tap latch, text
  input ignored, preventDefault only in Manual, Enter/R/modifier rules).
- `tests/features/controls.test.ts` +1 (a/s/w/d null outside Auto), `tests/features/attract.test.ts` +2.
- `tests/e2e/08-03-drive.spec.ts`: pill in Auto (+ prompt when drivable), motorcycle "Auto only", W/Enter do not take
  over there, S still slow motion; driving test (↑ takeover, speed > 8 m/s after `advance(3)`, ← yaw increases, ↓ to
  standstill then reverse u < 0, R at rest on the loop, Enter → auto with ↑ still held not retaking) — skipped when the
  build has no plant.

## Verification (real output)
- `npm run check` at HEAD 693db86 + this plan's final CSS fix: typecheck clean; depcruise `✔ no dependency violations
  found (239 modules, 765 dependencies cruised)`; vitest `Test Files 68 passed | 1 skipped (69)`, `Tests 770 passed | 11
  skipped (781)`. (One earlier run showed `simulation.test.ts` step-cost failing at 7218 ms while Playwright ran in
  parallel; it passes alone and in the final run.)
- **e2e against the real 08-02 plant** (private `vite build --outDir <scratch>`, `vite preview --port 4191`, `--trace
  off`, `.wrangler/deploy/config.json` restored after the preview was up; served bundle hash checked):
  `tests/e2e/08-03-drive.spec.ts` → `✓ the pill in Auto and the motorcycle says Auto only (1.5m)`, `✓ keyboard: take
  over, accelerate, steer, reverse, reset, hand back (1.0m)`, `2 passed (2.5m)`, zero console/page errors.
  `tests/e2e/07-03-a11y.spec.ts` on the same build → `4 passed (4.7m)` (contrast min ratios follow 5.53, explore 5.62,
  help card 4.81).
- Screenshots (1280×720): `08-03-auto-pill.png` (Auto pill + "Press W or ↑ to take the wheel"), `08-03-manual-hint.png`
  (Manual, 59 km/h, gear 2, control hint above the pill), `08-03-moto-pill.png` ("Auto only for this vehicle") in the
  orchestrator scratchpad `shots/`.

## Deviations / notes
- §10.2 says "idle cue at 9 s, hand-back at 12 s (×2.5 with ?screen=1)"; I scale the hand-back (30 s, decision 5) and
  keep the cue at the last 3 s (27 s) so the countdown always reads 3-2-1.
- Idle time is wall-clock render time without any input (keys, pointer, wheel, deliberate source input), also while
  paused, so an abandoned paused booth still returns to Auto.
- The Auto prompt re-arms after every hand-back (not "once per device"): an event booth sees many visitors.
- `__app.drive()` exposes no `lineOffset`, so the e2e "R → near the line" checks speed < 0.5 m/s and `zone === 'loop'`.
- The e2e needs generous timeouts (240 s per test): under SwiftShader the page renders a few frames per second, and
  the Auto prompt waits on wall-clock render time.
- Found in screenshots and fixed before the final run: the hint initially rendered below the pill (column-reverse).
