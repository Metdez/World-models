# 02-01 SUMMARY — Track builder, road surface, speed profile

**Status:** complete · commits `d46aac5` (plan), `312ed0b` (plan geometry + surface modules + content),
`4d7db98` (surface tests), `ca7dc04` (speed profile)

## Built
- **`track/closure.ts`**: primitives → dense nodes (s, x, y, ψ, κ, κ′) at ≤ 0.25 m; ψ is exact per primitive and
  position uses Simpson per step. The closure solve is an exact 2×2 on the two named straights (end position is
  linear in a straight's length). Net turn must be ±2π, otherwise it throws.
- **`track/build.ts`** `buildTrack(def)`: resolved def with the solved lengths, sections, props at absolute s,
  `sectionIndexAt`, `sample` (node plus a local Simpson step, so it's exact between nodes), `lineOffset`,
  `roadHeight`, `toWorld`. All queries are pure, wrap s and don't allocate (apart from boxing at the call
  boundary, which a trivial number function shows too).
- **`track/surface.ts`**: macro elevation = swell + vertical curves (this is what `sample().z/grade` report).
  `roadHeight` adds `l·tan(bank)` (ramped linearly over leading/trailing clothoids), ISO 8608 roughness
  (class scale blended linearly over ±5 m at section boundaries) and the closed-form features.
- **`track/iso8608.ts`**: 200 log-spaced bins over 0.05–10 cycles/m. Every frequency is an integer number of
  cycles per lap, and phase indices are exact integers, so the profile is periodic to the bit. 2 cm LUT on 3 rails
  that repeat every 0.8 m across the road. Rail phases share a common part that fades with exp(−π n·1.6 m), so
  long waves are coherent across the car and short waves are not (heuristic).
- **`track/features.ts`**: cosine-bump (soft edges inside its band), pothole, kerb-strike (inside the kerb band
  only), chirp washboard, pave (hashed stones with bevelled joints), humps, vertical-curve (raised cosine).
- **`path/path.ts`**: cosine-knot driving line. **`path/speed-profile.ts`**: steps below.
  1. 0.5 m grid; κ = κc + l″ (central differences).
  2. v_lim = min(vMax, section caps including the neighbouring nodes' sections, √(lat/|κ|)).
  3. Two laps each of backward braking and forward traction passes, on a friction ellipse; drag reduces traction.
  4. Smoothing: v = min(raw, 10 m moving average), then the passes are re-run so the limits hold by construction.
  5. ax/ay go through an 8 Hz first-order low-pass in time, run over two laps so the result is periodic.
  6. Trapezoid t(s). `stateAt` uses binary search plus linear interpolation; `timeAtS` is its exact inverse.
- **`content/proving-loop.ts`**: the §7.5 table, with captions and names that contain no digits.
  - Kerb-clip line knots in the bump strip: 0 → −4.0 m → 0 over s 72–145.
  - ISO 3888-1 DLC line and 18 cones (design vehicle width 1.95 m).
  - Crest and dip: ±0.35 m raised cosines, 30 m each (minimum vertical radius 130 m).
- **Fixture** `tests/fixtures/02-01-gt-limits.ts`: §7.5 GT limits, drag area 0.65 m², mass 1700 kg.

## Key numbers (from the tests)
- Lap length **1650.80 m**, made of:
  - launch 100 · brake-zone 80 · hairpin 77.8 · bump-strip 150 · sweeper 218.5 · pave 100
  - chicane 103.6 · crest 60 · carousel 161.4 · **dlc 351.4 (solved)** · off-camber 135 · **run-in 113.2 (solved)**
- Closure < 1 mm and < 1e-6 rad. Minimum clearance between non-adjacent sections **40.9 m**.
- Lap time **83.72 s** (mean 19.7 m/s). Speed **11.10–36.00 m/s**.
- Peak |ay| **0.846 g**; ax **−0.867 g (= brake limit) … +0.506 g**.
- Crest: minimum vertical radius 130.2 m, |a_z| 0.295 g at 19.4 m/s.
- ISO 8608 RMS: class B 3.57 mm, class D 14.28 mm.
- Build time: `buildTrack` ≈ 230 ms (roughness LUT), `buildSpeedProfile` ≈ 13 ms.

Per section:

| Section | Start (s) | Duration (s) | Speed (m/s) | Peak \|ay\| (g) |
|---|---|---|---|---|
| launch | 0.00 | 2.78 | 36.0–36.0 | 0.00 |
| brake-zone | 2.78 | 3.25 | 11.1–36.0 | 0.00 |
| hairpin | 6.02 | 7.01 | 11.1–11.1 | 0.63 |
| bump-strip | 13.04 | 7.71 | 11.1–22.0 | 0.84 |
| sweeper | 20.75 | 8.75 | 12.5–26.7 | 0.61 |
| pave | 29.50 | 8.00 | 12.5–12.5 | 0.00 |
| chicane | 37.50 | 6.83 | 12.5–15.3 | 0.63 |
| crest | 44.33 | 3.19 | 15.3–19.4 | 0.01 |
| carousel | 47.52 | 8.24 | 19.3–22.2 | 0.85 |
| dlc | 55.76 | 16.38 | 17.3–22.2 | 0.84 |
| off-camber | 72.14 | 7.50 | 18.0–18.0 | 0.47 |
| run-in | 79.64 | 4.08 | 18.0–36.0 | 0.00 |

## Deviations / decisions (for the orchestrator and 02-04)
1. **Hairpin targetSpeed 9.7 → 11.1 m/s** (40 km/h, top of research 11's 30–40 km/h range, 0.63 g).
   - The §7.5 clothoids make the loop 1651 m. Research 11's 1508 m sketch had no transitions; the solved straights
     are 351/113 m, not ≈326/≈110.
   - With 9.7 m/s the lap came out at 85.00 s, right on the gate.
   - Recommend updating the §7.5 table (hairpin 11.1, total ≈1651 m).
2. **`TrackSample.z` / `grade` are the smooth macro elevation** (swell + vertical curves), not the full road height
   at l = 0. The contract comment reads "z = road height at l = 0".
   - `PathState.z` also lies on the smooth surface (macro elevation + l·tan bank).
   - Roughness and features exist only in `roadHeight`, so §7.6 step 4 ("minus the local road plane") gives the
     ride model pure deviations.
   - The crest is part of the macro elevation. If 02-04 wants a heave input, it can take a_z = v²·d(grade)/ds.
3. **l is a horizontal offset** along the left normal. `toWorld` gives xy = centreline + l·n, z = roadHeight(s, l).
4. **Ordinary kerbs are flush** (a painted band). Only the `kerb-strike` feature is raised (60 mm, right kerb band,
   s 100–112 of the bump strip). The bump-strip line goes to l = −4.0 m so the right wheels (half track ≈ 0.8 m)
   ride the 4.5–6.0 m band. Re-check this once 02-02 measures the track.
5. The driving line's l″ jumps at knots, because the contract specifies cosine interpolation. The 8 Hz low-pass
   smooths the resulting ay steps.
6. Small-offset driving-line approximation: path speed is ds/dt along the centreline (no (1 − κl) factor).
7. `src/sim-core/index.ts` is not touched: 02-04 exports `buildTrack` from `./track/build`.
8. Task 1's commit also contains the surface modules, because `build.ts` needs them to compile. Task 2's commit
   holds their tests.

## Known gaps
- No 02-01-owned no-alloc heap test (02-04 owns `no-alloc.test.ts`).
  - A scratch measurement showed `roadHeight`, `toWorld` and `stateAt` at or below the heap churn of a trivial
    number-returning function: return boxing only, no per-call objects.
  - Array destructuring was removed from the hot paths.
- Roughness is the same for every lap (by design: deterministic). Its lateral structure is a 3-rail heuristic.

## Verification (real output)
```
$ npx vitest run tests/sim-core/track.test.ts tests/sim-core/track-surface.test.ts tests/sim-core/path-speed-profile.test.ts tests/arch
 Test Files  5 passed (5)
      Tests  45 passed (45)
$ npm run lint:deps
✔ no dependency violations found (95 modules, 234 dependencies cruised)
$ npm test
 FAIL  tests/sim-core/kinematics-table.test.ts   (02-02, in progress: missing content/susp-*.ts)
 FAIL  tests/sim-core/ride-modal.test.ts          (02-03, in progress)
 Test Files  2 failed | 18 passed (20)
      Tests  179 passed (179)
$ npm run typecheck
tests/sim-core/kinematics-table.test.ts(14,28): error TS2307 ... content/susp-macpherson   (02-02, not mine)
(earlier run: src/features/renderer/index.ts(84,52) TS2554 — 01-04, not mine; no errors in 02-01 files)
```
