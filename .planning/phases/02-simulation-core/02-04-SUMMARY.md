# 02-04 SUMMARY — Simulation facade, GT coupe, integration

**Status:** complete (no deploy; the orchestrator runs the phase gate).
**Commits:**
- `146709a` plan
- `00ee5b7` car model + simulation (the stub is removed)
- `6ba5c4d` content contributions + arch tests
- `e3d545d` golden, no-alloc, difference report, e2e

## Built
- **`sim-core/vehicle-models.ts`**: the §7.2.4 `VehicleModel` seam and `VEHICLE_MODELS`. `moto/model.ts` is a stub
  that throws "motorcycle model arrives in phase 5".
- **`sim-core/car/car-model.ts`**: the car model.
  - Tables are solved once per (vehicle, linkage) and cached (`prepareCarSuspension`). The simulation pre-solves all
    of a vehicle's suspensions at load, so a swap has no hitch.
  - Ride params come from the vehicle's shared targets: wheel rate from ride frequency (in series with the tyre),
    ζ at the wheel, ARB K/t². Per-type extras: friction, unsprung delta. `wheelCentreHeight` = tyre radius.
  - Per-wheel road input: a 3-point envelope (±0.1 m) of `roadHeight`, taken relative to the path's reference plane
    (heading, swell, bank). The crest/dip vertical curves therefore reach the ride model as road input, which gives
    real crest heave and pitch (02-01 note). Reported heave/pitch are relative to the local vertical-curve plane.
  - Specific forces in the road plane: `ay·cos(bank) + g·sin(bank)` and `ax + g·sin(grade) + drag/m`.
  - Roll-centre heights come from `rollCentreHeight(tL, tR)` at the current travel.
  - Anti-pitch: front anti-dive when braking, rear anti-squat when driving.
  - Steering: `rackForSteer(atan(L·κ))`. Per-wheel steer and toe come from the linkage itself. The right corner is
    the mirror of `sample(t, −rack)`.
  - Grip use: §7.2.3 axle forces split by load, with the camber to road.
  - Events: bump-stop, lift-off and grip-limit, with 0.5 s per-corner hysteresis. The event objects are preallocated.
  - `sample()`: lerp of TRUE values. POSE comes from the table at the amplified travel, composed with the body pose.
    It writes the points, wheel/contact-patch/IC poses and the posed roll centre (front-view IC-line intersection).
    The contact patch is lifted by the tyre deflection, so it sits on the drawn road.
  - `restPose()` uses the current body pose and steer.
- **`sim-core/simulation.ts`**: owns time, the cached track and speed profile, path interpolation, the frame and the
  event queue.
  - Section and lap events.
  - `seek(t)` = static equilibrium at `stateAt(t − 1.5 s)`, then 360 fixed steps. The pre-roll's events are dropped;
    `simTime` includes the pre-roll. The frame shows exactly `t` until the next step.
  - `setSuspension` re-derives the ride state for the new geometry at the same lap time. The path, `simTime` and
    interpolation are unchanged and the frame object is the same one.
  - `setVehicle` keeps the lap fraction and creates a new frame. Class mismatches throw.
- **`content/gt-coupe.ts`**: §7.5 values. Wheelbase, tracks and tyre radius come from `GT_GEOMETRY`. Visual key `db11`.
- **`features/car`** registers `gt-coupe` and the three suspensions; **`features/track`** registers `proving-loop`.
  Neither feature does anything else.
- **Tests**: `simulation.test.ts` (11), `simulation-differences.test.ts` (6), `golden.test.ts` (4),
  `no-alloc.test.ts` (1), `arch/no-id-branching.test.ts` (2), `arch/content-copy.test.ts` (6),
  `e2e/02-04-sim.spec.ts` (3).

## GT coupe: final spring, damper and ARB numbers
Targets are identical for all types. Values are the vehicle-frame wheel rates.

| | front | rear |
|---|---|---|
| ride frequency / ζ bump, rebound | 1.45 Hz / 0.32, 0.58 | 1.60 Hz / 0.32, 0.58 |
| wheel rate (in series with tyre 260/280 kN/m) | 37.3 kN/m | 44.1 kN/m |
| damping at the wheel bump / rebound | 2.45 / 4.44 kN·s/m | 2.61 / 4.73 kN·s/m |
| physical spring rate = wheel rate / MR² (MP · DW · ML) | 41.9 · 74.0 · 62.9 kN/m | 48.1 · 85.8 · 74.0 kN/m |
| anti-roll stiffness | **145 kN·m/rad** (2.5 kN·m/deg) | **85 kN·m/rad** (1.5 kN·m/deg) |

Front share of roll stiffness is 57 % (front weight 51 % + 6 %).

**Roll gradient (deg/g), steady state, flat road:**

| | MacPherson | DW | ML |
|---|---|---|---|
| suspension (body relative to axles) | 1.02 | **1.09** | 1.17 |
| total incl. tyre compliance | 1.63 | 1.70 | 1.78 |

**Deviation:** the 1.0–1.2 deg/g band is met as a *suspension* roll gradient. That is the textbook definition the
band comes from (research 04/05 and OptimumG exclude tyre compliance). Putting the *total* body roll in the band
would take about 300/220 kN·m/rad of ARB (DW total 1.19 deg/g), which is race-car stiff (about 5 kN·m/deg of front
bar alone). I judged that implausible for a road GT. The displayed roll is the total body roll relative to the road,
1.7 deg/g. If the total is wanted in the band instead, change the two values in `gt-coupe.ts`; the test gate states
which definition it checks.

## Honest-difference report
Same lap, same path for every type (`stateAt` is bitwise identical, lap 83.72 s). Output of
`simulation-differences.test.ts`. Camber is to the road; + means the top leans out (camber lost). The carousel and
the hairpin are right-hand, so the outer wheels are fl and rl.

**Carousel apex** (lateral acceleration −0.85 g for all three types)

| metric | MacPherson | double wishbone | multi-link |
|---|---:|---:|---:|
| outer front camber to road | −0.76° | **−0.97°** | −0.76° |
| outer front camber to body | −2.02° | −2.26° | −2.12° |
| inner front camber to road | −2.15° | −1.91° | −2.20° |
| outer rear camber to road | **−0.16°** | −0.78° | −0.66° |
| outer front camber at POSE ×1 / ×2.5 (labelled amplification) | −0.76° / +0.97° | −0.96° / +0.33° | −0.75° / +0.75° |
| body roll | −1.26° | −1.30° | −1.36° |
| roll-centre height front / rear | 106 / 86 mm | 74 / 74 mm | 34 / 48 mm |
| lateral load transfer front / rear | 1829 / 1692 N | 1823 / 1712 N | 1823 / 1723 N |
| front share of the transfer | 52.0 % | 51.6 % | 51.4 % |
| grip use (model) outer front / inner front / outer rear | 0.694 / 0.587 / 0.654 | 0.691 / 0.584 / 0.653 | 0.691 / 0.585 / 0.654 |

**Hairpin apex**

| metric | MacPherson | double wishbone | multi-link |
|---|---:|---:|---:|
| outer front camber to road | −1.41° | −1.71° | −1.44° |
| body roll | −1.08° | −1.10° | −1.15° |

**Brake zone, bump strip and pavé**

| metric | MacPherson | double wishbone | multi-link |
|---|---:|---:|---:|
| brake zone: peak pitch (−0.87 g) | 1.17° | 1.23° | 1.27° |
| one-wheel bump: road / fl travel / fl toe change | 52 mm / 22.3 mm / 0.014° | 52 mm / 22.6 mm / 0.020° | 52 mm / 22.5 mm / 0.005° |
| kerb strike: fr toe change | 0.018° | 0.027° | 0.007° |
| pavé stones: RMS body vertical acceleration | 1.49 m/s² | 1.46 m/s² | 1.46 m/s² |
| pavé stones: RMS fl travel rate | 0.253 m/s | 0.258 m/s | 0.258 m/s |

**What is visible and what is not (true scale, ~0.3° threshold):**
- **Visible:** the roll-centre heights (front 106 / 74 / 34 mm; good for the overlay construction lines), and the
  outer-rear camber at the carousel (strut 0.62° worse than DW).
- **Front outer camber at the carousel:** DW keeps 0.21° more than the other two, which is below the threshold.
  **MacPherson and multi-link are equal (Δ < 0.01°).** The strut's weak roll camber (0.82 deg/deg) is offset by its
  larger caster (6.8° vs 4.7°): steering gives the outer wheel more negative camber. This is real linkage behaviour,
  so I did not tune it away. At the hairpin the order is MP > ML > DW (−1.41 / −1.44 / −1.71); MP vs ML is 0.03°.
  With ×2.5 amplification the front becomes MP +0.97 / ML +0.75 / DW +0.33, so the ordering is visible there.
- **Too small to ever be visible:**
  - body roll (≤ 0.10° between types);
  - brake-zone pitch (≤ 0.10°; anti-dive 30/24/17 % pulls the other way from the RC effect);
  - bump steer (≤ 0.03°; all three were tuned to near-zero bump steer in 02-02);
  - grip use (≤ 0.003; no tyre is beyond 3° camber, where the model starts to penalise);
  - the load-transfer split (≤ 0.6 percentage points);
  - pavé harshness (2 %, from the strut's 60 N friction).
- **ROADMAP phase-2 criterion 4** says the outer front loses most camber with MacPherson, then multi-link, and least
  with DW. Only "least with DW" holds at true scale at the carousel apex. The e2e therefore asserts what is true:
  DW keeps the most outer-front camber, and at the rear MP > ML > DW. The criterion text needs the orchestrator's
  call. Amplification is the sanctioned way to make the front ordering visible.

**Bump-strip wheel paths** (02-01 note re-checked with the measured half track 0.847 m; asserted):
- the left wheels cross the cosine bump (52 mm of road under the fl patch);
- the right front goes through the pothole (−53 mm);
- both right wheels ride the raised kerb (61 mm), while the left wheels stay on the asphalt (8 mm of roughness);
- right travel peaks at 68–70 mm, just short of the bump stop.

## Determinism, seek, stability, cost (measured)
- **`stateAt`** is pure: no side effects, periodic, and bitwise identical across the three types and the bare speed
  profile. `lapTimeAt` inverts it.
- **`seek(t)`** is a pure function of t: two sims with different histories (runs, swaps) give bitwise-identical TRUE
  frames at t and 0.5 s later.
  - Against the continuously driven state, the 1.5 s pre-roll differs by at most 0.002° of roll and 0.23 mm of travel
    (checked every 2 s over a lap).
  - Seeking every 0.05 s over a lap succeeds for all three types.
- **`setSuspension`** gives a state identical to a seek with that suspension. Path, `simTime` and the frame object
  are unchanged.
- **Full lap:**
  - finite and stable; max |roll| 2.64° (bump strip);
  - contact patch vs the drawn road on smooth sections is at most 4.2 mm;
  - events per lap: 12 sections and 1 lap, plus lift-off (launch washboard at 36 m/s, bump strip, pavé humps) and
    grip-limit.
  - The grip indicator also exceeds 1 at the carousel exit (outer rear, up to 1.33): the path's 0.5 g traction plus
    lateral demand exceeds the modelled rear tyre. That is a model indication, not tuned away.
- **Cost:**
  - step 4.6 µs, sample 3.0 µs (frame sample + kinematics + world points);
  - seek 1.9 ms;
  - 1.3 ms of sim time per simulated second (240 steps + 60 samples).
- **Golden** (seed 42, 10 s, quantised hash of TRUE + POSE): MP `483f16ac`, DW `30a29468`, ML `3b374690`.

## Deviations
1. **Files outside my glob, forced by deleting the stub:**
   - `tests/kernel/stub-sim.test.ts` (01-02) tested the deleted circle, so I removed it.
   - In `tests/kernel/app.test.ts` two stub-specific assertions changed: `speed toBe(15)` → `> 0` and
     `front.motionRatio toBe(1)` → `> 0`.
   - The orchestrator should confirm these.
2. **Unknown ids fall back to built-in content** (proving loop, GT coupe, double wishbone) under the requested id,
   as the stub's placeholders did. This lets the kernel tests and `?features=-car` boot without content. The app
   validates ids against the registries before creating the sim.
3. **`setSuspension` re-derives the ride state** (pre-roll at the same lap time) instead of carrying the old dynamic
   state. `RideModel` has no state setter and per-type params (friction, unsprung mass) need a new model. The result
   is deterministic (equal to any device's seek), and the path and interpolation are continuous.
4. **No second low-pass on ax/ay:** the profile already supplies 8 Hz-filtered values (§7.2.1). §7.6 step 2 is
   satisfied by that.
5. **No-alloc gate (§7.6):**
   - Met: identity-stable objects and a retained heap delta (after GC) of about 0 B over 10 000 steps + 1 000 samples.
   - **Not met: heap growth before GC.** Measured 27–225 B per step, varying between runs with JIT inlining.
   - The cause is V8 boxing doubles passed to or returned from non-inlined calls. The main source is the 02-01
     surface API (`roadHeight`, `track.sample`, `stateAt` take and return doubles; I measured 50–110 B per call in
     isolation).
   - My own hot paths pass doubles through typed arrays. That took the car-model step from about 820 to about 30 B
     in isolation.
   - The test prints the churn and keeps a 1.5 KB-per-step tripwire. It is young-generation garbage, with no
     retention.
6. **Rear steering-axis metrics** (KPI, caster, scrub, trail of a non-steered axle) are `NaN` in `kinematics()`, so
   nothing can surface them (02-02 note).
7. **Shortcuts with comments in the code:**
   - no rear anti-lift under braking (the table only gives the drive path), for all types alike;
   - frame `trail` is the design value;
   - one mean static tyre deflection places the body (front/rear differ by 2 mm);
   - the damper is taken as coaxial with the spring;
   - grip use is capped at 2 and `stop` is clamped to 0..1;
   - the posed roll centre is clamped to ±5 m.
8. **Ride reference plane:** it is frozen at reset to the local vertical-curve plane, a rigid offset that is exact for
   the small-angle model. If the static solve still fails (diagonal wheels unloaded at its initial guess on pavé or
   washboard), the sim falls back to equilibrium on the reference plane and the pre-roll settles it. Both paths are
   deterministic.

## Known gaps (for the orchestrator)
- **No vertical-acceleration input in the ride model.** The banked carousel's normal-load increase (about +11 % at
  8°, 0.85 g) cannot be represented: `RideInput` has no a_z, and a road displacement cannot carry a sustained load.
  - Recommend an additive optional `az` in `ride7dof.ts` (02-03's file).
  - Estimate, not measured: about 13 mm more bump on all four wheels at the carousel, which would make DW and ML
    gain more negative camber than MP and widen the front differences.
  - Crest/dip heave is modelled (via road input).
- `CarDefinition.mass` 1700 kg (profile, grip) vs sprung + unsprung 1706 kg (ride). These are §7.5 values; I left
  them as given.
- Live placeholder: the 01-04 ground disc is flat while the track has ±1.5 m of swell and a crest, so the box car can
  look slightly under or over the disc in places. 03-01 replaces it.
- `npm run check` currently fails only in `tests/features/linkage-parts.test.ts` (03-04, running in parallel: 2
  interpenetration tests). Those files don't touch mine.

## Verification (real output)
```
$ npx vitest run tests/sim-core tests/arch --silent=false
[sim] seek vs continuous (every 2 s, smooth sections): max |d roll| 0.0019 deg, max |d travel| 0.23 mm (carousel@48.0); rough sections max |d travel| 0.19 mm
[sim] events over one lap: {"liftoff":27,"grip-limit":26}
[sim] lap: max |roll| 2.64 deg; contact patch vs drawn road (smooth sections) max 4.2 mm (off-camber fr)
[sim] cost: step 4.59 us, sample 3.04 us, seek (1.5 s pre-roll) 1.88 ms; per simulated second 1.28 ms
[sim] roll gradient deg/g (suspension / incl. tyres): macpherson 1.023 / 1.627, double-wishbone 1.093 / 1.701, multilink 1.174 / 1.784
[no-alloc] 10 000 steps + 1 000 samples: retained -4408 B; short-lived churn 2254496 B (225 B per step incl. its share of samples; events seen: 130)
 Test Files  16 passed (16)   [sim-core]      Tests  175 passed (175)
$ npm run check
✔ no dependency violations found (117 modules, 322 dependencies cruised)
 FAIL  tests/features/linkage-parts.test.ts > spatial-linkage: double-wishbone > parts do not interpenetrate ...  (03-04, in progress)
 FAIL  tests/features/linkage-parts.test.ts > spatial-linkage: multilink > parts do not interpenetrate ...        (03-04, in progress)
 Test Files  1 failed | 30 passed (31)
      Tests  2 failed | 326 passed (328)
(typecheck passed)
$ npm run build
✓ built in 661ms
$ npm run e2e
  ✓  1 tests/e2e/02-04-sim.spec.ts › the real simulation drives the placeholder car around the proving loop (6.3s)
[02-04 e2e] carousel apex t=51.651: macpherson: fl -0.76 deg, rl -0.15 deg, roll -1.26 deg | double-wishbone: fl -0.97 deg, rl -0.77 deg, roll -1.30 deg | multilink: fl -0.76 deg, rl -0.65 deg, roll -1.36 deg
  ✓  2 tests/e2e/02-04-sim.spec.ts › carousel apex: double wishbone keeps the most outer-wheel camber; at the rear the strut loses the most (10.6s)
  ✓  3 tests/e2e/02-04-sim.spec.ts › a suspension swap takes effect at once and the car keeps its place on the lap (3.0s)
  ✓  4-6 tests/e2e/03-02-env.spec.ts (3 tests)
  ✓  7-9 tests/e2e/smoke.spec.ts (3 tests)
  9 passed (1.5m)
```
Screenshots: `test-results/02-04-shots/02-04-placeholder.png` and `02-04-carousel-{type}.png`.

Credits: no code or data lifted.
