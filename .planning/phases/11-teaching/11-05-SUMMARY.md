# 11-05 SUMMARY — Teaching-phase follow-ups (gap closure)

Status: complete, no deploy. All looks judged under SwiftShader (headless software GL, DPR 1); a real-GPU pass is owed.

## Built
1. **Detectors in the plant** (`src/sim-core/drive/plant.ts`, `src/contracts/drive.ts` + ARCH-M2 §C1 block, note added).
   - `DriveEvent` gains `strike {corner, kerb}` and `hard-stop {from}`.
   - The plant creates `createDriveDetectors(vehicle)` once and fills a preallocated `DetectorInput` each fixed step
     from its own values: tyre slips, forces and capacity, ride load/travel/travel rate, wheel-frame forward speed,
     surface (kerb / pavé), command, aid flags, zone. Moments are copied into the same `driveEvents` queue, so they reach
     the bus through `drive.drainEvents`.
   - The detectors are reset on engage, place, restore and fault recovery. They only read state.
   - **Coach** (`src/features/coach/**`): bus events only; the per-frame detector run and its state are gone.
   - Step cost, median of the S3 test (`plant-no-alloc`), Node, same machine:
     - before: 18.39 / 18.99 µs;
     - after: 18.71 / 19.55 / 19.75 µs.
     - That is about +0.7 µs, within the 25 µs budget. Heap churn stays in the runtime noise (32–218 B/step); retained
       14 688 B, as before.
2. **Manual (driving) layout** (orchestrator top priority) and the **shared action row**.
   - The drive feature mounts `.sl-drive-actions`, a flex row, and adopts every `#overlay > .sl-drive-action` into it.
     It uses a MutationObserver and hands the chips back on dispose. No feature names are hard-coded.
     - The adopted chips: Grip rings (11-01), Replay (11-03) and Compare (11-04, picked up unedited).
     - 11-03's `:has()` workaround in `replay.css` is removed.
     - Chip words sit in `.sl-drive-action-label`. While driving they are visually hidden; the accessible name and the
       title keep them. Tyre-vfx and replay markup follow this convention.
   - While driving:
     - The bottom centre is one slim row: the pill. Aid lamps fold to icons (Approximate keeps its word) and the toggle
       drops its key hint. The control hint still shows for 6 s after a takeover, then fades.
     - The chips fold to icons at the right edge, above the view control.
     - The suspension control docks compact under the vehicle tag: short labels, no descriptor.
     - The coach line moves to the top centre.
     - Below 1400 px the view control drops its key hints, so the pill clears it with every lamp lit.
   - Touch-driving:
     - The pill is centred between the slider and the pedals.
     - The chips sit under the view control.
     - The telemetry card folds to g-g plus two numbers above the slider (tablet), or rests (landscape phone).
     - The coach line sits above the pill across the slider–pedal span.
     - The engineer pill hides under the slider.
   - Exposed: `--sl-drive-steer-w` and `--sl-drive-pad-w` (the touch footprint).
3. **Small screens**: `tests/e2e/11-05-layout.spec.ts` covers this (see Verification).
4. **Annex look** (`src/features/proving-ground/**`):
   - Edges and surfaces:
     - Where paving meets grass (`grassEdges`, tested; joins are skipped): a painted edge line, a pale low kerb strip
       (lifted 4 cm) and a 2.4 m gravel margin.
     - Sealed joints every 25 m on the large slabs.
     - A tonal variation of ±9 % / ±4 % (value noise at 31 m and 8 m) in the tarmac vertex colours.
   - Steering pad: radius rings every 10 m, eight dashed spokes with ticks, a centre cross, and a wider driven line.
   - Braking lanes: 0.2 m lines, two start chevrons per lane, a wider brake bar and wider ticks.
   - Props, all procedural with vertex or instance colours:
     - instanced 8 m light poles along the big slabs;
     - countdown boards (3/2/1 stripes) before each brake bar;
     - a low control hut between the pad and the braking platform;
     - a treeline of clumped low-poly crowns about 135 m beyond the field, one instanced mesh per side. Each side is
       drawn only within 240 m of the camera (triangle budget).
   - **Loop ribbon LOD** (`src/features/track/index.ts`): while the camera is over an annex zone or the field, a 1 m-row
     ribbon replaces the tier ribbon. One `world.sample` per frame.
   - An e2e-only hook, `__screenContacts()`, projects the tyre contact points through the main camera.
5. **Housekeeping**:
   - `world-ground`: the tautological alias test is replaced. It now checks that off the corridor `sample().h` equals
     `terrainHeight`, and that far from the loop it equals `farField` and `loopTerrainHeight` (1 000 random points).
     The `groundHeight` alias is removed from `track/terrain.ts`.
   - `world-zones` no-allocation test: a warm-up, then the best of up to three profiled rounds against the same
     0.1 B/call bound, with a 120 s timeout.
   - `track.test` terrain probe: 60 s timeout (it timed out under the parallel suite).

## Measured (real output)
- **Triangles at high tier** (e2e, `renderer.info`):

  | view | before | after |
  |---|---|---|
  | ride street | 1 640 229 | 1 246 227 (206 calls) |
  | steering pad | 694 076 | 718 418 |
  | braking platform | 776 570 | 799 520 |
  | loop t = 14 (M1 point) | 1 473 917 | 1 496 499 (budget 1.5 M) |

  At the loop point, the annex additions with the AO prepass cost about +23 k. Loop alone (`-proving-ground`) is
  1 357 575, unchanged.
- **Layout** (11-05 spec):

  | viewport | bottom-centre height, hint up | after the hint fades |
  |---|---|---|
  | 1280×720 | 86 px (11.9 %) | 44 px (6.1 %) |
  | 1920×1080 | 108 px (10.0 %) | 55 px (5.1 %) |

  - No overlaps, also with a long coach line and every lamp lit.
  - The four projected contact points are uncovered (8 px margin).
- Annex markings went from 17.6 k to 24.9 k triangles.
- The facility props are 2 k for the poles, 0.3 k for the merged mesh, and about 7–9 k per treeline side.

## Verification
- `npm run check`:
  - typecheck clean; depcruise `✔ no dependency violations found (273 modules, 968 dependencies cruised)`;
  - vitest `1 failed | 1002 passed | 11 skipped`. The failure is 11-03's `replay.test` "record and playback steps do
    not allocate": 2 261 B/step under the parallel suite. Run alone it passes twice (replay 350 / 358 B,
    recording 1 468 / 138 B), the same noise 11-03 reported.
- Unit tests:
  - goldens (`golden`, `moto-sim`) and `replay-golden` (SIM_VERSION m2.1): unchanged and passing;
  - `drive-events` 15; `plant-events` 3 (new: lock-ups and hard stop queued by the plant, ABS aid, lift-off rear
    slide, and an identical state checksum whether or not events are drained); `coach`; `proving-ground` 12
    (3 new); `track` 16; `world-ground` 5; `world-zones` 8.
- e2e on a private build (`vite build --outDir <scratch>/x1105/build`, programmatic preview on port 4315; the deploy
  config was restored after the preview was up; `--trace off`). Final build `main-BUS0HmZD`.
  - Passed: 11-05-layout 5/5; 10-03-ground 3/3; 10-04-drive 6/6; 11-02-coach 2/2; 11-03-replay 2/2; 11-01-vfx 3/3;
    04-05-layout 2/2 (after the selector update); 08-03-drive 2/2.
  - Some tests passed only on a rerun: the 11-05 budget test and 08-03 test 1. Their first runs timed out at boot
    under SwiftShader with the machine shared by other executors. The 11-05 spec now boots with a 120 s allowance.
  - **09-05-hud test 1 fails** at its hand-back step: it expects `auto` after Enter and gets `returning`. 10-04 changed
    Enter on the loop to start Returning and did not update this spec. The spec is not mine and I did not change it.
- Screenshots, in the session scratchpad `shots/`:
  - before: `11-05-before-{desktop-1280,desktop-1920,phone,tablet,overview-annex,steering-pad,braking-platform,horizon,pad-chase,platform-chase}.png`;
  - after: `11-05-after-*` (same set), `11-05-manual-*.png`, `11-05-manual-coach-*.png`,
    `11-05-touch-{phone,tablet}.png`.

## Deviations / notes
- **Camera framing (e)** is not changed. The camera feature is not mine and no contract carries a bottom inset. The
  driving HUD now leaves the tyres clear without it (asserted).
- `src/sim-core/drive/events.ts` is untouched. The plant forwards its `DriveMoment`s, which are structurally the new
  `DriveEvent` kinds. Its header still says "outside the frozen union" (no owner in this plan).
- Outside my list, as minimal fixes:
  - `tests/e2e/04-05-layout.spec.ts`: two selector strings changed from `#overlay > .sl-drive-action` to
    `.sl-drive-actions`, because the chips moved into that row.
  - `src/features/tyre-vfx/**` and `src/features/replay/**`: chip markup and CSS only, per the orchestrator's
    top-priority addendum.
- While driving with a mouse or keyboard, the lamps keep a 204 px slot in the pill. The centred pill no longer changes
  width as an assist flickers; this also removed a race in 04-05. The slot is empty glass when no lamp is lit.
- A scratch count test, `tests/features/tmp-1105-count.test.ts`, was swept into WIP snapshot `293aeb7`; it is removed
  in `18625c1`.
- The overview test view (fog off, camera over the loop edge) is more than 240 m from the treeline, so the treeline is
  not drawn there. It shows in the station chase views. The triangle budget at the M1 measuring point allows no more.
- The gravel margin reads as a pale concrete shoulder under SwiftShader lighting, not as textured gravel.
- The 11-04 Compare chip appeared in the action row during these runs; ghost-lab was not edited.
- Lifted code: none.
