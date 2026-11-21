# 11-01 SUMMARY — Tyre VFX: friction rings and skid marks

## Built (`src/features/tyre-vfx/`)
- **`model.ts`** (pure): ring per corner from CornerFrame. radius = R·√(capacity / static capacity), static capacity =
  peakMu(Fz_static)·Fz_static per axle from the vehicle (mass, CG, TyreParams); dot = (fx, fy)/capacity·radius in the wheel
  frame (clamped at 1.25 R). Unloaded / non-finite → no ring. **Past the limit**: plant (manual/returning/replay) = the
  tyre's normalised combined slip beyond the peak of its force curve, using sim-core `tyreCoefficients` (the plant's own
  definition; in the plant |F| ≤ capacity always, so `gripUse > 1` from §10.5 can never fire there); Auto = demand
  estimate `gripUse > 1`. `excess` 0..1 = how far past.
- **`rings.ts`**: one instanced SDF quad per corner in the car's road plane (normal from the four contact patches),
  oriented by the wheel heading (from `wheelRotation`). Pixel-constant strokes with a dark casing, faint inner disc,
  distance fade 18–55 m. Past the limit: `--warn` colour **and** dashed ring **and** open (hollow) dot. Second, faint
  x-ray pass (depthFunc Greater, same geometry) for the parts the car body hides.
- **`marks.ts`**: one shared ring of 4096 quads (≈600 m of single-tyre mark), 0.15 m spacing, quads share edges (seamless),
  oriented by the contact patch's actual path, break when back within the limit or on a > 3 m jump, intensity by excess,
  age fade before overwrite, distance fade, faint warm rim for legibility on dark tarmac. Preallocated update-range
  objects (no `addUpdateRange` allocation). Pattern: folio-2025 `Tracks.js` re-expressed (ideas only, no code copied).
- **`vfx.ts`**: per-frame driver (node-testable). **`index.ts`**: "Grip rings · MODEL" chip (`.sl-drive-action
  .sl-tyre-vfx`, aria-pressed, on by default); offered outside Auto, and in Auto only with the engineer overlay (demand
  estimate); rings hidden in close-up; marks only from the plant, cleared on `reset` drive event, `drive:mode` with cut,
  `sim:vehicle`, `sim:seek` (streak break on any mode change). Reduced motion: warn level switches instantly (otherwise
  60 ms rise / 250 ms fall of sim time). Motorcycle / 2-corner frames: nothing drawn, no chip. Colours read from the
  `--text-1` / `--warn` tokens. e2e hook `__tyreVfx` (?e2e=1 only).
- Draw calls: rings 2 (visible + x-ray) + marks 1 = **3** (budget 1 + 4).

## Deviations
- **Ring reference radius 0.4 m, not 0.25 m** (§10.5): at 0.25 m the ring sat inside the tyre's own footprint and under
  the body from the chase camera; screenshots showed it practically invisible.
- **Past-limit criterion in the plant is slip-based** (above), not `gripUse > 1`, which is unreachable in the plant.
- X-ray pass = one extra draw (rings 2 draws instead of 1), within the plan's ≤ 1 + 4.
- Task 2 files (`marks.ts`, `vfx.ts`, `index.ts`, css, node test) were swept into the orchestrator's WIP snapshot
  `62baa6e`; my commits: `1041ccf` (plan), `ba6a1f1` (model + rings), `902e4b0` (e2e).

## For the orchestrator
- CREDITS: brunosimon/folio-2025 `sources/Game/Tracks.js`, MIT, © 2025 Bruno Simon (license.md re-checked at lift time:
  MIT) — skid-ribbon ring-buffer pattern (idea/data layout, re-expressed; no code copied).
- Action row: 11-03's replay chip shifts right of a centred chip (their css); with both shown they sit side by side
  (checked in `11-01-brake-split.png`). A future third chip (ghost-lab Compare) needs the same treatment.

## Known gaps
- Load transfer at 0.37 g on the pad changes ring radius by ~13 % (0.375 → 0.427 m): honest but subtle from the chase cam.
- In Auto + engineer overlay the rings share the ground with the teaching overlays' load-arrow ellipses (busy).
- Judged under SwiftShader only (software renderer); not looked at on a GPU.

## Verification (real output)
```
$ npx vitest run tests/features/tyre-vfx.test.ts            -> Tests 11 passed (11)
[11-01] cornering at 14.3 m/s, a_y 0.23 g: radius front L/R 0.127/0.192 m, rear L/R 0.135/0.196 m on grass (pre-0.4 m run)
[11-01] lock-up ABS off: past true,true,false,true
[11-01] vfx.update(): heap delta over 20000 frames -8216 B
$ npm run check -> tsc x3 clean; depcruise ✔ no violations (267 modules); vitest 980 passed, 3 failed:
  purity.test.ts (11-03's control.ts/recorder.ts "window", fixed by 11-03 in bd6ba16), track.test.ts terrain and
  world-zones no-alloc (load flakes: re-run alone with linkage-parts + tyre-vfx -> 4 files, 70 passed)
$ private build (scratch outDir), vite preview :4411, config.json restored after preview up
$ playwright test tests/e2e/11-01-vfx.spec.ts --trace off -> 3 passed (6.4m)
[11-01] pad at 12.1 m/s on asphalt x4: radius fl 0.375 fr 0.427 rl 0.374 rr 0.423 m
[11-01] slide: 40 frames past the limit, past now fl,fr,rl,rr, marks 176
[11-01] draw calls: cornering 88, with marks 71
[11-01] braking (ABS off) on fl/rl ceramic-wet, fr/rr asphalt: past fl,rl,rr (29 frames), marks 149
```
Screenshots (1280×720, DPR 1, SwiftShader): `scratchpad/shots/11-01-{pad-cornering,pad-cornering-top,pad-slide,
pad-slide-top,brake-split,brake-split-top,auto-engineer}.png`.
