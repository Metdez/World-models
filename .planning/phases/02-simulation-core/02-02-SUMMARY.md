# 02-02 SUMMARY — Kinematics solver and three car suspensions

**Status:** complete · commits `8f45598` (plan), `08107a9` (solver + metrics + Chrono regression),
`3527b2e` (table, three definitions, property tests), `fbefc6a` (DB11 fit + gates report)

## Built
- **`src/sim-core/kinematics/lm.ts`**: Levenberg-Marquardt, central-difference Jacobian (h 1e-7), λ from 1e-9
  with step acceptance (λ×10 on a rejected step), tol 1e-12, ≤ 40 iterations, no allocation.
- **`spatial.ts`**: compiles any `AxleLinkage` into 6 residuals (`distance`: |P−C|²−L²; `strut`: (T−S) projected
  on two upright-fixed vectors ⟂ the strut axis; travel row). Pose = wheel-centre displacement + rotation vector
  about the design wheel centre (better conditioned than rotating about the axle origin). Steer point moves +rack
  in Y. Places every point: upright points rigidly, A-arm points by rotation about the arm pivot axis (03 §4.1),
  single-rod points by swing rotation, `link` springs at a fraction (03 §4.3). Validates 5 equations, names, roles.
  One code path for every layout: a suspension type is data only.
- **`metrics.ts`**: camber/toe/contact patch (03 §3.3). All rates use the exact solution tangent from the
  implicit-function theorem (J·dx/ds = −∂r/∂s) instead of re-solving neighbours: upright twist → contact-patch
  velocity → front-view IC line (perpendicular to the patch velocity, so parallel arms stay finite) → roll centre;
  rack (or toe-link) twist → instantaneous screw axis → KPI, caster, scrub, trail; anti-dive/anti-squat.
- **`table.ts`**: `solveAxleKinematics` per §7.2.2. Grid travel 2.5 mm × rack 2 mm over
  [−droop−20 mm, bump+20 mm] × ±(rack for 1.15 × maxSteer), solved by continuation (rack-0 column outward, then
  each row outward, recursive step halving on failure, throws instead of returning NaN). Per node: camber, toe,
  wheel centre, contact patch, IC, rotation quaternion, spring length, motion ratio, all points.
  `sample()` = one blend loop over the four cell records (no allocation), `rackForSteer` (inverse of the mean
  road-wheel angle, monotonicity asserted), `rollCentreHeight(tl, tr)` (intersection of the two IC lines, right
  side mirrored), curves and design summary, `createCornerSolution(table)` helper.
  **Right corner = mirror (y → −y) of `sample(travel, −rack)`.** `pointOrder` = points keys + `springLower`.
- **`content/gt-geometry.ts`**: `GT_GEOMETRY` measured from the GLB (wheelbase 2.919, track 1.694/1.694, tyre
  radius 0.382, wheel-centre height 0.376) + `GT_CORNER` (wheel centre [0, 0.847, 0.382], alignment −1.5°/0° front,
  −1.2°/+0.1° rear, travel ±70 mm) shared by all three types (KIN-04).
- **`content/susp-macpherson.ts`, `susp-double-wishbone.ts`, `susp-multilink.ts`**: front + rear each, ids
  `macpherson`, `double-wishbone`, `multilink`, visualKey `spatial-linkage`, extras per §7.5, `antiRollBarMount`
  pickups for the visual, digit-free copy reflecting each type's honest strengths (strut: parts/cost/compact/
  isolation, camber good enough for short firm travel; DW: camber control, steady low RC, low friction, low bonnet;
  ML: independent tuning, toe control via compliance, virtual steering axis).
- **Tests** (75): `kinematics-reference` (§7.3), `kinematics-table` (properties, all 9 linkages), `kinematics-gates`
  (§7.4 + report), `db11-fit`; fixture `tests/fixtures/02-02-chrono-sets.ts`.

## Kinematics report (output of `kinematics-gates.test.ts`, GT coupe, cg 0.50 m, brake share 0.62/0.38)
Rear KPI/caster/scrub/trail describe the *virtual toe-link axis* of a non-steered axle (see notes).

| metric | macpherson/front | macpherson/rear | double-wishbone/front | double-wishbone/rear | multilink/front | multilink/rear |
|---|---:|---:|---:|---:|---:|---:|
| camber gain deg/10mm | -0.130 | -0.126 | -0.437 | -0.406 | -0.308 | -0.361 |
| camber @+25mm deg | -0.27 | -0.26 | -1.17 | -1.10 | -0.85 | -0.98 |
| roll camber deg/deg | 0.82 | 0.83 | 0.32 | 0.37 | 0.51 | 0.43 |
| RC mm | 107.1 | 101.0 | 73.7 | 76.8 | 35.6 | 54.1 |
| RC @+30 mm | 64.2 | 58.3 | 66.6 | 67.8 | 24.5 | 40.4 |
| RC @-30 mm | 148.2 | 142.1 | 83.8 | 88.3 | 49.8 | 68.3 |
| RC lateral @2deg roll mm | 337 | 354 | 98 | 112 | 291 | 218 |
| bump steer deg/10mm | 0.004 | 0.005 | -0.005 | -0.005 | 0.002 | -0.018 |
| toe @+70mm deg | -0.008 | -0.014 | 0.017 | 0.021 | 0.001 | 0.054 |
| toe @-70mm deg | 0.008 | 0.014 | -0.013 | -0.015 | 0.006 | -0.048 |
| KPI deg | 12.84 | 12.79 | 6.81 | 6.79 | 7.76 | 10.98 |
| caster deg | 6.80 | 0.80 | 5.97 | 0.00 | 4.71 | -8.43 |
| scrub mm | 20.8 | 19.9 | 21.8 | 21.0 | 18.3 | -26.0 |
| trail mm | 16.8 | 2.0 | 17.0 | -0.0 | 30.7 | -105.5 |
| motion ratio | 0.943 | 0.958 | 0.710 | 0.717 | 0.770 | 0.772 |
| track chg @+30 mm | 2.5 | 2.3 | 1.9 | 2.0 | 0.5 | 1.1 |
| track chg @-30 mm | -5.0 | -4.8 | -3.3 | -3.4 | -2.0 | -2.7 |
| anti-dive/squat % | 30.1 | 18.9 | 23.7 | 11.4 | 16.9 | 20.1 |
| rack range +- mm | 50 | 0 | 48 | 0 | 60 | 0 |

All §7.4 front gates, the three orderings (RC MP > DW > ML; |gain| DW > ML > MP; roll camber MP > ML > DW) and
the rear gates pass. Camber gain per 25 mm (secant): MP −0.27°, DW −1.17°, ML −0.85°.

## Deviations
1. **§7.3 scrub/trail reference values were wrong; corrected.** Research 03's prototype found the steer-axis
   point with an ill-conditioned least-squares solve (its point lands ~1e12 m away), so its scrub/trail digits
   are noise. Independent recomputation (rank-aware least squares, same travel-locked axis) agrees with the
   solver's analytic screw axis: Chrono DW scrub **+5.26** mm / trail **+10.93** mm (§7.3 says 6.2 / 10; the
   ball-joint line gives 5.6 / 11.9 as a sanity check), Chrono MacPherson scrub **103.0** / trail **41.9** mm
   (research said 96 / 57.7). Every other §7.3 value reproduces (the fixture uses the prototype's unrounded
   values, e.g. MP caster 6.64°, which §7.3 rounds to 6.6°).
2. **Steering axis definition:** the travel-locked instantaneous screw axis for every layout (needed for the
   multi-link's virtual kingpin). It differs slightly from the ball-joint line: opensus caster 5.04° vs the
   published ball-joint 5.19° (test: exact 5.037 ± 0.03 and published ± 0.2), MP KPI 11.92° vs line 11.68°.
3. **Shipped hardpoints are our own sports-car packaging, seeded from Chrono topology, not y-scaled Chrono
   points.** Scaling the Chrono sedan DW to the GT track keeps an economy-sedan geometry (−0.19°/10 mm gain,
   RC ≈ 160 mm before the larger tyre lifts it further) far outside the DW gate; the generic MacPherson is a
   truck-scale set with ~100 mm scrub. Making either pass would mean moving nearly every point, i.e. contorting a
   seed. Instead each set follows stated packaging rules (in each file header) and the same tuning method was
   applied to all six axles: identical wheel centre/tyre/alignment/travel, the same side-view inclination of the
   lower-arm pivots (±0.04 slope: front pivot down at the front axle, up at the rear), and the same 2-D search on
   the tie-rod/toe-link inner point for zero toe change at ±60 mm. Camber gain, RC, migration, scrub, KPI, motion
   ratio and anti-pitch are not tuned per type; they emerge. KIN-03 "seeded from Chrono" is met at topology level.
4. **Multi-link = five separate rods** (caller requirement) — Chrono's multi-link has an upper A-arm; it is split
   into two upper links. Front: Audi-style high upper links + transverse lower link + tension link from behind;
   rear: two upper links, forward lower link, transverse spring link behind the drive shaft, toe link.
5. **Wheel centre at y = track/2** (`CarAxleSpec.track` is wheel-centre to wheel-centre and must match the mesh),
   so the contact-patch half track is 10 mm (front) / 8 mm (rear) wider because of static camber; §7.4 asks for
   the contact patch at track/2. **Wheel centre z = unloaded tyre radius 0.382** per §7.4; the mesh shows the
   wheel centre at 0.376 (visually compressed tyre). 02-04 places the body/wheels.
6. Anti-pitch: front = anti-dive, outboard brakes (contact-patch path) × brakeShare; rear = anti-squat for a driven
   independent axle (wheel-centre path, all drive at the rear), as 02-03's `antiPitch.rear` = AS_r (05 §3.2).
7. Rack range covers 1.15 × maxSteer (mean road-wheel angle); `maxSteer` is required for a steered axle (throws).

## Honest notes (things that look less than ideal)
- **Rear KPI/caster/scrub/trail** are the virtual toe-link axis of a non-steered axle; the multi-link rear values
  (11°, −8.4°, −26 mm, −106 mm) are meaningless for the UI. Do not display rear steering-axis metrics.
- **Multi-link RC lateral migration (291 mm front) is far larger than the wishbone's (98 mm)**, close to the
  strut's (337 mm). Research 04 calls multi-link migration "controllable"; this representative low-RC layout
  with long virtual arms does not optimise it. The copy does not claim small migration for the multi-link.
- **The multi-link's real advantage (toe control under load via designed bushing compliance) is not visible in a
  rigid kinematic model.** All three were tuned to near-zero bump steer with the same method; kinematically the
  fronts are equally flat (≤ 0.017° over ±70 mm) and the multi-link rear has the most toe curvature (±0.05°). The copy states the multi-link strength qualitatively.
- **Strut camber recovery is weak (roll camber 0.82: 18 % recovery)**. Research 04 [E] says 30–60 %, but the §7.4
  strut gain band (−0.10 … −0.25°/10 mm) itself implies only ~22–37 % at this track; our −0.13 sits low in the band.
  Strut camber change at +25 mm is −0.27° (research 04 [E]: −0.3 … −0.8). Multi-link recovery 49 % (research [E]
  60–90 %) is also on the low side; DW 68 % is in its band.
- **Strut anti-dive is the highest (30 %)** with the same pivot inclination for all types; it comes from the
  strut's side-view geometry (caster-inclined strut). Research 04 says strut anti-geometry is "limited" (tuning
  range), not low, so not a contradiction, but worth knowing for the brake-dive demo.
- DW track change (+1.9 mm at +30 mm) is below research 04's [E] 3–10 mm per 25 mm for SLAs (moderate IC height).
- Same static camber (−1.5° front) for all three for comparability; real strut cars usually run more.
- Tyre radius 0.382 m is the mesh's (bigger than the real car's tyres); it is the model, not manufacturer data.
- Two "WIP snapshot" commits by another process (`6a4a1a2`) included early versions of my `gt-geometry.ts` and
  `kinematics-table.test.ts`; my later commits supersede them. Nothing else of mine was touched.

## Performance (measured)
- Table build per axle: 36–88 ms steered (≈ 3,700–4,400 nodes), ~1–2 ms non-steered; a whole suspension
  (front + rear) 47–72 ms in plain node. 02-04 caches per (vehicle, suspension).
- `sample()`: ~200–370 ns per corner, **zero heap growth** (≤ 3.8 KB over 300,000 samples, measured with
  `--expose-gc`). Note for the 02-04 no-alloc test: passing values from a plain double array into a non-inlined
  call boxes them in the *caller*; use tagged arrays or object fields as inputs or the test measures itself.
- Interpolation accuracy vs an exact warm-started solve (2,000 random points incl. out-of-range): points ≤ 0.011
  mm, camber/toe ≤ 0.004°, link-length closure ≤ 0.005 mm. **So hardpoint positions from the table are good enough
  for rendering; no per-frame solve is needed.** If ever wanted: a warm-started exact solve per corner per frame
  costs 5–7 µs (≈ 3 iterations at tol 1e-12), 0 failures over 60,000 frames of combined travel and steer.

## Credits for the orchestrator (CREDITS.md / code-credits.ts)
Project Chrono (https://github.com/projectchrono/chrono), BSD-3-Clause, "Copyright (c) 2016, Project Chrono
Development Team": hardpoint data of `Sedan_DoubleWishbone.json`, `generic/MacPhersonStrut.json`,
`Sedan_MultiLink.json` used verbatim in the test fixture `tests/fixtures/02-02-chrono-sets.ts`, and the joint
topology of ChDoubleWishbone / ChMacPhersonStrut / ChMultiLink used for the shipped layouts. No Chrono code copied.
opensus sample: expected values only (licence unverified; no data shipped). Nothing from open-kinematics (AGPL).

## Verification (real output)
```
$ npx vitest run tests/sim-core/kinematics-reference.test.ts tests/sim-core/kinematics-table.test.ts \
    tests/sim-core/kinematics-gates.test.ts tests/sim-core/db11-fit.test.ts
 Test Files  4 passed (4)
      Tests  75 passed (75)
db11-fit measured { wheelbase: 2.9188, trackFront: 1.6935, trackRear: 1.6935, radiusFront: 0.3817,
                    radiusRear: 0.3817, wheelCentreHeight: 0.3756 }
$ npm run check
✔ no dependency violations found (101 modules, 247 dependencies cruised)
 Test Files  24 passed (24)
      Tests  263 passed (263)
```
