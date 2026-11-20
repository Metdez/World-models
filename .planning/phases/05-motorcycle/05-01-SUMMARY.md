# 05-01 SUMMARY — Motorcycle simulation + content

**Status:** complete (no deploy, no Playwright).
**Commits:** `7ba9245` plan. The code, content and tests were picked up by the orchestrator's
"WIP snapshot" commits (`351e06b`, `6170d44`, `0fc00fe`) before I could commit each task myself. There is nothing
left uncommitted in my files, so this SUMMARY commit is the only one after the plan.

## Built
- **`moto/planar.ts`**: one 1-DOF mechanism per end, tabulated on a 1 mm grid of vertical wheel travel. The grid is
  ±(travel + 30 mm) around the static ride height drawn in the definition.
  - telescopic: prismatic along the steering axis.
  - Telelever: an A-arm with a ball joint on the fork; the steering axis is the head → joint line, so the lower fork
    body rotates.
  - swingarm with a direct shock.
  - 4-bar linkage: circle–circle intersection, with the assembly branch taken from the drawn design.
  - Each row holds:
    - the wheel centre and the shock length;
    - MR = d(compression)/dw;
    - `kx` = dx/dw of the tyre's lowest point fixed in the wheel carrier (the brake coupling; callipers sit on the
      slider or swingarm);
    - the chain coupling `chi`;
    - the instant centre (rear: swingarm line ∩ chain top run; front: the carrier IC, clamped to 5 m);
    - the steering-axis direction;
    - every named point.
- **`moto/ride4dof.ts`**: the 4-DOF model (heave, pitch, two wheel hops). Each end transmits
  `E = S − Fx·kx (− Fx·(R/r)·chi when driving)` to the body, from virtual work.
  - Pro-dive, anti-dive and anti-squat therefore come out of the geometry. Quasi-statically,
    AD = β·kx·L/h and AS = −(kx + (R/r)·chi)·L/h.
  - Springs: preload, dual-rate and progressive. Dampers: bump/rebound × MR². Fork stiction: tanh. Stops on both
    ends. Four substeps per step.
  - The **static sag is solved from each spring curve**; droop = sag, bump = travel − sag.
  - `reset()` is a closed-form equilibrium: a bisection per end, followed by z and θ from the two travels. It
    cannot fail or throw.
- **`moto/lean.ts`**:
  - target lean γ* = atan(ay/(g·cos grade)) + bank;
  - a 2nd-order tracker (ζ 0.9, ω 6 rad/s);
  - crown-corrected frame lean φ = γ + asin((ρ/H)·sin γ);
  - steer from the inverse roll balance δ' = (L/v²)(ay − h·γ̈), which gives countersteer on turn-in;
  - a blend to L·κ/cos ε below 3–6 m/s and a ±20° clamp.
- **`moto/model.ts`**: `createMotoModel` implements the VehicleModel seam as it stands. No edit to `simulation.ts`,
  `vehicle-models.ts` or `index.ts` was needed (the stub was already registered).
  - Road input = road height minus the smooth plane (elevation + l·tan bank) at each contact. The plane through
    the two contacts carries the body, and its vertical curvature adds v²·κ_v to g_eff.
  - g_eff = sqrt((g·cos grade)² + ay²) + vertical-curve acceleration.
  - TRUE values: live trail and wheelbase from the pitched geometry, AD/AS at the current travel.
  - Load is road-normal (N·cos γ). Grip use is a friction circle labelled "model".
  - POSE: the body leans about the tyre-crown line over the contact line. Steered fork points rotate about the
    steering axis. Contact patches sit on the leaned crown. Event hysteresis is the same as the car's.
- **Content**: `cafe-racer.ts` (vehicle, with the shared frame geometry exported), plus `moto-classic.ts`,
  `moto-modern.ts` and `moto-telelever.ts`.
  - All three presets share the swingarm pivot. Both telescopic presets share the rake and offset.
  - The vehicle and the presets share one lap; the mechanisms are the only differences.
  - Every number is an estimated input. What is displayed is computed. The copy has no digits.

## Contract notes for 05-02 (visual) — pointOrder exactly per §7.7
- `steeringHead` = the top head bearing, on the steering axis.
- `crownTop` = the top of the fork leg in the upper yoke, `offset` ahead of the axis.
- `forkBottom` = the sliding joint of the leg, `SLIDER` = 0.34 m up the leg from the axle; it moves with the wheel.
- `axle` = the wheel centre. `contactPatch` = the leaned crown contact on the road.
- Telelever adds `armPivot`, `armJoint` (on the steering axis), `shockTop` and `shockArm`.
- Twin shocks: `shockTop` and `shockLower` carry y = +0.12 (left side); the visual mirrors the right one.
- Front fork points are already rotated by the steer. `wheelRotation` includes lean and steer.
- Lean is `frame.roll`. Amplification does **not** scale the lean (see deviations).

## Measured metrics (real output, `tests/sim-core/moto-sim.test.ts`, brake-zone peak −0.76 g)

| preset | anti-dive | anti-squat | trail static / at brake peak | fork / rear travel at brake peak | pitch | sag front / rear | bounce |
|---|---|---|---|---|---|---|---|
| Classic (RSU + twin) | −76 % | 127 % | 94.3 / 73.5 mm | +49.4 / −21.1 mm | 3.25° | 30.2 mm (28 %) / 34.8 mm (29 %) | 2.15 Hz |
| Modern (USD + linkage) | −76 % | 127 % | 94.3 / 72.6 mm | +50.9 / −23.9 mm | 3.41° | 31.2 mm (28 %) / 36.2 mm (30 %) | 2.09 Hz |
| Telelever + single-sided | +55 % | 127 % | 102.9 / 94.1 mm | +17.0 / −17.3 mm | 1.77° | 32.6 mm (28 %) / 33.0 mm (28 %) | 2.26 Hz |

- **Rear MR over the travel:**
  - twin shock 0.747 → 0.764 (near linear);
  - linkage 0.327 → 0.491 (rising, ×1.50);
  - single-sided 0.579 → 0.592.
- **Trail through the travel with the frame held level:**
  - telescopic: constant at 94.3 mm;
  - Telelever: 97.8 / 102.9 / 112.2 mm at −20 / 0 / +40 mm.
  - On the track the frame still pitches 1.77° on the Telelever, so its trail drops 9 mm instead of the
    telescopics' 21 mm. **It does not grow.** Research 08 says "trail grows on braking" for the Telelever. This
    geometry does not reproduce that, and the copy says what the sim shows: "trail falls far less".
- **Wheelbase change at +40 mm front travel:** −17.8 mm (telescopic) vs +1.3 mm (Telelever).
- **Lean at the carousel apex (−0.80 g, bank 8°):** 34.29° vs 34.22° closed form, roll > 0 (right turn). Max lean
  per lap is 36.05°.
- **Seek, 212 lap times every 0.4 s:**
  - against the continuously driven state: max |Δtravel| < 0.05 mm, |Δroll| 0.02°, |Δpitch| < 0.005°;
  - 400 seeks per preset stay bounded;
  - history-free: the result is bitwise equal to a fresh sim.
- **Per-lap events:** about 18 lift-offs (washboard, humps) and 10–13 grip-limit (model), plus 12 sections and
  1 lap.
- **Golden (10 s):** classic `d015332e`, modern `8eb3198c`, telelever `e70af9fa`.

## Deviations / contradictions
1. **Lean sign contradiction (ROADMAP 05-03).** The contract (units.ts and telemetry `roll`: + lifts the LEFT side)
   makes a right turn (carousel, κ < 0) lean the bike right, which is **roll > 0**. ROADMAP 05-03 says "right turn →
   roll < 0". That holds for the car's body roll, not for the bike's lean. I implemented the contract: left turn →
   roll < 0, right turn → roll > 0, tested at the carousel. The 05-03 e2e text needs correcting.
2. **Amplification does not scale the lean** (sim.ts says it scales roll). Lean is a rigid rotation of the whole
   bike, not a suspension motion, and ×2.5 of a 35° lean is meaningless. Pitch, heave and travel are amplified.
3. **Telescopic `travel` is read as fork stroke** (along the axis). Wheel travel = stroke · cos ε. The other ends'
   `travel` is vertical wheel travel. Frame `travel` is always vertical wheel travel.
4. **The fork `spring` and `damper` are for both legs together** (the contract does not say). `springForce` and
   `damperForce` are per shock (fork: total).
5. **`motionRatio` = d(spring compression)/d(travel) > 0** (the contract says "d(spring length)/d(travel) > 0").
   `springLength` is the shock/fork length.
6. **Rear `instantCentre` is the anti-squat IC** (swingarm line ∩ chain top run). The front one is the
   wheel-carrier IC; for a telescopic fork that is at infinity, so it is drawn 5 m along the path normal, rearward.
7. **`axles[i].antiPitch` is the geometric value at the current travel** (front anti-dive, rear anti-squat), not
   zeroed when not braking (the car zeroes it). `rollCentre` is not written (stays 0); `rollCentreHeight` is NaN.
8. **Corner `camber` = the lean (same sign as roll); `camberBody` = 0.**
9. **Shortcuts:**
   - no longitudinal inertia of the unsprung masses;
   - the road-plane pitch acceleration is not fed back;
   - one mean crown radius sets the lean pivot (front 60 mm and rear 80 mm differ, about 2 mm at full lean);
   - `vehicle.mass` 290 kg sets the brake/drive forces, while ride mass = sprung 254 kg + the preset's unsprung mass
     (35–37 kg).
10. **Allocation:** `step()` and `sample()` create no objects. No heap-churn test was written for the bike (the
    plan did not require one).

## Verification (real output)
```
$ npx vitest run tests/sim-core/moto.test.ts tests/sim-core/moto-sim.test.ts
 moto.test.ts      23 passed
 moto-sim.test.ts  19 passed
$ npm run lint:deps
✔ no dependency violations found (204 modules, 630 dependencies cruised)
$ npm run typecheck
(errors only in files I do not own: tests/e2e/04-04-overlays.spec.ts, tests/sim-core/_scratch/*.test.ts (02-05 scratch))
```
**Full `npx vitest run` (tree shared with parallel executors):** 21 failures. None is in my files.
- **One is a direct consequence of this plan, in a file I do not own:**
  - `tests/sim-core/simulation.test.ts:206` expects `setVehicle('bike')` to throw
    `'motorcycle model arrives in phase 5'`.
  - The stub is now the real model. The test's fake bike (car suspension data cast to motorcycle) still throws, but
    with a TypeError.
  - The owner (02-04 / 02-05) should relax that line to `.toThrow()` or drop the stub assertion.
- **Car golden hashes** fail because `src/sim-core/content/susp-multilink.ts` has uncommitted edits by another
  executor.
- **Kernel, loop, track and overlay tests** time out under full-suite load. `tests/kernel` passes in isolation:
  101/106 with kernel + sim + arch, where the 5 failures are the three listed above plus a lap-test timeout.
- **`npm run check`** stops at typecheck on other plans' files (04-04 e2e spec, 02-05 `_scratch`). My files
  typecheck clean.

Credits: no code lifted. The formulas are from research 08 (Foale/Cossalter concepts, Jolt MIT lean formula idea),
reimplemented.
