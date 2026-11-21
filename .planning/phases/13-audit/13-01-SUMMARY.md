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

9. **Found by the full e2e run and fixed**: the Compare target picker was four tab stops with none checked (07-03's
   radiogroup rule) → roving tabindex + arrows; the phone-driver card overlapped the poll and the trace on the
   1280×720 big screen → folds to its status line while a poll is open; 04-05 did not know the phone-drive card;
   09-03 compared a world-less Node run with the page's proving-ground run (red since 10-03; the engines agree); the
   matrix's "every feature off" case (the kernel falls back to the built-in coupe).

## Deviations
- Task 1's premise ("something added since allocates") was not confirmed: the bisect shows the same churn at 10-01.
  The fix reduces real allocation by about 45 %. The tripwire passes again because it now runs in its own worker,
  like the M1 tripwires. The bound is unchanged.
- MD-07 and MD-18 landed in one commit (same drive files).
- MD-18's UI path is unit-tested only: the app sanitises non-finite intents, so no e2e can force plant faults.
- The MD-07 idle re-sync is off under `?e2e=1` (like attract's idle start), so no automated check covers it.

## Verification (real output)
- `npm run check` on the final code: typecheck clean; `✔ no dependency violations found (285 modules, 1009
  dependencies cruised)`; `Test Files 107 passed | 1 skipped (108)`, `Tests 1126 passed | 20 skipped (1146)`.
- **Whole e2e suite** on a private build of `eb6de1c` (own outDir, programmatic preview port 4613 with local D1 + the
  Turnstile test secret, `.wrangler/deploy/config.json` restored after the preview was up, `--trace off`):
  **115 run: 106 passed, 6 failed, 3 skipped (Firefox/WebKit and one live case), 1.5 h.** The 6 failures:
  04-05 big screen (phone card overlap: app fix + spec list), 07-03 keyboard (picker: app fix), 09-03 (spec: Node
  world), 13-01 "every feature off" (spec), 06-02 chips and 11-05 annex budget (load timeouts).
- **Reruns on the final builds** (`d07a700` / `501dc08`, same preview setup): 04-05, 06-02, 07-03, 09-03, 11-04 and the
  whole 13-01 matrix (37 tests incl. the offline, MD-35 and five station tests) → `50 passed, 1 failed, 3 skipped` (the
  1 = the 04-05 overlap, then fixed); 04-05 + 12-04 + 06-04 → `6 passed`; 11-05 annex budget alone → `1 passed`
  (t=14 193 calls / 1 496 499 triangles; ride street 206 / 1 246 227). **Every e2e test passes on the final code**;
  the two load timeouts passed alone and are not code failures.
- **Deploy** `npm run deploy` from a clean tree at `5b9fc7b`: Version ID `508e0dd4-8e90-4807-a4dd-7cadd8cd7199`;
  `/api/health` → `"version":"5b9fc7b"`. (Later commits are docs only.)
- `npm run smoke:live` → `smoke-live: all checks passed`. `node scripts/smoke-room.mjs <prod>` → `smoke-room: all checks
  passed` (driver 60 Hz × 30 s: 1800/1800, relay p50 15.2 / p95 16.9 / max 64.3 ms; newer driver 4409).
- Against production: 06-02 (3), 07-02 delivery (2, zero CSP violations), 08-03 (2), 10-04 (6), 11-03 (2), 12-03 (1)
  → 16 passed; 09-03 timed out at boot in that batch and passed alone (`node 24f9a9b3, chromium 24f9a9b3`).

## Still unverified (needs a person or hardware)
Real GPU look and frame rate (all judging under SwiftShader); audio by ear; real gamepad, touch screen, phone tilt,
iOS permission, haptics; the phone driver on venue Wi-Fi; a production replay save (human Turnstile solve);
Firefox/WebKit determinism; ≤ 250 draw calls with every M2 visual on at once on real hardware; the MD-07 idle
re-sync (off in e2e mode). The phase-13 human-verify checkpoint (performance numbers, premium look while driving) is
still owed.
