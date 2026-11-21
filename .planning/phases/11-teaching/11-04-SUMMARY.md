# 11-04 SUMMARY — Same line, different suspension (A/B ghost)

## Built
- **`src/sim-core/ghost/ghost.ts`**
  - `buildCourse(span, makeSim)`: two exact re-simulations of the span (11-03 `DriveHost.play`) in fresh simulations.
    Pass 1 finds the compared stretch: the longest run of ticks driven forwards at ≥ 2 m/s with no reset /
    suspension / aids event inside (≥ 4 s and ≥ 25 m, else `'short'`). Pass 2 stores, per tick of the stretch, the
    visitor's distance travelled, the command the plant applied (steer target, pedals, handbrake) and the yaw rate,
    course (yaw + sideslip) and forward speed; every 0.5 m of travel the line point (→ `recordedLine`) and the visitor's
    traces; the plant snapshot at the stretch start.
  - `createGhostDriver` (the disclosed driver model; `DRIVER_MODEL` is its whole parameter set): feed-forward = the
    visitor's own command at the tick where the visitor was at the ghost's projected s (zero-order hold, as applied);
    feedback = CG offset and course error against the visitor's course there, gains from the speed-dependent yaw gain
    (ω 2.5 rad/s, ζ 0.9), yaw-rate feedback 0.1 against the visitor's yaw rate, offset integral, speed PI on the
    visitor's speed. Not `drive/path-driver.ts` (untouched): with the same suspension its feedback stays near zero.
  - `createGhost(sim, course, traces)`: a fresh simulation's plant restored at the stretch start, stepped by the driver;
    stops at the line's end, when > 3 m off (lost), stopped or timed out; `pose(alpha, amp)` → TelemetryFrame for
    rendering. `runGhost` = headless run with traces.
- **`src/sim-core/ghost/compare.ts`** `compareRuns(visitor, A', B)`: noise floor per channel = max |A' − visitor|; a
  difference counts when its peak > max(3 × floor, floor of notice: steer 0.25°, slips/sideslip 0.25°, roll 0.2°,
  offset 0.1 m); verdict `refused` (A' > 0.25 m off or not finished: no conclusion), `lost` (B > 0.5 m off), `same`,
  `different`; steering effort Σ|δ_B| / Σ|δ_A'| − 1.
- **`src/features/ghost-lab/**`**: "Compare" chip (`.sl-drive-action`, label in `.sl-drive-action-label`, adopted by
  11-05's action row) and G; takes `last(29)` (re-requested after a reset/swap inside it); runs course, A' and B
  headless (~1 s, after a "Comparing…" paint); replays the span (`drive:play`) with the ghost stepped in lockstep with
  `DriveHost.replay.tick`. Ghost = a second instance of the vehicle's own visual from the registry, `setXray(1)`: its
  fresnel shell, wheels take the shell material, body/brake meshes hidden, amber tint, no shadows: **5 draw calls**.
  Panel (right column above the view control; top right below 1100 px; compact sheet without chart on phones):
  legend, target picker (other types + "Same (control)"), 6-row strip chart vs distance (A accent, B amber, cursor
  following the ghost, Δ shown only when it counts, "≈" otherwise), one sentence, the driver-model caption with the
  measured repeat error (always shown with the traces; the ghost hides with the HUD). Clears on reset, vehicle or
  suspension swap, hand-back, another replay, close/Escape.
- Tests: `tests/sim-core/ghost.test.ts` (7), `tests/features/ghost-lab.test.ts` (7), `tests/e2e/11-04-ghost.spec.ts` (2).

## Measured (real output)
Unit (gamepad-like visitor, Node):
| run | A/A repeat (max off line / steer floor) | B | verdict |
|---|---|---|---|
| steering pad 15 m/s, strut → multi-link | 0.1 cm / 0.03° | 4.4 cm off, steer +5.8 % | different [steer] |
| steering pad, strut → double wishbone | 0.1 cm | 0.4 cm, −0.1 % | same |
| slalom 14 m/s, strut → multi-link | 1.1 cm | 5.6 cm, +2.8 %, sideslip | different [steer, sideslip] |
| slalom, strut → double wishbone | 1.1 cm | 1.2 cm, +0.1 % | same |
| loop, 11-03 keyboard driver (spins), DW → ML | 2.1 cm | 8.1 cm | different |

The +5.8 % on the pad matches the 09-04 understeer gradients (0.75 vs 1.20 °/g at 0.57 g → +5.6 %). A/A runs identical,
the identical-tables control (a copy of the strut under another id) bit-identical (peak Δ 0); live trace-free ghost =
headless run exactly; driver heap churn 0.07 B/step after warm-up.

e2e (Chromium, private build, scripted intents):
- steering pad (strut, ~24 m/s, near the limit): A/A **0.1 cm**; vs double wishbone 4 cm, steer −0.8 % → **same**;
  vs multi-link: steer +6.1 %, front slip 1.98→2.80°, rear 2.21→3.22°, sideslip 1.68→2.55°, **61 cm off line → lost**
  ("could not hold your line"); control → "repeats your drive to within 1 cm".
- slalom (multi-link): A/A **1.0 cm**; vs strut: steer −7.3 %, sideslip 0.66→0.87°, rear slip +0.3°, 15 cm off line →
  different ("sideslip differed by up to 0.4°…, and the autopilot strayed up to 15 cm from your line").
- Ghost 5 draws; hand-back clears; zero console errors.
- Screenshots (looked at): `…/scratchpad/shots/11-04-pad-ghost.png`, `11-04-pad-multilink-ghost.png`,
  `11-04-pad-multilink-explore.png` (ghost beside the car), `11-04-pad-control-ghost.png`, `11-04-slalom-ghost.png`,
  panels `11-04-pad-ab-panel.png`, `11-04-pad-multilink-panel.png`, `11-04-pad-aa-panel.png`,
  `11-04-slalom-ab-panel.png`, `11-04-slalom-aa-panel.png`.

## Deviations
1. ARCH §7.14 says both runs use the SAME `PathDriver`; they use the same **ghost driver** instead (the brief: the
   PathDriver lags abrupt manoeuvres 0.4–3 m, which would be reported as suspension). The driver is identical for A
   and B and disclosed.
2. The A/A control is A' vs the visitor (the noise floor) in addition to A vs A (determinism) and identical tables.
3. Chart rows add sideslip and off-line (tracking error) to MD-44's steer, front/rear slip, roll.
4. Floors of notice and the 0.25 m / 0.5 m thresholds are design choices (stated in `compare.ts`).
5. The comparison starts at sample 1 (a just-restored plant samples its start state without its previous step).

## Known gaps / notes
- When ghost and car coincide (same / near-same suspension) the car reads amber-tinted under the shell.
- Phone/tablet layouts not screenshot-tested (compact sheet below 700 px / 520 px high, chart hidden); 11-05 is
  still reshaping the dock.
- A sampling heap profile (collected objects included) of a whole ghost step shows allocation sites inside the
  plant's ground/projection (`world/project.ts nearest`, `world/ground.ts sample`, `plant.locate`), not in ghost code;
  the live ghost runs the same plant code as the main car (plant-no-alloc covers it).
- No golden changed; no contract, `drive/*` or `features.ts` edits.

## Verification
- `npm run check`: typecheck clean; `✔ no dependency violations found`; `Test Files 1 failed | 100 passed | 1 skipped
  (102)`, `Tests 1 failed | 999 passed | 11 skipped (1011)` — the failure is 10-02's `world-zones` "sample does not
  allocate" (timeout under parallel load); alone `Tests 8 passed (8)`.
- Mine: `ghost.test.ts` 7 passed, `ghost-lab.test.ts` 7 passed; e2e `11-04-ghost.spec.ts` **2 passed** (private
  build `--outDir <scratch>/dist-1104`, `vite preview --port 4314`, wrangler config restored after the preview was up,
  `--trace off`, `?quality=low`).

## Lifted code
None (Stanley/pure-pursuit not used; the gains come from the linear single-track yaw gain).
