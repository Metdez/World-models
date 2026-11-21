# 09-02 SUMMARY — Powertrain, brakes and aids

## Built
- **`drive/powertrain.ts`** (full §7.7): v0 body kept; kick-down to the lowest gear below 0.92 × the CURRENT upshift rpm
  (multi-gear), downshift straight to the right gear (a stop ends in 1st), reverse cap tapered over the last 1 m/s,
  traction cut from `aids.tractionTarget` with the driven tyre's peak slip ratio (new optional 4th argument
  `createPowertrain(p, radius, wheelInertia, peakSlip = 0.16)`), `brakeTorques(brakes, frontShare, rearShare, brake,
  handbrake, out)` (pedal × 7300 N m × brakeShare / 2; handbrake 1500/2 per rear; bias stays 0.62).
- **`drive/aids.ts`** (new, §7.8, "Assist: simplified model"): `createAids(vehicle, frontTrack, rearTrack)` with
  `.state` (`AIDS_STATE_LENGTH` = 9: 4 ABS pressure factors, 4 previous slip ratios, stability hold) and `createAidsIo()`;
  `peakSlipRatio(tyreParams, tyreHandling)` (= peakSlip · μ(N0) / slipStiffness: front 0.172, rear 0.156);
  `tractionTarget(slipSpeed, u, kappaPeak)`; keyboard steering helpers `steeringLimit(view)`, `countersteerHelp(s, view)`,
  `assistedSteer(s, view, steeringOn)` (§7.9 formulas incl. countersteer help, forward only).
  - ABS: per-wheel factor p ∈ [0.1, 1], dp/dt = 200·(κ_pred − κ_t) clamped to [−1/0.02, +1/0.12] s⁻¹, κ_pred = κ + 0.03 s ·
    dκ/dt, κ_t = −0.65 × the axle's peak slip ratio; inactive below 2 m/s (wheels may lock to stop/hold) and on the rears
    while the handbrake is pulled; `absActive` while any p < 0.98.
  - Stability: §7.8 as written (r_t bicycle target, K_REF 0.0018, deadband 0.08 rad/s, β trigger, T = 4·Iz·(|e|−0.08)·R/(t/2)
    ≤ 1500 N m, outer front on oversteer / inner rear on understeer, throttleScale 0.5), plus a 0.25 s hold on the flag
    and the throttle cut. Applied BEFORE ABS so ABS also keeps the stability brake from locking its wheel.
  - Traction: cut starts at 0.3 + 0.5·κ_peak·|u| m/s slip speed, floor 0.15 at 0.81 + 0.925·κ_peak·|u| (slip ratio
    0.108..0.226 at 10 m/s, 0.088..0.172 at 30 m/s).
- Content `gt-coupe-powertrain.ts`: unchanged (§7.15 values already right).
- Tests: `tests/sim-core/powertrain.test.ts` (16), `tests/sim-core/aids.test.ts` (9), all fake io.

## Measured (real output)
- Upshift rpm: throttle 0.1 → 2620 (all 7 shifts), throttle 1 → 6400; no hunting on 150 s up/down ramps at 0.05/0.3/0.6/1.
- Kick-down at 25 m/s: 5th → 2nd (5309 rpm), holds 2 s at full throttle. Cut 0.18 s (torque 0), linear 0.15 s ramp,
  lockout 0.6 s ± 2 steps. LSD = Jolt formula to 1e-12. Engine braking at 4000 rpm = −(40 + 0.012·4000)·ratio·0.92 exactly.
  Zero torque at throttle < 0.05 at rest; reverse = 0.5 × throttle, 0 at the 7 m/s cap.
- ABS fake wheel (09-01 curve, 25 → 1 m/s): front min κ −0.113 (target −0.112), 27.4 m vs locked 29.0 m; rear min κ −0.102,
  48.0 m vs locked 51.6 m. §7.8's on/off rule (−0.12, 0.04/0.12 s) gave 36.6 m vs 32.1 m locked and −0.22 overshoot.
- Stability, e = 0.3 rad/s at 20 m/s: 1111 N m on the outer front (oversteer) / inner rear (understeer), mirrored exactly.
- Plant (v0 plant + 09-01 tyre + this powertrain, clean worktree at 6128dac): **0–100 km/h 5.09 s** (TCS on; 09-01
  measured 5.67 s with the v0 thresholds), 100–0 40.1 m (ABS not wired yet), skidpad 0.98 g, fuzz 0 faults, plant step
  15.5 µs. `runDriveScript(7, 60)` hash changed (8867f053 → e165fa72; it is printed, not pinned). Auto/M1 goldens unchanged.
- `npm run check`: in the shared tree typecheck fails only in 09-03's in-progress files (kinematics/*, math/det.ts);
  in a clean worktree at HEAD 6128dac + my files: `tsc` (app, worker, node) clean; vitest `Test Files 1 failed | 71 passed
  | 1 skipped`, the 1 failure = `simulation.test.ts` "full lap … step cost" (timing under parallel load; passes alone:
  `Tests 11 passed`); depcruise (shared tree) `✔ no dependency violations found (241 modules, 797 dependencies cruised)`.

## Deviations
1. ABS law: proportional slip regulator with lead, target from the tyre's peak (§7.8's bang-bang stopped longer than locked).
2. TCS thresholds: scaled with κ_peak·|u| (§7.7's fixed 1.5/2.5 m/s runs the rear far past peak at low speed).
3. Kick-down below 0.92 × the current upshift rpm, not 0.92 × redline (6440 > the 6400 full-throttle upshift → hunting);
   kick-down and downshift go straight to the target gear (one-at-a-time with a 0.6 s lockout left the car in 4th at rest).
4. Interface additions: `AidsIo.handbrake` (in), `createPowertrain` optional `peakSlip`, `AIDS_STATE_LENGTH`/`.state`,
   exported helpers above. Stability 0.25 s hold. ALPHA_PEAK stays 0.12 rad per §7.9 (09-01's lateral peak is ≈ 0.17 rad,
   so the steering cap keeps the fronts just below peak — deliberate for keyboards).

## What 09-04 must know (wiring)
- Order per step: `brakeTorques(...)` → fill AidsIo (slipRatio = previous step's tyre slipRatio, steerAct = actuator δ, u, r,
  β, handbrake) → `aids.step(dt, io, aids, view)` → use `io.brakeTorque[i]` instead of the plant's inline `tb` →
  `pio.throttle = cmd.throttle * io.throttleScale` → `powertrain.step`. Pass `peakSlipRatio(rear tyre)` as the 4th
  `createPowertrain` argument. Flags: `d.absActive = io.absActive`, `d.stabilityActive = io.stabilityActive`.
- Add `aids.state` (9 doubles) to the snapshot; `aids.reset()` on engage/place/reset.
- HumanDriver: replace the inline limit with `assistedSteer(s, view, aids.steering)` (adds the countersteer help).
- With aids on, TCS + stability throttle cut + the 2.5 /s digital throttle ramp are what make full keyboard throttle
  drivable; with aids off power oversteer is expected. Not verified in the integrated plant (09-04's T-tests).

## Lifted code (for CREDITS)
- No code copied. Shapes/ideas: Jolt Physics VehicleTransmission + VehicleDifferential (MIT, Copyright 2021 Jorrit Rouwe;
  LICENSE re-checked 2026-11-21 at raw.githubusercontent.com/jrouwe/JoltPhysics/master/LICENSE) → shift state machine and
  LSD formula in `powertrain.ts`; Godot-Easy-Vehicle-Physics (MIT, (c) 2024 David Shoemaker, (c) 2021 Dechode, (c) 2024
  Baron Wittman; LICENSE re-checked 2026-11-21) → ABS release / TCS slip cut / countersteer assist ideas in `aids.ts`;
  ArcadeCarPhysics (MIT, (c) 2018 Sergey Makeev) → speed-limited steering idea (already in 08-02's HumanDriver).
