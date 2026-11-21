# 09-03 SUMMARY — Determinism sweep and cross-engine hash

## Built
- **Sweep** (ARCH-M2 §7.12.1): every transcendental `Math.*`, `Math.hypot` and non-integer / negative-integer `**` in
  `track/{build,closure,features,iso8608,surface}`, `path/speed-profile`, `kinematics/{metrics,spatial,table}`,
  `moto/{lean,model,planar,ride4dof}`, `math/{interp,mat,quat,rng}`, `content/cafe-racer` now goes through `math/det.ts`
  kernels or exact operations. `ride/tyre.ts`, `math/{vec3,linsolve}` and the other owned content files had none.
  `iso8608`: `ratio ** (b/BINS)` → `dpow`, `(nk/N0) ** -2` → `1/(r·r)`.
- **V8-identical exact kernels**, so the sweep leaves Node/Chromium results bit-identical where it matters:
  - `math/vec3.ts` `hypot2/hypot3`: V8's Math.hypot algorithm (normalise by the largest, Kahan sum) with exact ops —
    0 mismatches vs `Math.hypot` on 4·10^6 random 2-/3-argument inputs + NaN/Inf/0/subnormal edges.
  - `math/det.ts` (**not in my owned list — see Deviations**): kernelSin/kernelCos use the original fdlibm 5.3
    k_sin.c/k_cos.c evaluation (V8's), not the FreeBSD rewrite → `dsin`/`dcos` 0 mismatches vs `Math.sin/cos` on
    6·10^6 arguments (|x| ≤ 10^6) + threshold neighbourhoods (was 1 ulp, ~0.8 % of arguments). The non-integer `dpow`
    path is the fdlibm e_pow core (via stdlib-js pow 0.3.1, Apache-2.0, without its y = 3/4 shortcuts): bit-identical
    to stdlib/fdlibm on 2·10^5 samples, but **V8's Math.pow is not fdlibm** (differs in ~4 % of cases by 1 ulp; old
    `dexp(y·dlog x)` differed in ~65 %). Header comment corrected accordingly.
- `tests/arch/det-math.test.ts`: scope = all of `src/sim-core` except `car/car-model.ts`, `ride/ride7dof.ts` (09-04).
- `tests/e2e/09-03-determinism.spec.ts`: Node-side `runDriveScript(createSimulation(page ids), 7, 60)` vs
  `__app.driveHash(7, 60)` in the configured project; Firefox/WebKit tests launch automatically when
  `type.executablePath()` exists, else skip with the reason.

## Equivalence (old = tree at dd23488, new = sweep; scratch probe, not committed)
600 lap times per suspension: `stateAt` (14 fields), `lapTimeAt`, `seek(t)` + 3 steps + `sample(0.5, 1|2.5)` (every
numeric field, all corners), `restPose(0)`, `kinematics()`; car tables on a 41×21 travel×rack grid + `rackForSteer` +
`rollCentreHeight` + antiPitch; `prepareMotoSuspension` for the 3 presets; track `sample` / `roadHeight` at 2 000 s.

| block | max abs diff | max diff / field scale |
|---|---|---|
| stateAt, lapTimeAt, lapDuration, speed profile (all 6) | 0 (bit-identical) | 0 |
| car kinematics tables (3 × 2 axles, 289 494 values), `kinematics()` curves | 0 | 0 |
| moto solutions (3 presets, 94 222 values) | 0 | 0 |
| track `sample` | 0 | 0 |
| track `roadHeight` (iso8608 roughness) | 2.2e-16 m (639 of 10 000 values) | 1.1e-16 |
| sample macpherson | 6.0e-10 (instantCentre.y, scale 493 m) | 2.1e-12 |
| sample double-wishbone | 1.5e-9 (instantCentre.y, scale ~500 m) | 1.1e-12 |
| sample multilink | 8.6e-10 | 3.7e-13 |
| sample moto-classic / modern / telelever | 4.9e-11 / 5.9e-11 / 4.9e-11 (forces, N) | ≤ 2.2e-14 |
| restPose (all) | ≤ 7.7e-14 m | ≤ 4.6e-14 |
| 10 s golden stream (3 car suspensions, 1.47 M values) | 2.0e-10 (load/damper force, N) | ~2e-14 relative |

The only remaining source of change is the road roughness (fdlibm `dpow` ≠ V8 `pow` in 9 of the 201 band edges, and
`1/(r·r)`), everything else is bit-identical. The rear-axle `steer` fields (~1e-19 rad noise around 0) differ by
≤ 4e-19 absolute. Before the det.ts kernel fix the sweep moved table geometry (the LM solve differentiates through
Rodrigues `sin/cos`) by up to 1e-6 of scale (instant/roll centres) and motion ratio by 3e-10 → spring forces 4.6e-7 N
→ 81 / 5 / 183 golden quantisation flips (car hashes 53e95141→3998c38a etc.); with dexp·dlog pow one flip remained.

**Golden hashes: none re-baselined.** Car `53e95141`, `a8a25413`, `64d2ddf9`; moto `d015332e`, `49727a3b`, `ef5f24be`
unchanged (`tests/sim-core/golden.test.ts`, `moto-sim.test.ts` green; 0 quantisation flips in the stream diff).

## Cross-engine hash (real output)
`[09-03] runDriveScript(7, 60) proving-loop/gt-coupe/double-wishbone: node 112cf673, chromium 112cf673` — 1 passed,
2 skipped (Node 22, V8 12.4.254.21 vs Chrome for Testing 159.0.8154.6; private build from an isolated worktree, port
4317, `--trace off`). **Gap: Firefox and WebKit are not installed** (`/opt/pw-browsers` holds only chromium,
chromium_headless_shell, ffmpeg); their tests skip with the reason and run automatically when present. STATE.md should
record this (not my file). Note the plant still runs `car-model`/`ride7dof` Math.* (09-04): equal here only because
both sides are V8.

## Performance (scratch bench, median of 9 × 20 000 steps, interleaved runs, 4-core box under parallel load)
Auto step car 3.8 → 4.4 µs; Auto step moto 3.0 → 4.3 µs; plant step (gt-coupe, throttle 0.25) 10.2 → 12.3 µs
(budget 25). Software sin/cos/tanh/atan2 replace V8 intrinsics (track surface per wheel, quat/mat, moto planar).
`runDriveScript(7, 60)` macpherson ed94db1d → 7f276f60 (not pinned anywhere; roughness ulps + det kernels).

## Verification
- `npm run check` (main tree): typecheck clean; `✔ no dependency violations found (241 modules, 797 dependencies
  cruised)`; `Test Files 72 passed | 1 skipped (73)`, `Tests 811 passed | 11 skipped (822)`. A later rerun hit one
  load flake in `tests/features/camera.test.ts` (08-04's heap-retention check; 27/27 pass in isolation). Under heavy
  load `simulation.test.ts`'s full-lap test once exceeded the 5 s default timeout (2.4 s in isolation).
- `tests/arch/det-math.test.ts`: 2 passed with the widened scope.

## Deviations
1. **`src/sim-core/math/det.ts` edited** (owned by 08-02, done; no phase-9 owner): kernelSin/kernelCos evaluation
   order, fdlibm pow core, doc. Without it the sweep moves the car goldens (§7.12.7's "≤ 1 ulp" expectation does not
   hold through the kinematics solver) and the ≤ 1e-9 equivalence bound fails for derived geometry. 08-02's
   `tests/sim-core/det-math.test.ts` still passes (its dpow title says "few ulp"; now ≤ 1 ulp).
2. The harness "WIP snapshot" commit 6128dac captured the sweep (my src files and this PLAN) between my tasks, so the
   task commits are not atomic; my own commits: 12c536c (tests), b93a7f3 (kernelCos branch on |x|), this SUMMARY.
3. Equivalence probe, golden-stream diff and bench live in the scratchpad (not committed; plan says scratch).

## Lifted code (for CREDITS, 13-01)
- fdlibm 5.3 k_sin.c / k_cos.c evaluation (Sun notice already in det.ts) and e_pow.c via stdlib-js
  `@stdlib/math-base-special-pow` 0.3.1 (Apache-2.0, Copyright (c) 2018 The Stdlib Authors; LICENSE checked in the npm
  tarball 2026-11-21) → `src/sim-core/math/det.ts`.
- V8's Math.hypot algorithm (idea only, re-expressed; V8 BSD-3-Clause) → `src/sim-core/math/vec3.ts`.
