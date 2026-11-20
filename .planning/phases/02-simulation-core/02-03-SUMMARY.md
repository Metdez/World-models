# 02-03 SUMMARY — 7-DOF ride model and tyre grip indicator

**Status:** complete · commits `9f13512` (plan), `5dc540d` (integrator), `1d8fd92` (load-transfer tests),
`8955c78` (grip indicator + modal/energy/stability tests), plus this summary.

## Built
- `src/sim-core/ride/ride7dof.ts` — the §7.2.3 interface (`createRideModel`, `RideParams`, `RideInput`,
  `RideState`, `RideModel`) plus small parameter helpers: `wheelRateForRideFrequency(f, cornerMass, tyreRate)`
  (ride rate = wheel rate in series with the tyre), `dampingForRatio(ζ, wheelRate, cornerMass)` (ζ at the wheel,
  as `CarAxleSpec.damping` says), `arbRateFromRollStiffness(K, track)` = K/t², `rollCentreFromCurves(curves, tL, tR)`
  (symmetric-travel curve at mean travel; prefer `KinematicsTable.rollCentreHeight` where available).
  - q = (heave, roll, pitch, 4 hubs) as deviations from static equilibrium; spring preload = static sprung corner
    load (lever rule), so travel 0 = design ride height under static load.
  - Load transfer, derived from the free-body diagram (derivation in the PLAN and the file header): lateral link
    forces act on the body at ground level (torque ms·ay·h) plus a vertical link pair ±ms_j·ay·h_rc,j/t_j per axle
    (equivalent to the axle lateral force at the roll centre). Research 05 §3.1's force-input form applies the pair
    AND a torque about the roll axis, which double-counts the geometric part; not used. Roll tilt
    +ms·g·(h − h_rollaxis)·φ. Longitudinal: torque −ms·ax·h, anti pairs ±antiPitch_j·ms·ax·h/(2L) per wheel.
    Unsprung inertia (m_u at wheel-centre height) goes straight to the tyres.
  - ARB: F = arbRate·(travel_i − travel_other) per axle (verified roll stiffness = arbRate·t²).
  - Integration: semi-implicit Euler, (M + dt·C)v' = Mv + dt·Q(q), q' = q + dt·v', 7×7 Gaussian solve
    (`math/linsolve`). Implicit: dampers (bump/rebound by travel-rate sign), tyre damping, Coulomb friction
    (tanh, linearised), bump/droop stop stiffness (10×wheelRate, +100 %/10 mm progressive, capped at 4×).
    Explicit: springs, ARB, tyre springs (symplectic, no numerical damping on ride/hop modes).
  - Tyre force clamped ≥ 0 (contact = positive spring deflection and positive total force).
  - `reset(input)` = Newton solve of the full force balance (finite-difference stiffness) — static equilibrium
    including ax/ay/road heights, matches the dynamically settled state.
- `src/sim-core/ride/tyre.ts` — `peakMu(load, camberToRoad, tyre)`, `gripUse(load, fy, fx, camberToRoad, tyre)`
  = |F|/(μ(Fz)·Fz) with μ(Fz) = μ + loadSensitivity·(Fz − nominal) (floored at 10 % of μ) and −2 %/° beyond 3°
  |camber to road|; `camberToRoad(curves, travel, roll, left)`. Documented as a **model indicator, not a
  measurement** ("grip use (model)").
- Tests: `tests/sim-core/ride.test.ts`, `ride-transfer.test.ts`, `ride-modal.test.ts`, `ride-tyre.test.ts`;
  fixture `tests/fixtures/02-03-ride.ts` (GT-coupe-like estimates per §7.5, synthetic kinematic curves).

## Measured (fixture: ms 1540 kg, h 0.50, L 2.90, tracks 1.66/1.65, ride 1.45/1.60 Hz, ζ 0.32/0.58, kt 260/280 kN/m, ARB 140/80 kN·m/rad, RC 80/100 mm)
| Check | Result |
|---|---|
| Static | Σ loads = weight (1e-12), front/rear lever split, spring = sprung corner weight; settles back to tyre = load/kt, spring = load/rate (< 1 %) |
| Ride frequency (decoupled ends, symmetric ζ 0.25 at wheel) | front 1.460 Hz (target 1.45), rear 1.612 Hz (target 1.60) |
| Body damping ratio | 0.206 / 0.202 measured vs predicted ζ·r^1.5 = 0.204 / 0.201 (r = kt/(k+kt); tyre shortens damper stroke) |
| GT fixture body mode (front step, asymmetric) | 1.586 Hz, ζ 0.51 |
| Hop (impulse, damping-corrected) | 14.65 Hz vs analytic 14.85 Hz (hub ζ ≈ 0.8 in rebound — heavily damped) |
| Roll mode | 3.34 Hz, ζ 0.24 (stiff ARB + Ixx 550; see gaps) |
| Lateral transfer at 0.8 g | per axle 2125 / 1892 N = closed form (±1 %); roll 1.407° = closed form |
| Total vs m·ay·h/t | 4017 vs 3926 N (+2.3 % = roll tilt + track difference; global moment balance holds to < 0.5 %) |
| Roll gradient | 1.759 °/g (closed form 1.759; rigid-tyre textbook 1.091); RC 30/50 mm → 1.90, RC 130/150 mm → 1.62 °/g |
| Pitch, 1 g braking | anti 0/0 1.478°, 0.25/0.25 1.160°, 0.25/0 1.306° (all = closed form ±1 %); front axle gain 2800 N |
| Energy | undamped 60 s: bounded ±4.5 % (symplectic oscillation), late/early mean 1.00006; damped release: max E/E0 = 1.000000, decays to 4e-31 |
| Stability (stiffest: 2.5 Hz ride, 400 kN/m tyres, 25 kg hubs, ARB 400 kN·m/rad, 300 N friction, 30 mm stops) | stable under ±60 mm road steps + ±1.2 g / −1 g pulses; hub ω·dt ≈ 0.75 (limit 2 → 2.65× frequency margin); measured: tyre rate can be scaled 23.6× before it stops settling |
| Determinism | bitwise-identical 2400-step trajectories |
| Allocation | 3.6 KB heap delta over 200 000 steps (min of 3; noise floor), state arrays identity-stable |
| Step cost | 0.59 µs/step (≈ 141 µs per simulated second) |

## Deviations
1. **Additive optional field** `RideCornerParams.wheelCentreHeight?: number` (default 0) for unsprung load
   transfer — the §7.2.3 interface has no wheel-centre height. **02-04: set it to the tyre radius.**
2. `RideInput.antiPitch` is interpreted as "fraction of each axle's longitudinal load transfer carried by the
   links" for whatever ax sign is passed; 02-04 picks the value (anti-dive vs anti-lift/-squat, brake share already
   in the table's `antiPitch`).
3. `state.stop` = penetration / 10 mm (signed, + bump, − droop); the §7.6 event `stop > 0.5` = 5 mm into the stop.
   `damperForce` = viscous only (friction excluded); `springForce` includes preload.
4. Small-angle model: no rollover handling. ay above the static rollover threshold t/(2h) ≈ 1.66 g tips the body
   (the path follower's 0.85 g limit is far below).
5. Grip: no Magic Formula slip-angle output (`alpha_eff = alpha + 0.2γ` is unused) — only the peak matters for the
   indicator (`shortcut:` comment in tyre.ts).

## For 02-04 (tuning notes, not edits)
- Roll gradient measured as absolute body roll includes **tyre compliance**: with this fixture the rigid-tyre
  textbook value is 1.09 °/g but the model gives 1.76 °/g. Hitting the 1.0–1.2 °/g gate needs roughly twice the
  ARB of a rigid-tyre estimate (tyre roll stiffness kt·t²/2 ≈ 360 kN·m/rad is in series). Expect roll mode > 3 Hz
  with Ixx 550.
- `dampingForRatio` gives ζ at the wheel; body modes see about 0.82× of it with these tyre rates.

## Known gaps
- Pitch has no "tilt" (gravity × pitch-centre) term; anti geometry makes the pitch centre ill-defined in this model.
- Roll-centre lateral migration is not modelled (only height enters).
- Licence: no code lifted; equations derived here (research 05, textbook vehicle dynamics). Nothing for CREDITS.

## Verification (real output)
```
$ npx vitest run tests/sim-core/ride --silent=false
[ride] decoupled ride modes: front 1.460 Hz (target 1.45) ζ 0.206 (wheel 0.25, predicted body 0.204); rear 1.612 Hz (target 1.6) ζ 0.202 (wheel 0.25, predicted body 0.201)
[ride] 0.8 g: roll 1.407° (closed form 1.407°), transfer front 2125 N rear 1892 N (closed form 2125 / 1892), total 4017 N vs m·ay·h/t 3926 N (+2.32 % = roll tilt + track difference)
[ride] roll gradient: 1.759 °/g (closed form 1.759, rigid-tyre textbook 1.091); RC 30/50 mm 1.901, RC 130/150 mm 1.618 °/g
[ride] GT fixture: front-end body mode 1.586 Hz ζ 0.511 (bump 0.32 / rebound 0.58); roll mode 3.339 Hz ζ 0.237; hop 14.65 Hz ζ 0.811 (impulse response, damping-corrected; analytic 14.85 Hz)
[ride] pitch under 1 g braking: anti 0/0: 1.478° (closed form 1.478°); anti 0.25/0.25: 1.160° (closed form 1.160°); anti 0.25/0: 1.306° (closed form 1.306°); front axle gain 2800 N
[ride] undamped 60 s: max |E/E0 - 1| 0.0450, late/early mean energy 1.00006
[ride] damped release: max E/E0 1.000000, largest single-step rise 1.67e-32 E0, final 3.91e-31 E0
[ride] stiffest config: hub ω·dt ≈ 0.754 (undamped explicit limit 2 → 2.65x frequency margin); measured: tyre rate can be scaled 23.63x (9452 kN/m) before it stops settling
[ride] heap delta over 200000 steps: 3560 B
[ride] step cost: 0.586 µs/step (141 µs per simulated second)
 Test Files  4 passed (4)
      Tests  29 passed (29)
```
`npm run check`: see the final report (typecheck of other executors' in-progress files decides the outcome).
