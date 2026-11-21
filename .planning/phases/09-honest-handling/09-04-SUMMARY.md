# 09-04 SUMMARY — Plant integration, safety and validation

## Built
- **Det sweep** (`car/car-model.ts`, `ride/ride7dof.ts`): Math.sin/cos/tan/atan/tanh → det kernels; `tests/arch/det-math.test.ts`
  now covers ALL of `src/sim-core`. dtanh checked first: 0 mismatches vs `Math.tanh` on 3.5 M arguments; dsin/dcos/dtan/
  datan 0 on 10^6. **Goldens unchanged** (car 53e95141 / a8a25413 / 64d2ddf9, moto unchanged). `math/det.ts`: dtanh's expm1
  now runs through a scratch slot (`expm1Scratch`) — the kernel is too big for V8 to inline and the boxed double cost
  5.4 MB per 200 000 ride steps (the ride no-alloc test caught it). Same bits.
- **Plant integration** (`drive/plant.ts`, §7.2 order): `brakeTorques` → aids (stability, then ABS; throttle scale) →
  powertrain with the driven tyre's `peakSlipRatio`; compliance toe/camber per wheel from the previous step's forces
  (Fy_in = −side·fy, Fx sign picks brake/drive coefficient, clamp ±maxAngle, backward-Euler filter τ = 30 ms; derived
  once per installed suspension; `maxAngle = 0` skips the arithmetic entirely = kinematics-only plant); jacking through
  the new optional `RideInput.linkVertical` (ride7dof: absent → the M1 expression untouched) = −slopeᵢ·Fyvᵢ·mₛ/m with the
  front-view IC-line slope (clamp 1.5, non-finite → 0, right corner mirrored) and Fyv low-passed at 8 Hz like the ride's
  a_y (seeded from the Auto a_y at an engage); flags absActive/stabilityActive; aids state (9), compliance filters (8)
  and the jacking low-pass (4) in the snapshot (`PLANT_SNAPSHOT_LENGTH` grew); aids reset on engage/place.
  HumanDriver steers through `assistedSteer` (steering limit + countersteer help). The ride low-pass α is recomputed when
  dt ≠ SIM_DT (T18). Test-only `PlantOptions { linearTyre, rigidLoads }` via a 5th `createCarModel` argument. Validation
  read-out `plant.wheelAngles(out)` (wheel angles, compliance toe, compliance camber).
- **Safety**: a fault restore now also clears the faulted step's a_x/a_y from the record (frame a_x/a_y was NaN for one
  step); a car placed off the corridor no longer faults every step (NaN hints after the ground stopped needing them).
- **Ground** (`world/project.ts`, `world/ground.ts`, `world/terrain.ts`), item 5 + the 08-05 evidence:
  - projection = the GLOBAL nearest centreline point: Newton from every local-minimum node an 8 m grid lists for the
    point's cell; the hint is ignored (it used to keep a wheel on the section it came from: 0.57 m sunk, and global
    fallbacks jumped). Hinted = cold exactly (test).
  - off the ribbon the terrain is continuous in (x, y): every centreline node within 30 m of the nearest point contributes
    the same M1 profile (its edge height on the point's side, the dip, the far-field blend, on the node distance) with
    weights 1/e² − 1/(e₀+30)², e = d − 17 m (`createBlendedTerrain`). The nearest section dominates at its own edge; the
    corridor (|l| ≤ 18) is still exactly `roadHeight`. Worst neighbour step on a 0.1 m grid over the whole drivable area:
    **56.7 mm per 0.1 m** (was 3.46 m cliffs) — the embankment in the 4.9 m gap between the launch straight and bump strip
    ribbons, which differ by ~2.4 m in height (a slope of ~0.5 is the least that gap allows).
  - **Renderer (features/track terrain, not mine) must re-bake from `world.terrainHeight(x, y)`** (= the blended function;
    `loopTerrainHeight` / `features/track/terrain.ts groundHeight` remain the single-section M1 profile, still equal to
    each other to 1e-9, but no longer the ground off the ribbon where two sections are within 30 m).
- **Tests** (all new unless noted): `handling-{bicycle,steady-state,transient,longitudinal,combined,invariants,
  suspension,keyboard}.test.ts`, `plant-{safety,no-alloc,ground}.test.ts`, `plant-standstill` (+5 % slope), `handoff`
  (+first second after engage), fixture `tests/fixtures/09-04-handling.ts` (flat/shaped test world, rig, launch, speed
  hold, circle keeper, ramp, step steer, turn events).

## Measured (real output)
| test | result | band |
|---|---|---|
| T1 linear single-track (linear tyre, rigid loads, compliance off, open diff) | r/δ −0.06/−0.09/−0.18 %, a_y/δ −0.05/−0.09/−0.30 %, K 0.538 vs 0.536 °/g (+0.5 %) at 20/27.8/40 m/s | 1 % ✓ |
| T2 K sign / V_char | −0.50 → −0.496 (V_crit 57.5 vs 57.3); 0 → 0.004; 1 → 1.002 (V_char 40.5/40.5); 2.83 → 2.833 (24.1/24.1) | 3 % ✓ |
| T3 K(0.3 g) R 50 m | macpherson **0.75**, double-wishbone **0.74**, multilink **1.20** °/g; left/right equal to 0.01; K at 85 % of peak 5.4/5.3/5.2 (×7.2/×7.2/×4.3) | 0.5–3.5, ≥1.5× ✓ |
| T4 roll gradient | 1.64 / 1.71 / 1.79 °/g vs Auto 1.63 / 1.70 / 1.78 | ±10 % ✓ |
| T5 skidpad R 45.7 m | **0.956 / 0.957 / 0.956 g** | 0.90–1.10 ✓ |
| T6 step steer 100 km/h, 4 m/s² | T_yaw 0.183/0.183/0.154 s, T_ay 0.33/0.33/0.27 s, overshoot 5.9/5.7/11.4 %, gain within 8.4 % of the single-track gain with the quasi-steady K | ✓ |
| T8 overshoot vs speed (DW) | 10 m/s 9.5 %, 20: 3.4 %, 30: 5.9 %, 40: 13.8 % (rises from 20 m/s; at 10 m/s the tyre relaxation lag σ/u = 60 ms adds overshoot) | stable ✓ |
| T11 brake in turn 0.39 g | path curvature ×1.155 at 0.5 s (0.22 g: ×1.089), max β 0.4°, grip use ≤ 0.65 | ✓ |
| T12 lift-off 0.45 g | curvature ×1.036, yaw-rate change 0.6 % | ✓ |
| T13 power-on 0.4 g | aids off: power oversteer (curvature ×5, β 13.8° in 1 s); aids on: ×1.19, β 0.8° | ✓ |
| T14 100–0 km/h | **ABS 37.5 / 37.6 / 37.6 m** (peak 1.09 g, lamp on); ABS off 38.9–39.0 m, wheels locked | 34–42 ✓ |
| T15 0–100 km/h TCS | **4.99 s** — OUTSIDE 3.6–4.8 (see deviations) ; 1st gear a_x 0.607 g = 96 % of the rear tyres' 0.635 g capacity; gears 1>2, no hunting | ✗ (reported) |
| T16 | load sum / m g − 1 ≤ 6e-12; transfer moment = ride statics to 0.00 % | ✓ |
| T17 | mirror 7.1e-15; idle 10 s drift 0.0000 mm | ✓ |
| T18 240/480 Hz | a_y 0.00 %, yaw rate 0.00 %, peak −0.35 % | 2 % ✓ |
| T20 | flag quiet at 0.3 g; on for κ > 0.3, β > 10°, a_y > 0.85 μ g | ✓ |
| S1 | 5 % slope, brake / handbrake, nose up/down, 10 s: **0.0000 mm** (released: rolls) | ✓ |
| S2 | 200 000-step fuzz: all finite, 0 faults; NaN command → restore, faults 1, keeps driving | ✓ |
| S3 | **plant step median 17.1–17.6 µs** (p90 19.8), heap churn 19–95 B/step (sampling heap profile of the step: no allocation sites) | ≤ 25 ✓ |
| H1 | position 2.3 mm, speed 0.012 m/s, yaw rate 0.0033 rad/s, roll 0.10 mrad, travel 0.03 mm, load 0.32 %; first second after engage: no ABS, no fault, yaw-rate step < 0.02 | ✓ |

### Suspension-type honesty report (same car, same scripted inputs, aids off unless stated; `handling-suspension.test.ts`)
| metric | macpherson | double-wishbone | multilink |
|---|---|---|---|
| understeer gradient K at 0.3 g (°/g) | 0.75 | 0.74 | 1.20 |
| K at 0.5 g (°/g) | 1.16 | 1.15 | 1.64 |
| roll gradient 0.1–0.5 g (°/g) | 1.64 | 1.71 | 1.79 |
| skidpad R 45.7 m (g) | 0.956 | 0.957 | 0.956 |
| step steer 100 km/h, same 1.106° steer: steady a_y (m/s²) | 3.89 | 3.91 | 3.37 |
| step steer: yaw-rate response time (s) | 0.183 | 0.183 | 0.154 |
| step steer: yaw overshoot (%) | 5.8 | 5.7 | 11.1 |
| ISO 3888-2-style lane change 80 km/h, same 2.2° input: peak sideslip (°) | 0.45 | 0.45 | 0.23 |
| lane change: peak yaw rate (rad/s) | 0.238 | 0.238 | 0.218 |
| brake in turn (0.45 g, pedal 0.3): yaw deviation over 1 s (°) | 0.27 | 0.32 | 0.19 |
| brake in turn: path curvature ratio at 0.5 s | 1.146 | 1.155 | 1.126 |
| rear compliance toe steady 0.45 g, outer / inner (°, + toe-in) | 0.141 / −0.051 | 0.135 / −0.060 | 0.378 / −0.159 |
| rear compliance toe braking in the turn, outer / inner (°) | 0.133 / −0.072 | 0.126 / −0.085 | 0.426 / −0.147 |
| rear axle steer (kinematic + compliance) steady / braking (°, + into the turn) | 0.100 / 0.106 | 0.093 / 0.102 | 0.256 / 0.280 |
| bump strip (left track, 30 mm, 25 m/s, steer 0): drift at 110 m (m) | −0.114 | −0.110 | −0.151 |
| bump strip: peak yaw rate (rad/s) | 0.0020 | 0.0018 | 0.0024 |
| 100–0 km/h ABS (m) | 37.5 | 37.6 | 37.6 |
| ride: body vertical accel RMS, loop pave 15 m/s (m/s²) | 1.51 | 1.48 | 1.48 |

Control: the same tables run twice give identical numbers (asserted). Best per metric: skidpad DW, lane-change sideslip
ML, braking MP, ride ML, bump yaw DW, overshoot DW — **no universal winner**.

**Sign of the multi-link rear compliance**: under lateral load the outer rear toes IN (+0.38°) and the inner rear toes
OUT (−0.16°): both rear wheels steer INTO the turn (axle +0.26°) = toward understeer/stability; under braking in the turn
the outer rear toes in further (+0.43°) and the axle steers further into the turn (+0.28°): stabilising, not oversteer.
(MacPherson / double wishbone do the same at about a third of the size.)

**What a keyboard driver could feel**: the multi-link car needs ~17 % more steer for the same corner (K 1.2 vs 0.75 °/g;
same input gives 3.4 vs 3.9 m/s²), turns in faster with more yaw overshoot (0.15 vs 0.18 s, 11 vs 6 %), and stays
calmer in a quick lane change (half the sideslip) and when braking in a turn — plausibly noticeable as "heavier, more
planted rear". Below notice: MacPherson vs double wishbone in every row (≤ 0.07 °/g roll gradient, ≤ 0.05° yaw), skidpad
(0.001 g), braking distance (0.1 m), ride RMS (2 %), bump-strip drift (4 cm over 85 m).

### Drivability (clumsy keyboard through the whole Manual chain, `handling-keyboard.test.ts`)
- Full throttle from rest, no steering: aids on 26.7 m/s after 5 s, β 0.0°, traction lamp on; aids off: spins (β 90°) —
  power oversteer as expected.
- Full-lock stabs at 25 m/s (L/R/L/R 0.25 s): aids on β 2.4°, yaw rate back to 0.000; aids off β 7.6°, no spin.
- Panic brake mid-corner at 0.8 g, lock held: aids on β 5.4° (the larger CG sideslip below 8 m/s on lock is kinematic),
  ABS + stability lamps, stops; aids off β 7.4°, no spin.

### Ground (item 5)
- 0.1 m grid over the drivable area: worst terrain step 56.7 mm (embankment, above), worst anywhere 60.2 mm (kerb edges);
  hinted vs cold 0.
- Driving off the edge at 20 m/s and 20° at 16 places: no wheel lifts at 14 (min load 1.08–3.20 kN). Two lift for real
  and are excluded with the reason: s 320 right drives off the bump strip's runoff edge down the ~1 m embankment toward
  the launch straight; s 900 left crosses the ridge where the banked runoff (rising 0.13 m/m to l = 18 m, the drawn
  ribbon) meets the falling terrain. No discontinuity remains in the ground function.
- 08-05's question, the zero loads on the launch section (s 0–90 at 36 m/s, Auto and Manual alike): physically
  plausible. The launch washboard is 12 mm amplitude sweeping 3.0 → 0.9 m wavelength = 12 → 40 Hz at 36 m/s, through the
  wheel-hop mode (√((260 + 37) kN/m / 40 kg)/2π ≈ 13.7 Hz); above hop the hub barely follows, so the tyre deflection
  varies by about the road amplitude, ~12 mm against a 16 mm static deflection, plus class-C roughness and the
  resonance gain: the tyre unloads. That is the section's purpose ("finds the body and wheel-hop resonances"). Auto unchanged.

## Deviations
1. **T15 0–100 km/h 4.99 s, outside the accepted 3.6–4.8 s.** Friction-limited: the rear tyres (the Auto model's peak μ
   1.1 at 4.2 kN, load-sensitive, ~5 kN per rear wheel under transfer) carry 0.635 g; TCS uses 96 % of it. The band needs
   ~0.75 g. Not tuned (tyre μ is shared with Auto's gripUse/goldens; content files are not mine). The test asserts ≥ 90 %
   of the capacity and < 5.3 s and prints the band result. Also seen: the full-throttle upshift waits for driven slip
   < 0.1 while TCS holds ~0.13 (09-02's rules), so 1st runs to ~6900 rpm — worth ~0.1 s; 09-02's file, reported.
2. Jacking uses the 8 Hz low-passed per-wheel Fyv (like the ride's a_y), not the raw force (§7.6 silent on filtering;
   raw forces would drive the ride at frequencies the M1 input never had).
3. Projection ignores the hint (correctness: a function of (x, y)); `Frenet.converged` is always true now.
4. T1/T2 use an open differential (the limited-slip split of the inner/outer rear speed difference adds an understeer
   moment ∝ curvature that the single-track model lacks: +1.8 % K at 20 m/s with it).
5. T6 gain compares with K from the R 50 m quasi-steady run (0.9 °/g at 14 m/s) — 8.4 % off the step's own 0.67 °/g; the
   difference is the LSD moment and Ackermann at the tighter radius.
6. T8 "overshoot grows with speed" holds from 20 m/s; at 10 m/s relaxation lag gives 9.5 %.
7. T10 (annex lane, PathDriver) is 10-04's; the honesty report uses a scripted open-loop lane-change input instead.
8. Ride-street RMS uses the loop's pave section (the annex ride street is 10-02's).
9. Edited outside my listed files: none. `tests/sim-core/drive-plant.test.ts` (08-02) still prints "no ABS in v0" — its
   100–0 is now 38.3 m with ABS; not edited. A harness WIP snapshot committed a scratch probe of mine
   (`tests/zz-scratch-ground.test.ts`), removed in e372908.
10. HumanDriver state is still not in the plant snapshot (11-03, as planned).

## Verification
- `npm run check`: typecheck clean; `✔ no dependency violations found (242 modules, 805 dependencies cruised)`;
  `Test Files 83 passed | 1 skipped (84)`, `Tests 856 passed | 11 skipped (867)`. Goldens unchanged.
- `runDriveScript(7, 60)` (not pinned) is now e98c2d44 (plant behaviour changed); the e2e Node-vs-Chromium spec compares
  live, not run here (no Playwright in this plan).

## Lifted code
None new (expm1 restructure of the existing fdlibm code in det.ts).
