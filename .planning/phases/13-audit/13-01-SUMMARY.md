# 13-01 SUMMARY — Matrix, audits, runbook, final deploy

## Built / fixed (one commit each unless noted)
1. **Returning allocation (task 1).** A sampling heap profile (incl. collected objects) showed the Manual and Returning
   steps allocate short-lived boxed doubles at calls V8 does not inline (~22–23 KB/step; Auto ~4.3). **Bisect: the same
   reading at 10-01's own commit (7e2d47f), 11-03, 11-05 and HEAD — no later plan regressed it.** The test's reading
   depended on the young generation grown by the heavier tests earlier in the same file (it passed alone with `-t`).
   Fixed the biggest sources, bit-identically: the projection's Newton iterations ran the full `track.sample` (6 trig
   calls + elevation/bank/grade) → `planPoseOf(track)` plan-only pose + `dsincos` (sin/cos into a scratch, no boxed
   return); `advancePoseAt(plan, i, u)` (1 double argument instead of 6); node distances written out in the candidate
   loops. **Returning 23.4 → 13.6 KB/step, Manual 22.4 → 11.5, Auto 4.3 → 3.7** (rate measured without the profiler as
   the sum of positive `heapUsed` deltas per step). Not zero, and reported as such. The Returning tripwire moved to its own
   file `tests/sim-core/returning-no-alloc.test.ts`, the same conditions as the M1 `no-alloc` and `plant-no-alloc`
   tripwires. Its bound is unchanged (1500 B/step); 5/5 runs gave 399–784 B/step, median step 19.4–20.5 µs (≤ 25).
   Goldens, the replay golden and `runDriveScript` unchanged; `det-math` asserts `dsincos` and `planPoseOf` bit-identical.
2. **Requirements audit (task 2)** → `13-01-AUDIT.md`: **37 MET · 8 PARTIAL · 0 NOT MET · 2 STRETCH-SKIPPED**;
   REQUIREMENTS-M2 checkboxes follow it. Audit fixes: MD-07 "Off the live lap" + Rejoin + 20 s idle re-sync (nothing read
   `detached`); MD-18 "Reset to road" after 3 restores in 2 s (fault events had no consumer); MD-45 the sound button labels
   the tyre sound a model cue; MD-22's literal check (hold ← at 100 km/h, aids on: no spin, peak sideslip ~16°).
3. **Feature-off matrix (task 3)** `tests/e2e/13-01-matrix.spec.ts`: all 29 features off alone, all M2 off, every
   feature off; the requires cascade (table checked against the sources); clean boot, lap runs, M2 DOM gone, the driving
   probe takes the wheel/drives/hands back whenever `drive` (and the coupe) is on and never otherwise; offline Manual;
   `-proving-ground` removes the annex from physics (station spawn lands on the loop); Manual at all five stations with
   zero console errors. (07-04 never ran, so there was no M1 matrix to extend; this one covers M1 features too.)
4. **Copy and honesty audit (task 4)**: `tests/arch/content-copy.test.ts` now covers world/station copy, coach
   templates, engineer fact cards, labels, chips and rule answers, HUD strings and a source scan of inline strings:
   no digits; a sentence with a ranking word must be a negation or one of three listed non-ranking uses; models
   labelled. Found and fixed: the idle announcement's hard-coded "3 seconds"; the rule answer "a strut is the cheapest …
   a double wishbone controls camber best" and the card's "typically the best camber control". Stale texts fixed:
   `drive/events.ts` header (strike/hard-stop are DriveEvent kinds since 11-05), drive-plant's "no ABS in v0".
5. **Credits (task 5)**: CREDITS.md + panel + `code-credits.ts`: stdlib-js (full Apache-2.0 text, the NOTICE line, the
   changes made), the stdlib LICENSE "DEPENDENCIES & ATTRIBUTION" verbatim (FreeBSD and FDLIBM Sun notices, Go BSD-3),
   msun's 1993 notice; Go math, fdlibm, Jolt, Godot-Easy-Vehicle-Physics, ArcadeCarPhysics, PythonRobotics, folio-2025,
   V8 (hypot idea), Chrono ChPac02Tire ideas, the 1€ filter paper. Texts taken from the npm tarballs; LICENSE files of
   Jolt, GEVP, ArcadeCarPhysics, PythonRobotics, folio-2025, V8, Go and Chrono re-checked today (raw GitHub).
   `det.ts` states its changes (Apache-2.0 §4(b)). The credits test checks every row and every notice.
6. **AI budget (task 6)**: `ENGINEER_LIMITS.dailyModelCalls` 300 → 280 (280 × 30 neurons = 8.4k ≤ 85 % of 10k; test).
7. **`docs/EVENT-RUNBOOK.md` (task 7)**.
8. **Planning docs (task 8)**: ROADMAP-M2 status per plan; STATE.md (M2 close, stretch cuts, known gaps, stale M1
   position fixed); ARCHITECTURE-M2 §17 reality notes (contract blocks untouched, verbatim test green).

## Deviations
- Task 1's premise ("something added since allocates") was not confirmed: the bisect shows the same churn at 10-01.
  The fix reduces real allocation by about 45 %. The tripwire passes again because it now runs in its own worker,
  like the M1 tripwires. The bound is unchanged.
- MD-07 and MD-18 landed in one commit (same drive files).
- MD-18's UI path is unit-tested only: the app sanitises non-finite intents, so no e2e can force plant faults.
- The MD-07 idle re-sync is off under `?e2e=1` (like attract's idle start), so no automated check covers it.

## Verification
(see below)
