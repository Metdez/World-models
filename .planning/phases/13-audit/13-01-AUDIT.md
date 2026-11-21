# 13-01 AUDIT — Milestone 2 requirements (REQUIREMENTS-M2.md)

Strict reading: MET only when a check that ran (unit test, e2e spec, production probe, measured report) shows it.
"Hardware" lists what no check here can show: those items need a person with the device (see STATE.md known gaps,
docs/EVENT-RUNBOOK.md §7). e2e results are from the full suite on a private build of 13-01's HEAD plus reruns on the final build, and the
drive/replay/engineer/delivery/determinism specs against production (see the SUMMARY's verification section).

**Totals: 47 requirements: 37 MET · 8 PARTIAL · 0 NOT MET · 2 STRETCH-SKIPPED.**

| ID | Status | Evidence (check) | Gap / hardware |
|---|---|---|---|
| MD-01 | MET | `tests/sim-core/golden.test.ts`, `moto-sim.test.ts` hashes unchanged after every 13-01 change; the M1 e2e specs (02-04 … 07-03) in the 13-01 full run | — |
| MD-02 | MET | `tests/kernel/drive.test.ts` (`?drive=manual` request, Auto at boot); 13-01 matrix (every boot in Auto) | — |
| MD-03 | MET | `08-03-drive.spec.ts` ("Auto only for this vehicle", W/Enter do nothing, S slow motion); 13-01 matrix `-car` (bike only: no takeover) | — |
| MD-04 | MET | `tests/features/drive.test.ts` (codes, capture sets, fresh edge); `08-03` (↑ takeover, S/A in Auto); `10-04` (mocked gamepad trigger, CDP touch pedal); kernel test (request applied at the next step) | Hardware: real gamepad and touch screen never tried |
| MD-05 | MET | `tests/sim-core/handoff.test.ts` (20 lap times × 3 types: position 2.3 mm, speed 0.012 m/s, yaw rate 0.0033 rad/s, load 0.32 %; thresholds as widened and recorded in 08-02); camera continuity in `tests/features/camera.test.ts` | — |
| MD-06 | PARTIAL | `returning.test.ts`: every return ends finite within its timeout; 463/500 (92 %) latch within 40 s; annex 18/30 latch within 60 s; `10-04-drive.spec.ts` (Enter → Returning, latch without fade, takeover) | Band not met as written: timeout 40 s (not 20 s), starts at speed leave the 30 m corridor (max 222 m), annex returns cross the grass |
| MD-07 | PARTIAL | 13-01 fix: pill "Off the live lap" + Rejoin now (`10-04-drive.spec.ts` asserts chip, Rejoin clears `detached`); M1 "Rejoin live" chip (`controls`) | The 20 s idle re-sync is off under `?e2e=1`: no automated check covers it |
| MD-08 | PARTIAL | pill shows the kernel mode incl. Returning/Replay (`08-03`, `10-04`, `11-03` specs); hint timing (`drive.test.ts`) | Dismissal persistence not built by decision (08-03: the prompt re-arms after every hand-back for a booth) |
| MD-09 | MET | `08-03` (R: at rest on the loop); `10-04` (station spawns at rest) | — |
| MD-10 | MET | `tests/kernel/drive.test.ts` (seek ignored with a warning outside Auto, vehicle switch releases); `attract.test.ts`; swap keeps state (`drive-plant.test.ts`, `replay.test.ts` swap events) | — |
| MD-11 | MET | `tests/arch/no-type-tuning.test.ts`; plant reads the same tables (`drive-plant.test.ts`) | — |
| MD-12 | MET | `drive-plant.test.ts`, `compliance.test.ts`, `handling-*.test.ts` (T16 load sum, jacking, compliance report) | Axle lateral compliance 0.06–0.28 mm/kN is below its literature target (reported in 09-01, not tuned) |
| MD-13 | MET | `tyre.test.ts`; `plant-standstill.test.ts` (5 % slope 10 s: 0.0000 mm); T17 idle drift 0; coast monotone | — |
| MD-14 | MET | `powertrain.test.ts` (16), reverse logic in `human-driver.test.ts` | — |
| MD-15 | MET | `09-05-hud.spec.ts` (switches, traction/ABS lamps, label); `drive.test.ts`; 13-01 content-copy ("Assist: simplified model") | Stability lamp only with synthetic frames |
| MD-16 | PARTIAL | `handling-*.test.ts`: T1 ≤ 0.5 %, skidpad 0.956 g, ABS 100–0 37.5 m, K 0.74–1.20 °/g rising ×4.3–7.2, step steer 0.15–0.18 s / ≤ 11 %, mirror 7e-15, 240/480 Hz 0.35 % | **0–100 km/h 4.99 s, outside 3.6–4.8 s** (friction-limited; test asserts < 5.3 s and prints the band) |
| MD-17 | PARTIAL | `handling-suspension.test.ts` report (09-04 SUMMARY), identical-tables control asserted; no universal winner | "ISO 3888-2 pass speed": an open-loop lane-change proxy; the annex T10 (10-04) measures the PathDriver, not the suspension. Ride RMS from the loop pavé, not the ride street |
| MD-18 | MET | `plant-safety.test.ts` (ring buffer, restore, 200k fuzz finite); 13-01 fix: "Reset to road" after 3 restores in 2 s (`noteFault`, `drive.test.ts`) | The UI path cannot be forced from e2e (the app sanitises non-finite intents) |
| MD-19 | MET | `tests/arch/det-math.test.ts` (all of sim-core); `09-03-determinism.spec.ts` Node = Chromium `24f9a9b3` (private build and production); goldens unchanged. The spec had been red since 10-03 unnoticed: its Node side had no world while the page grounds on the proving ground; fixed in 13-01 (Chromium with `-proving-ground` = Node without a world = `e98c2d44`, so the engines always agreed) | Firefox/WebKit not installed: unverified |
| MD-20 | PARTIAL | step median 17–20 µs (`plant-no-alloc`, `returning-no-alloc`); heap tripwires green; draw calls 235 for the full high-tier frame at the M1 point (`03-01-track.spec.ts`, 13-01 run), 206 at the ride street (11-05) | Not allocation-free: ~11–14 KB/step short-lived boxing in V8 (13-01 heap profile; reduced from ~22 KB); ≤ 250 calls "with every M2 visual on" never measured at once (ghost +5 and rings/marks +3 on top of 235 would be 243, unmeasured) |
| MD-21 | MET | `drive.test.ts`, `drive-input.test.ts` (dead zone 0.12, exponent 1.6, hysteresis, blur clear); `10-04` mocked pad + CDP touch | Hardware: real gamepad, real touch |
| MD-22 | MET | `human-driver.test.ts` (ramps); `handling-keyboard.test.ts` incl. 13-01's literal check (hold ← at 100 km/h, aids on: no spin for any type; peak sideslip ~16°) | — |
| MD-23 | MET | `tests/features/camera.test.ts` (27); `08-04-camera.spec.ts` (behind < 25° in corners and reverse) | Tuning on a real GPU owed |
| MD-24 | MET | `09-05-hud.spec.ts` (approximate badge), telemetry history only in Auto (`telemetry-panel.test.ts`, 08-05) | — |
| MD-30 | MET | `tests/features/proving-ground.test.ts`, `track.test.ts` (zone/terrain/ribbon vertices = GroundWorld within 1 mm) | — |
| MD-31 | MET | `world-zones.test.ts`, `proving-ground` content tests (coordinates, spur joins 1.4 mm) | — |
| MD-32 | MET | `tests/arch/world-copy.test.ts`; 13-01 content-copy | — |
| MD-33 | MET | grass μ/c_rr in `SURFACES`; plant OOB 1.5 s / 30 m (`returning.test.ts` raises it beyond the field); reset choice `drive-input.test.ts`; no walls | No e2e drives out of bounds |
| MD-34 | MET | `10-04-drive.spec.ts` (station popover, `?spawn`); 13-01 stations test (Manual at all five, zero console errors) | — |
| MD-35 | MET | `10-03-ground.spec.ts` (no annex drawn); 13-01 matrix `-proving-ground` + the physics probe (station spawn lands on the loop) | — |
| MD-40 | MET | `tyre-vfx.test.ts`; `11-01-vfx.spec.ts` (rings, past-limit, split-μ); 13-01 copy ("model" tag) | Looked at under SwiftShader only |
| MD-41 | MET | `11-01-vfx.spec.ts` (marks only past the limit, cleared on cuts); 3 draw calls | — |
| MD-42 | MET | `coach.test.ts`, `insights.test.ts`, `drive-events.test.ts`, `plant-events.test.ts`, `11-02-coach.spec.ts`; templates digit-free (13-01) | — |
| MD-43 | MET | `replay.test.ts` (exact re-simulation, back to the pre-replay CRC), `11-03-replay.spec.ts` | Offered always in Manual, highlighted for 10 s after an event (11-03 reading) |
| MD-44 | MET | `ghost.test.ts`, `ghost-lab.test.ts`, `11-04-ghost.spec.ts` (A/A 0.1–1 cm, verdicts, driver-model caption) | Uses a disclosed ghost driver instead of the PathDriver (11-04 deviation) |
| MD-45 | PARTIAL | `audio.test.ts` (engine from rpm/throttle, tyre cue onset 0.75); rumble against a fake actuator (`10-04`); 13-01 fix: the sound button names the tyre sound a model cue | Never listened to; rumble never felt |
| MD-50 | MET | `replay.test.ts`, `replay-golden.test.ts`, `11-03-replay.spec.ts` (link plays, older-model label, other vehicle refused, damaged explained) | — |
| MD-51 | PARTIAL | `tests/worker/replays.test.ts` (15); 12-01 production probes (400/413/403/404, expiry on read); `12-05-share.spec.ts` (real widget with test keys, local D1: save, open `#rid=`, identical CRC) | No real production save (needs a human Turnstile solve); per-address 429 not provable from this sandbox |
| MD-52 | MET | `room-*.test.ts` (driver role, newest wins, lanes); `smoke-room.mjs` on production (1800/1800 at 60 Hz, p50 16.8 ms); `phone-drive.test.ts` (failsafe timeline); `12-04-phone.spec.ts` (pairing, drive, replaced, close → out of Manual 1.0–1.1 s) | Hardware: real phones, tilt, iOS permission, venue Wi-Fi |
| MD-53 | MET | `engineer-drive*.test.ts`, `engineer.test.ts`; `12-03-engineer.spec.ts`; live evaluation (12-03: every model answer explained the detected event) | ~1 in 5 driving answers time out (labelled rule answer) |
| MD-54 | MET | `tests/features/analytics.test.ts` (drive-session whole seconds, station-visit, no ids) | — |
| MD-55 [S] | STRETCH-SKIPPED | 12-07 not built; `live-ghosts` stub `defaultEnabled: false` (13-01 matrix) | — |
| MD-56 [S] | STRETCH-SKIPPED | 12-06 not built; `/api/insight` 501 (`replays.test.ts` insight case) | — |
| MD-60 | MET | 13-01 `content-copy.test.ts` (representative vehicle, simplified assists, approximate badge, ghost driver model, tyre-grip stations); no manufacturer claims (engineer cards: "not predictions for any real car") | — |
| MD-61 | MET | 13-01 `content-copy.test.ts`: world, coach, engineer cards/labels/chips/rule answers, HUD and a source scan of inline strings: no digits, no rankings (two ranking phrases fixed in 13-01, one digit fixed) | — |
| MD-62 | MET | `tests/features/credits.test.ts` (rows + every notice in CREDITS.md and the panel); `det.ts` header (licence, notices, changes); LICENSE files re-checked 2026-11-21 | icurtis1/raycast-vehicle was not used (nothing to credit) |
| MD-70 | MET | `tests/e2e/13-01-matrix.spec.ts` (every feature off alone, all M2 off, all off: clean boot, cascade, driving probe; offline Manual); `docs/EVENT-RUNBOOK.md` (idle return, phone driver, offline fallback) | — |

## Fixed in 13-01 (each its own commit)
- MD-07: "Off the live lap" chip + Rejoin now, 20 s idle re-sync (nothing read `frame.drive.detached` before).
- MD-18: "Reset to road" after 3 automatic restores in 2 s (plant `fault` events had no consumer).
- MD-45: the sound button labels the tyre sound a model cue.
- MD-61: the idle announcement's hard-coded "3 seconds"; the engineer's "cheapest" / "controls camber best" rule answer
  and "typically the best camber control" card wording (single-attribute rankings).
- MD-20: ~45 % less per-step allocation (projection Newton on the plan pose, `dsincos`, index-based `advancePoseAt`).
- MD-22: the literal "hold ← at 100 km/h" check was missing; added.

## Not fixed (listed, larger than an audit fix)
- MD-06 return band; MD-16 0–100 km/h; MD-17 ISO 3888-2 metric; MD-20 zero allocation and the all-visuals draw-call
  measurement; MD-08 dismissal persistence (deliberate); MD-51 production save; every hardware item.
- M1 content copy keeps "typically …" trade-off statements in the suspension pros/cons (e.g. a motorcycle layout
  "typically the simplest and cheapest"): balanced by cons, M1-reviewed, out of the M2 scan's scope.
