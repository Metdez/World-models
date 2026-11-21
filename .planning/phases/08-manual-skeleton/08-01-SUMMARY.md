# 08-01 SUMMARY — M2 contracts, kernel drive plumbing, feature stubs

## Built
- **Pre-check:** `sha256sum` of all 15 frozen files matched the ROADMAP-M2 prefixes (app 84409c273ab4, engineer
  c9522663ae37, events f6bc1fe30a60, net 3fb1d7c0a9d8, services 9d446353830e, sim 90ac336c1dc1, store 2d2e69dc1ba4,
  telemetry be85da882b64, vehicle 859cf5010cee, suspension/track/units, features.ts f95c185ee5b5, wrangler.jsonc
  a69ed7a6806b, worker/index.ts 86652866c350). The blocks were already based on phase 7's final files, so **no
  decision-6 re-base was needed and ARCHITECTURE-M2.md is unchanged.**
- Contracts C1–C11 (`drive.ts`, `world.ts` new; nine changed) and `src/app/features.ts` F1, written verbatim by
  extracting the blocks with the verbatim test's own `blockAfter`. `PROTOCOL_VERSION` is now 3 (client and worker ship
  together).
- Eight stubs: drive, proving-ground, tyre-vfx, coach, replay, ghost-lab, phone-drive, live-ghosts (§F1 table;
  live-ghosts `defaultEnabled: false`).
- `.dependency-cruiser.cjs`: sim-core may import `contracts/{drive,world}.ts`.
- `tests/arch/contracts-verbatim.test.ts` = §5.0 file (14 contract files, 29 features, M2 blocks supersede M1).
- Compile shims: `worlds` registry (+ test expects six), room-logic `in|tel|gst` → `forbidden` (`shortcut:` comment,
  12-02 replaces), analytics `drive-session` / `station-visit` schema + data-point mapping + tests.
- Kernel (§6): catalog `world(trackId)`; `sim.drive?.setAids(store.driveAids)` at boot; `?drive=manual` → `drive:request
  manual` after the first frame, plus `drive:reset {spawn}` with `?spawn=`. Sim host: `drive:request` manual (warn if
  unavailable; else clock local, unpause, `request('manual')`), auto (`request('auto')`), auto+immediate (clock → live,
  the watcher seeks; if already live it seeks directly), `drive:reset`, `drive:play` (local, unpause, warn on false,
  sync suspension), `sim:seek-to` ignored with a warning outside auto, `driveAids` → `setAids`, `syncSuspension()`.
  Loop: drains drive events after sim events → `store.driveMode`, `syncSuspension`, `acc = 0` on cut, `drive:mode`,
  `drive:event`; re-applies `host.testIntent` before each frame's fixed steps and before `advance()`.
  Flags `drive` (`manual` only) and `spawn` (ID_RE). Hooks `drive()`, `driveIntent()`, `driveHash()` (fresh sim, same
  catalog/ids).
- `src/sim-core/drive/script.ts` `runDriveScript` (seek 10, manual, seeded mulberry32 piecewise-smooth intents latched
  every CONTROL_TICKS, hash every 24 steps over drive x/y/yaw/u/v + corner travel/load/omega with the golden's FNV-1a);
  exported from `sim-core/index.ts`. Only `+ − × ÷`, `Math.round/floor/imul` (det-rule safe).
- Tests: `tests/kernel/drive.test.ts` (15) + `withFakeDrive()` in `tests/kernel/helpers.ts` (recording fake drive with a
  toy plant: requests apply at the next step, seek releases with a cut).

## Verification (real output)
- `npm run check`: typecheck (app, worker, node) clean; depcruise `✔ no dependency violations found (218 modules, 676
  dependencies cruised)`; vitest `Test Files 59 passed | 1 skipped (60)`, `Tests 680 passed | 11 skipped (691)`
  (baseline 658 passed; +7 from task 1: verbatim/event cases, +15 kernel drive).
- `tests/sim-core` incl. `golden.test.ts`: 19 files, 220 tests passed — M1 goldens unchanged.
- Private build (`npx vite build --outDir <scratch>`, `vite preview --port 4188`), Playwright (Chromium) boot smoke with
  `?e2e=1&quality=low` plus each of `features=-drive,-proving-ground,-tyre-vfx,-coach,-replay,-ghost-lab,-phone-drive,
  -live-ghosts` (all at once and one by one) and `drive=manual&spawn=skidpad`: every page ready, no feature errors,
  0 console/page errors, `drive().mode 'auto'`, `available false`, `driveHash → 'no-drive'` (M1 sim has no plant yet).

## Deviations / notes
- `__app.drive().speed` = `hypot(u, v)` of `frame.drive`; `steer` = `steerDemand`.
- A private `vite build --outDir` rewrites `.wrangler/deploy/config.json` to point at the scratch build (cloudflare
  plugin). I restored it to `../../dist/suspension_lab/wrangler.json` immediately after starting my preview. Future
  executors doing private builds must do the same (or the orchestrator's `npm run build` will rewrite it anyway).

## For 08-02
- Until the plant lands, `frame.drive` is the `createDriveFrame()` default in auto (available false); 08-02 fills it
  (§7.3 (4)) and must make `sim.drive` exist, with requests applied at the next fixed step and mode changes reported
  through `drainEvents` (the kernel mirrors them; it never sets `store.driveMode` itself).
- `runDriveScript` relies on `sim.seek(10)` + `drive.request('manual')` + `setIntent` + `step` + `sample(1,1).drive` and
  corner `omega`; once 08-02 lands it stops returning `'no-drive'` for the coupe.
- `sim-host` leaves the `drive:reset` gating to the sim (a reset requested in auto: the sim warns/ignores or applies it
  once manual is engaged — boot emits reset right after the manual request, before the next step).
