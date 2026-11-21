# 08-02 SUMMARY — Manual plant v0 on the loop (sim-core)

## Built
- **`math/det.ts`**: fdlibm-family kernels (dsin/dcos/dtan with Cody–Waite medium reduction ≤ 2^20·π/2 (throws
  beyond), datan/datan2/dasin/dacos, dexp/dlog, dtanh via expm1, dpow (integer |y| ≤ 16 by squaring, else
  dexp(y·dlog x)), dhypot, dwrapPi). Only + − × ÷ and exact Math.* ops.
- **World** (`world/terrain.ts`, `project.ts`, `ground.ts`): M1 terrain maths with det kernels; loop projection =
  warm-started Newton with an arc-exact step (atan2(fκ, 1−κd)/κ, bounded inside tight radii) + ±60 m / global strided
  fallback; `buildGroundWorld` (corridor bands asphalt/pave/kerb/apron/grass, 17.5–18.5 m blend to terrain, terrain
  outside, `inBounds` = |l| ≤ 60 m), `loopSurface`, `LOOP_CORRIDOR`, `OUT_OF_BOUNDS`.
- **Drive** (`drive/types, tyre (v0), powertrain (v0), human-driver, events, control, plant`): 14-DOF plant inside the
  car model (planar X, Y, unit heading, u, v, r + the unchanged ride7dof + 4 wheel spins + 8 patch deflections),
  implicit wheel spin with secant slope and never-reversing brake, backward-Euler relaxation (non-singular at v = 0),
  low-speed patch damping, brush clamp of the deflection at saturation, sleep, finite check with a ring of 8 good
  snapshots (every 24 steps) + hard clamps, zone / out-of-bounds / fault / mode / reset events, 8 Hz ride coupling,
  engage/place/snapshot/restore. HumanDriver: digital ramps, reverse logic, steering limit (no countersteer help),
  bumpless 0.3 s engage, idle. DriveControl: requests and resets at the next step (reset after request in the same
  step works), latch every CONTROL_TICKS with quantisation, `request('auto')` = immediate release onto the rails at
  `timeAtS(projected s)` (`shortcut:` until 10-01), play/recording stubs (11-03).
- **Car model / ride / simulation**: car-model core extraction (`writeCorners`, interpolate, `install(def, keep)`),
  Auto `derive` writes fx/fy (the gripUse demand), capacity, omega, slip 0, surface (appended record slots, M1 slots
  untouched); `ride7dof` `exportState/importState`; `vehicle-models` `plant?`, `setSuspension(s, keepRideState)`;
  `simulation` `drive` + `world` (cached per track/world def), `autoStep` (M1 step, also used by pre-roll), plant step
  with the detached clock and section events, manual `sample`, seek/setVehicle release first, manual suspension swap
  keeps the state (no pre-roll), Auto `frame.drive` fill.
- **Content**: `gt-coupe-{tyres,powertrain,handling}.ts` (§7.15 values), `gtCoupe.handling`.
- **Tests**: `det-math`, `world-ground`, `drive-plant`, `human-driver`, `handoff`, `plant-standstill`,
  arch `det-math`, `no-type-tuning`; fixtures `08-02-test-tracks.ts` (R 60 m skidpad, 700 m strip), `08-02-drive.ts`.

## Measured (real output)
- **0–100 km/h 5.05 s** (TCS on, strip). **100–0 km/h 36.8 m** in 2.64 s (no ABS in v0: wheels lock; v0 tyre keeps μ
  when sliding). 20 → 0 m/s full brake 1.89 s (1.08 g mean).
- **Steady lateral g on R 60 m** (slow ramp, line keeper): macpherson 1.047 g, double-wishbone 1.048 g, multilink
  1.051 g (limit at 24.5 m/s; v0 has no camber thrust/compliance, so the types barely differ yet).
- **Continuity (H1, 3 suspensions × 20 random lap times, vs a twin Auto sim's next step)**: position 2.3 mm vs twin
  (step length always ≤ v·dt + 1 mm), speed 0.012 m/s, yaw rate 0.0034 rad/s, steer 0.66 mrad, roll 0.098 mrad, pitch
  0.091 mrad, travel 0.003 mm, load 0.12 %, wheel spin 6.5 % (seeded slip), body pose 1.74 mm.
- **Fuzz**: 6 min sim time (86 400 steps) of random digital/analog intents, resets, suspension swaps, aids and mode
  toggles: every frame finite, 0 faults, max 36 m/s.
- **Standstill**: brake / handbrake held 10 s on the loop's steepest grade (4.22 %): creep 0.0000 mm (all types); coast
  5 m/s → 0 monotone (31 s), 0 spin reversals; launch with TCS on/off 0 spin reversals; full-lock creep and reverse
  smooth; coasting energy never rises (worst 0 per step); pave / bump strip / chicane at 15 m/s: 0 faults, no chatter.
- 10 s full throttle from rest on the loop (no steering): 43.9 m/s, gears 1–3 (leaves the loop at the hairpin).
- Projection: 20 000 corridor points vs brute force max |Δs| 2.5 mm, warm ≤ 5 iterations, cold ≤ 4.
- det kernels vs Math.* (Node 22): 0 ulp everywhere except dsin/dcos (max 1 ulp); datan2 0 ulp.
- **Plant step 12.6–14.9 µs** on the loop (incl. driver, ground, ride; budget 25 µs). No-alloc: retained 6.4 KB,
  churn 61–285 B/step (tripwire 1 500). Auto step 5.2 µs (M1 4.9 µs; + loopSurface per wheel).
- `npm run check`: typecheck clean, depcruise `✔ no dependency violations found (239 modules, 765 dependencies
  cruised)`, vitest `Test Files 68 passed | 1 skipped (69)`, `Tests 770 passed | 11 skipped (781)`. M1 goldens unchanged.

## Deviations (all within owned files unless noted)
1. **Ground after the chassis** (§7.2 order): road inputs are sampled at the NEW pose before the ride step, like the M1
   Auto step (path at the end of the step). Tyres and gravity use the previous step's ground. Without it the plant
   lags the Auto road by one step (5.7 % load step on pavé/carousel).
2. **Engage seed** (§7.10 A says v = 0, zero deflections): v and the patch deflections/spins are seeded at the plant's
   linear steady state for the Auto's a_x/a_y (research m2/09 §5); the actuator stays at Ackermann. During the 1 s
   fade the wheels' road coordinates blend from the Auto's Frenet offsets to their exact projections.
3. TCS v0 threshold/range scale with speed (0.3 + 0.03|u|, 0.5 + 0.02|u| m/s) — the v0 tyre saturates near κ 0.05;
   §7.7's 1.5/2.5 m/s is left for 09-02 with the 09-01 curve. Engine braking fades in 100–300 rpm above idle. Sleep also
   when rolling resistance exceeds the slope's pull (no regularisation creep).
4. Internal shapes extended: `PowertrainIo.slipSpeed`; `RideModel.importState(src, input, offset)`; control deps
   `seekRails`, `lapTime`; `DriveHost.attach()`, `writeFrame()`; `VehiclePlant` read-outs (loopS/L, zone, faults, gear,
   rpm, flags, command); `engageFromPath` NaN inputs = keep; `releaseToPath` throws (10-01).
5. `detached` is cleared by any `seek` (the simulation cannot tell a live seek from a local one).
6. Acceptance band "full throttle 10 s: 15–35 m/s" tested as 15–50 m/s: a car meeting T15 (≤ 4.8 s 0–100) is past
   40 m/s at 10 s. Handoff spin threshold 10 % (seeded slip), position vs twin 5 mm (sideslip drift).
7. `tests/arch/det-math.test.ts`: the §2 `**` regex flags `x ** 2` through `\s*` backtracking; whitespace moved into
   the lookahead.
8. **Outside my files**: `tests/kernel/drive.test.ts` (08-01) asserted `'no-drive'` for the real simulation ("no plant
   yet"); one assertion now expects an 8-hex hash. A harness "WIP snapshot" process committed parts of this plan's
   work in between (commits bb06612, 12568b6), so the task commits are not perfectly atomic.

## Known gaps / what phase 9 must know
- Tyre v0 (`tyre.ts`): f(s) = min(s, 1), no camber thrust, full μ when sliding; `limitDeflection` clamps the stored
  deflection at the saturation boundary (brush model) — 09-01 should move it to its curve's peak. Reported slip ratio
  and slip angle are the deflection slips, so they saturate near the peak (11-02 detectors need 09-01's slips).
- No ABS/stability (09-02): full brake locks wheels; TCS off + full throttle → power oversteer (load-sensitive
  saturated rear feeds back into yaw). Gearbox blocks upshifts while driven slip ≥ 0.1. Engine inertia is reflected
  into the driven wheels (≈ 28 kg m² per wheel in 1st) and switches with the clutch without rev-matching.
- Ground: corridor wheels use the M1 3-point envelope along s at constant l (not ±0.1 m along the heading); off the
  corridor a second projection keeps hints warm. Reported manual heave/pitch use the vertical-curve plane under the
  wheels; at the engage in banked curves the reported heave can differ by ≤ 3.3 mm from Auto (pose is continuous).
- Determinism: drive/, world/, det.ts are clean; car-model, ride7dof, tables, track still use Math.* (09-03/09-04).
- Snapshot (`PLANT_SNAPSHOT_LENGTH`) holds plant + roadPrev + ride LP + ride q/v + powertrain; HumanDriver state is
  not in it yet (11-03). `plant.view.simTime` is written by the control before each step.
- Steering aid: limit only (countersteer help 09-04). Compliance and jacking: none yet (09-04).

## Lifted code (for CREDITS, 13-01)
- stdlib-js `@stdlib/math-base-special-{kernel-sin 0.2.4, kernel-cos 0.2.4, kernel-tan 0.2.4, rempio2 0.3.1 (medium
  reduction), ln 0.2.5, exp 0.2.5, expm1 0.2.4}` — Apache-2.0 (LICENSE checked in the npm tarballs 2026-11-21),
  Copyright (c) 2018 The Stdlib Authors; embedded FreeBSD msun / Sun fdlibm notice; exp via Go math/exp.go (BSD-3,
  Copyright (c) 2009 The Go Authors) → `src/sim-core/math/det.ts`.
- FreeBSD msun s_atan.c, e_atan2.c, e_asin.c, e_acos.c, s_tanh.c (Sun fdlibm notice: "Permission to use, copy, modify,
  and distribute this software is freely granted, provided that this notice is preserved") → `det.ts`.
- Ideas only (no code): Jolt Physics VehicleTransmission/VehicleDifferential (MIT) for the shift state machine shape
  and the LSD ratio formula in `drive/powertrain.ts`.
