# 09-05 SUMMARY — Handling HUD: aids, lamps, approximate badge

## Built
- `src/features/drive/hud.ts` (pure): `AID_KEYS`/`AID_COPY` (Anti-lock brakes, Traction control, Stability control,
  Steering help — no brand names, no digits), `withAid`, `aidsSummary` (button tag '' / "Some off" / "Off" + accessible
  name ending "Assist: simplified model"), `LAMPS` (abs, traction, stability, approximate), `updateLamps` (flags from
  `frame.drive`, 0.6 s hold so a pulsing aid reads as one lamp, all dark outside Manual), inline icons.
- `index.ts` + `drive.css`, Manual only (Auto pill unchanged — the car stays the teacher):
  - Lamps inside the pill after speed/gear: icon + text chip with a warn border, present only while lit (never colour
    alone); Approximate badge dashed.
  - Assists button (sliders icon, title "Assists", OFF / SOME OFF tag when an aid is off; `aria-expanded`/`controls`).
    Popover centred above the pill: "Assists · Assist: simplified model", four `role=switch` checkboxes with name +
    described-by hint, 44 px rows (52 px coarse), knob side shows the state. Writes `store.driveAids` (kernel forwards
    to `sim.drive.setAids`). Escape (preventDefault, focus back to the button) and outside click close; closes on
    hand-back / HUD hidden / attract; a pointer toggle blurs the switch so driving keys keep working. Inherits
    `--sl-hud-zoom`; reduced motion via token durations. Lamps/popover do not change any reserved row height
    (`--sl-drive-action-h` untouched).
- Telemetry "history only in Auto": already implemented and tested by 08-05 (`history.ts`, telemetry-panel test); no
  edit needed, telemetry-panel files untouched.
- Orchestrator extra: `tests/e2e/04-05-layout.spec.ts` now lists `.sl-drive-pill`, `.sl-drive-hint`,
  `#overlay > .sl-drive-action`, `.sl-drive-aids-panel` (popover over its own hint/action row allowed), canvas probes
  computed from the gaps between measured HUD boxes plus a coarse grid, and a Manual pass with the popover open at
  1280×720 and 1920×1080.

## Verification (real output)
- Unit: `tests/features/drive.test.ts` 17 passed (4 new: copy, withAid/summary, lamp hold/dark outside Manual,
  synthetic ABS frame).
- `npm run check`: typecheck clean; depcruise `✔ no dependency violations found (242 modules, 805 dependencies
  cruised)`; vitest `Test Files 1 failed | 73 passed | 1 skipped (75)`, `Tests 1 failed | 818 passed | 11 skipped` —
  the one failure is `tests/zz-scratch-ground.test.ts` (another executor's untracked scratch file, not mine).
- e2e on a private build of the tree at 0be52bb (+ these specs; includes 09-04's aid wiring 60fadbf), `vite preview
  --port 4237`, `--trace off`, `?quality=low`, `.wrangler/deploy/config.json` restored after the preview was up:
  - `09-05-hud.spec.ts`: ✓ popover/store/traction lamp/approximate badge (52.2s), ✓ ABS lamp on a scripted hard stop
    (19.0s). (Written as `test.fixme` while 09-04 was pending; enabled after 60fadbf landed and it passed.)
  - `04-05-layout.spec.ts`: ✓ desktop (2.5m), ✓ big screen (1.8m).
  - `08-03-drive.spec.ts`: ✓ both (test 1 first timed out at boot `waitForReady` 20 s under load, passed on rerun 55.2s).
  - `07-03-a11y.spec.ts`: 4 passed.
  - An earlier run (build containing 09-04 mid-work files) failed 08-03's yaw check; a baseline build of HEAD 18add86
    without my drive changes passed, and the rebuilt tree passes — it was the transient plant state, not the HUD.
- Screenshots: `…/scratchpad/shots/09-05-aids-1280.png` (popover open), `09-05-lamp-1280.png` (Traction + Approximate
  lit), `09-05-approx-1920.png` (Approximate, Assists OFF tag), plus 04-05 `manual-aids-*`.

## Known gaps
- Stability lamp: unit-tested with synthetic frames only (no e2e manoeuvre asserts it).
- Lamp contrast is not in the 07-03 measured walk (that runs in Auto); lamp text is `--text-1` on `--glass`.
- With all four lamps lit at 1280×720 the pill is 590 px wide, 5 px clear of the telemetry card (forced-DOM check).
