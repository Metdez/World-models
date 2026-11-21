# 11-03 SUMMARY — Replays: recorder, format, share link, moment replay

## Built
- **`src/sim-core/replay/format.ts`** (pure, contracts only; the worker may import it): `SLR1` layout exactly as
  ARCH-M2 §7.13 (header JSON, start float64s, 5 channels delta + zig-zag + LEB128 channel after channel, events, keyframe
  CRCs, CRC32 trailer); `encodeReplay`, `decodeReplay` (null on any error) and `decodeReplayResult` (`damaged` /
  `newer-format`); `paramsHash` (FNV-1a over UTF-16 units of `JSON.stringify([vehicle, suspension, world])`);
  `stateChecksum` (CRC32 over `Math.round(v·1e6)` as int32 low/high pairs, allocation-free); `SIM_VERSION = 'm2.1'`;
  `replayFit` (refuses track/world/vehicle/unknown suspension/start length; `sameModel`/`sameVersion` labels);
  `aidsValue`/`parseAids`.
- **`src/sim-core/replay/recorder.ts`**: buffers allocated once at the first run (600 s of intents, a start-state
  snapshot + CRC every `SNAP_TICKS` = 240 steps, 602 slots), oldest data dropped in whole seconds; `latch`/`tick` do not
  allocate; `last(s)` (newest ≥ s, starting on a whole snapshot second), `whole()`, `origin()` (identifies spans of the
  current run), `snapshotAt`, `rewind`. Spans carry the aids in force at their start as a tick-0 event and the suspension
  in force in the header (with its paramsHash).
- **`src/sim-core/drive/control.ts`**: every manual run is recorded from its engage (also after a takeover from
  Returning): start state = plant snapshot + HumanDriver state (`REPLAY_START_LENGTH`), latched integers, suspension /
  aids / reset events. `play()`: fit check, header suspension switched at once (kernel syncs the store), the start state
  restored at the next step (`mode {replay, cut:true}`), the recorded integers latched on the same control ticks, events
  applied at their ticks, keyframe CRC compare (mismatch → resync from the recorder's snapshot when the replay is a span
  of this simulation's own run, else counted: "may differ"); last tick → manual (no cut). Branching: `request('manual')`,
  a user aids change or suspension swap during a replay → manual from the current state; the recording continues (for a
  moment replay the recorder is rewound to the span start, so the run stays one run). `request('auto')` from replay =
  as from manual. `DriveHost` adds `last(s)`, `replay` (`ReplayStatus`: tick/ticks, sameModel/sameVersion, moment,
  state playing/ended/branched, mismatches, resyncs, firstMismatch, endChecksum), `stateChecksum()`, `recordedTicks`,
  `check(replay)`, `noteSuspension(id)`. A reset no longer restarts the latch phase (it is an event inside a run).
  frame.drive.source = `'replay'` while replaying.
- **`src/sim-core/simulation.ts`**: control deps `suspensionId`, `setSuspension`, `paramsHash` (cached per vehicle
  definition × suspension id, world definition included); `setSuspension` while driving notifies the control.
- **`src/sim-core/replay/run.ts`**: `runReplay(sim, replay, onStep?)` — headless re-simulation to the last tick.
- **`src/features/replay/**`**: chip in the drive feature's action row — Manual: recording dot, **Moment replay (Q)**
  (newest 4–5 s at 0.25×, highlighted for 10 s after a slide/lock-up/wheelspin/assist event, then manual at exactly the
  pre-replay state, timeScale restored), **Share** (panel with the link, Copy with a select-and-copy fallback; whole run
  ≤ 60 s, else the last 59–60 s with "Sharing the last minute…"; > 8 000 fragment chars → "too detailed"). Replay:
  "Replay" / "Shared run", "Slow motion" tag, progress bar, honesty line (older model / other settings / drifted /
  drifted and put back: "approximate from here"), **Drive it yourself** (branch). Opening `#r=` (load or hashchange)
  decodes, waits for frames, checks fit and plays; damaged / newer / no-decompressor / other track, world, vehicle,
  suspension each get a calm note, never an exception. Links: `#r=` + base64url(codec byte + payload), codec 1 =
  deflate-raw (`CompressionStream`), 0 = raw (fallback); `Uint8Array.toBase64/fromBase64` when present, else btoa/atob.
  Fragment only (`origin + pathname + #r=…`; query dropped). Store mirrors the replay's suspension and aids.
- **Tests**: `tests/sim-core/replay.test.ts` (15), `tests/sim-core/replay-golden.test.ts`, `tests/features/replay.test.ts`
  (7), `tests/e2e/11-03-replay.spec.ts` (2), fixture `tests/fixtures/11-03-replay.ts`.

## Measured (real output)
- **Exactness**: a recorded run replayed in another simulation (other lap time, other suspension installed before play)
  ends with the identical full-state CRC, 0 keyframe mismatches; suspension swap + aids change + reset inside the run
  replay at their ticks; moment replay ends at the identical pre-replay CRC, twice in a row; corrupted keyframe → 1
  mismatch, 1 resync, state still exact; shared copy → 1 mismatch, labelled.
- **Golden** (`replay-golden`): scripted 20 s gamepad-like run, keyframe CRCs equal live vs fresh-simulation replay at all
  4 keyframes; pinned `SIM_VERSION m2.1`, bytes CRC `2144df1c`, end-state CRC `0a38e90a`.
- **Allocation**: heap churn per step recording 260 B, replaying 445 B (includes the test's scripted-driver closures;
  plant-no-alloc S3 limit 1500 B/step; no allocation site in latch/tick by construction).
- **Size** (`[11-03] replay size`, Node zlib via CompressionStream; "link" = `https://host/#r=` + fragment):

  | drive | raw | deflate-raw | per minute | link chars |
  |---|---|---|---|---|
  | keyboard (typical desktop), 30 s | 10 238 B | 993 B | 1 986 B/min | 1 342 |
  | keyboard, 2 min | 37 524 B | 1 673 B | 837 B/min | 2 248 (over the 60 s fragment cap: the chip shares the last minute) |
  | gamepad-like (noisy analog), 30 s | 10 268 B | 3 417 B | 6 834 B/min | 4 574 |
  | gamepad-like, 2 min | 37 752 B | 11 178 B | 5 589 B/min | 14 922 (cap) |

  The ~0.9 KB fixed part is the float64 start state (110 doubles). e2e: a real 10.2 s keyboard-script drive in Chromium →
  1 101-char link (fragment 1 076).
- **e2e** (private build `vite build --outDir <scratch>/dist-1103`, `vite preview --port 4313`, wrangler config restored
  after the preview was up, `--trace off`, `?quality=low`): **2 passed**. Recorder vs viewer end state
  `(-151.760, -496.853) 14.986 m/s` both, full-state CRC `171d8485` equal (viewer stepped to the exact last tick); older
  model labelled; another vehicle refused (stays Auto); damaged link explained; moment replay at 0.25× ends at the
  pre-replay CRC, timeScale back to 1; zero console errors. Screenshots (looked at):
  `…/scratchpad/shots/11-03-recording.png`, `11-03-share.png`, `11-03-shared-playback.png`, `11-03-moment.png`,
  `11-03-older-model.png`, `11-03-damaged.png`.

## For 11-04 (ghost): the API to use
- Recording span: `const host = sim.current.drive as DriveHost` (`src/sim-core/drive/control.ts`);
  `host.last(30)` → `DecodedReplay` of the newest ≥ 30 s (start rounded down to a whole second, so 30–31 s; ask
  `last(29)` for ≤ 30 s), `null` in Auto; `host.recordedTicks` (cheap) to gate "≥ 5 s recorded". It is NOT the contract's
  `recording()` (whole run, allocates).
- Headless line: `runReplay(freshSim, span, (s, tick) => …)` (`src/sim-core/replay/run.ts`) in a fresh
  `createSimulation({catalog, trackId, vehicleId, suspensionId})`; read `s.sample(1).drive` (x, y, u, v) each step and emit
  `x, y, speed` triples every `RECORDED_DS` of travel → `recordedLine(samples)` (`drive/reference.ts`). Ends in manual
  at the span's exact end state (same build). The returned `ReplayStatus.mismatches` should be 0.
- Ghost start state: `span.start` (length `REPLAY_START_LENGTH` = `PLANT_SNAPSHOT_LENGTH` + HumanDriver state);
  `plant.restore(span.start)` reads the first `PLANT_SNAPSHOT_LENGTH` doubles (`plantOf(sim)` in simulation.ts for a
  headless plant). The snapshot is suspension-agnostic (state only): restore it under suspension B, then drive with the
  PathDriver.
- Visible lockstep: `bus.emit('drive:play', { replay: span })`; each frame `host.replay.tick` / `.ticks` /
  `.state` ('playing' → 'ended' | 'branched'); step the ghost by the same number of fixed steps. At the end the mode
  is manual at the pre-replay state (§7.10 G).

## Deviations
1. **`src/sim-core/drive/plant.ts` edited (not in my list; no phase-11 owner).** The public `restore()` zeroed the
   previous step's tyre fx/fy/slip ratio (read by compliance, aids, powertrain) and kept the restoring simulation's
   ride road rate (read by the reported tyre loads): a mid-run restore diverged (0.37 m after 9 s; another lap time →
   keyframe mismatches). The snapshot now appends those 16 values (`PLANT_SNAPSHOT_LENGTH` 80 → 96) and only the public
   `restore` (no caller before 11-03) re-applies them; fault recovery and every Auto/Manual step path are unchanged;
   goldens unchanged.
2. Arch §7.1 `Recorder.window(seconds)` is named **`last(seconds)`** (also on `DriveHost`): the M1 purity test bans the
   word `window` anywhere in sim-core.
3. Keyframes in a shared link are CRCs only (contract `DecodedReplay` has no snapshots): resync is available for moment
   replays (recorder snapshots); shared replays are labelled instead. The recorder keeps snapshots every second (not
   only every 5 s) so any span starts on an exact state.
4. `ReplayHeader.simVersion` holds `SIM_VERSION` (arch §7.13), not `APP_VERSION` as the contract comment says.
5. e2e "final `__app.drive()` state equal": exact full-state CRC equality plus `drive()` x/y within one step of motion
   (both pages are paused at different interpolation alphas between the same two fixed steps; the printed values agree
   to the millimetre).
6. **Layout conflict (coordination):** drive.css places every `.sl-drive-action` at the same centre; 11-01's "Grip rings"
   toggle uses the row too, so the two overlapped. replay.css now shifts this chip right of the centre while another
   `.sl-drive-action` is visible (`:has()`, generic, no class names of other features). A shared flex container in
   drive.css (10-04's file) would be the clean fix — 11-04's Compare chip will need it too.
7. Moment replay is offered always in Manual (after 1 s recorded) and highlighted for 10 s after a detected event;
   MD-43 "within 10 s after a detected event" read as the highlight, not a gate.
8. During a replay the kernel only syncs `store.suspensionId` on mode events; the feature mirrors suspension/aids into
   the store each frame while replaying (kernel then finds nothing to change).
9. Not done (out of scope / environment): server save (12-01/12-05); Firefox/WebKit cross-engine replay equality
   (not installed here — the replay format makes it detectable: keyframe mismatch → labelled).

## Verification
- `npm run check`: typecheck clean; `✔ no dependency violations found (267 modules, 933 dependencies cruised)`;
  `Test Files 1 failed | 97 passed | 1 skipped (99)`, `Tests 1 failed | 982 passed | 11 skipped (994)` — the failure is
  10-02's `world-zones` "sample does not allocate" heap-profile test under parallel load; alone `Tests 8 passed (8)`.
  (An earlier full run had `linkage-parts` "update allocates nothing" and `simulation.test` full-lap timeout fail under
  load; both pass alone.) Auto goldens (`golden.test.ts`, `moto-sim.test.ts`) pass unchanged.
- Mine: `replay.test.ts` 15, `replay-golden.test.ts` 1, `features/replay.test.ts` 7, e2e 2 — all pass.

## Lifted code
None (CRC32 IEEE table, FNV-1a, LEB128/zig-zag are textbook algorithms written here).
