# 09-01 SUMMARY — Tyre model and compliance derivation

## Built
- **`drive/tyre.ts` full body** (§7.4, signature kept): unit-slope Magic Formula f(s) = sin(C atan(Bs − E(Bs − atan Bs))),
  B = 1/C (det kernels), one normalised combined-slip curve on s = |(C_κ κ, C_α tan α)/D|, D = peakMu(N, camber to road)
  · muScale · N (the Auto gripUse peak); falling branch when sliding (→ sin(Cπ/2) = 0.85 D); camber thrust as equivalent
  slip tan α_eq = uy/σy − camberRatio · inclination; C_α(N), C_κ(N) by the g-shape; low-speed damping and the friction
  circle as before; slopeX secant = (C_κ/σx) · max(0.05, f(s)/s). New exports: `slipCurve`, `relax` (the plant's
  backward-Euler deflection update, for 09-04 to reuse), `SLIDE_BOUND`; `TyreCoefficients.peakSlip` (solved once).
- **Slide bound** (replaces the v0 clamp at saturation): `limitDeflection` scales the stored (ux, uy) back to
  s = 4 × peak slip (12.5 for C = 1.35, where f = 0.92), keeping the camber offset. A locked/spinning wheel at speed still
  sees the falling branch with little dt dependence; at standstill a spun wheel cannot wind up unbounded deflection.
- **`drive/compliance.ts`** (§7.5): `deriveCompliance(axle, table, rates, wheelRate, side = 1)` — 6×6 Plücker stiffness of
  the upright about the design contact patch: each `distance` link at its role's chassis-bush rate, a `strut` as two
  radial wrenches at the top mount (`bushingRates.strut`), travel locked by a Lagrange multiplier; unit loads → `fyToe`,
  `fyCamber`, `fxToeBrake`, `fxToeDrive`, `mzToe` (reported only), `lateralStiffness`. No suspension-type knowledge;
  missing role → error (no default). `no-type-tuning` arch test green.
- **Content** `gt-coupe-tyres.ts`: values unchanged (§7.15; C 1.35, E 0 inside their bands); header states the rates are
  assumed axial chassis-bush rates, quoted with the ×0.5..×2 band.
- **Tests**: `tests/sim-core/tyre.test.ts` (Y1, 9 tests), `tests/sim-core/compliance.test.ts` (C1, 4 tests).

## Measured (real output; front tyre, N0 = 4200 N)
- **C_α and μ vs load**: N 1000 → C_α 24.7 kN/rad (24.65 /rad), μ 1.260; 2000 → 47.3 (23.66), 1.210; 3000 → 66.5 (22.17),
  1.160; 4200 → 84.0 (20.00), 1.100; 6000 → 99.3 (16.55), 1.010; 8000 → 104.9 (13.11), 0.910. Peak μ equals `peakMu`
  to 1e-4 at every load; C_α rises to k·N0 = 8.4 kN then falls.
- **Lateral peak** at 9.75° slip (s_peak 3.130), |Fy| = 1.0000 D. Locked wheel Fx = 0.901 D; 84° sideways 0.858 D.
- **Camber thrust ratio** (linear range) 0.07000 = camberRatio; 1° camber = 103 N at 4200 N. Camber sweep −6..6° and
  toe sweep up to the peak strictly monotone. Camber thrust fades in with rolling (0 below 0.5 m/s, full above 1.5 m/s).
- **Friction circle**: max |F|/capacity over a combined κ × tanα × vx sweep (incl. camber and low-speed damping) =
  1.000000000000.
- **Relaxation**: steady state uy = σ·vy/|vx| to 1e-12; 63 % step lag 62.1 ms vs σ/v 60.0 ms (10 m/s), 32.1 ms vs 30.0
  ms (20 m/s) — backward Euler at 240 Hz adds +3.5 %/+7 % (at 40 m/s it would be ≈ +14 %: a property of the plant's
  integrator, not the tyre). Force follows within 1 %.
- **Continuity through v = 0**: largest force change per 1 mm/s of vx over −2..2 m/s = 0.465 N. Low-speed damping c·dt/m
  < 1 on the corner mass for 300–12 000 N; damping never leaves the circle.
- **Plant with the new tyre** (08-02 plant and v0 powertrain at commit a7df7d5 in a private worktree, without 09-02's
  WIP): skidpad R 60 m 0.981 / 0.982 / 0.982 g (macpherson / double-wishbone / multilink; v0: 1.05 g — the falling branch
  and camber now count); 0–100 km/h 5.67 s (TCS v0 thresholds were tuned for the v0 curve's κ ≈ 0.05 saturation);
  100–0 km/h 39.9 m (wheels lock, sliding μ; ABS is 09-02); standstill creep 0.0000 mm all types; S1 full-lock creep spin
  sign changes 1,1,1,1; fuzz 86 400 steps finite, 0 faults; plant step 16.4 µs. All 26 sim-core files green there.

## Compliance report (C1) — per wheel, left corner, RACE signs; band = every role used by the corner independently ×0.5/×1/×2
Rates (shared, N/m, assumed): lower-arm 5e6, upper-arm 8e6, lateral-link 10e6, trailing-link 1.5e6, tie-rod 20e6,
strut 2.5e6. Wheel rates (signature only, travel locked): front 37.27 kN/m, rear 44.14 kN/m.

| type / axle | fyToe °/kN (+ toe-in, Fy toward centre) | fyCamber °/kN (+ top out) | toe-in under braking °/kN (= −fxToeBrake) | fxToeDrive °/kN | mzToe °/kN·m | axle lateral mm/kN | loop gain abs(fyToe)·C_α,max |
|---|---|---|---|---|---|---|---|
| macpherson front | 0.0481 [0.0133, 0.1069] | 0.0113 [0.0057, 0.0226] | −0.0044 [−0.0093, −0.0016] | 0.0560 [0.0280, 0.1121] | −0.559 | 0.084 [0.042, 0.168] | 0.088 |
| macpherson rear | 0.0528 [0.0204, 0.1115] | 0.0167 [0.0083, 0.0334] | −0.0040 [−0.0081, −0.0020] | 0.0496 [0.0248, 0.0992] | −0.488 | 0.098 [0.049, 0.196] | 0.116 |
| double-wishbone front | 0.0518 [0.0157, 0.1138] | 0.0188 [0.0094, 0.0377] | −0.0049 [−0.0128, 0.0005] | 0.0244 [0.0093, 0.0518] | −0.526 | 0.105 [0.052, 0.210] | 0.095 |
| double-wishbone rear | 0.0532 [0.0216, 0.1114] | 0.0258 [0.0129, 0.0516] | −0.0116 [−0.0233, −0.0058] | 0.0228 [0.0092, 0.0479] | −0.430 | 0.121 [0.060, 0.242] | 0.117 |
| multilink front | 0.0273 [0.0053, 0.0630] | 0.0112 [0.0056, 0.0225] | −0.0210 [−0.1091, 0.0565] | 0.0237 [−0.0190, 0.0784] | −0.292 | 0.063 [0.032, 0.127] | 0.050 |
| multilink rear | 0.1467 [0.0724, 0.2943] | 0.0447 [0.0223, 0.0893] | 0.0193 [−0.1349, 0.1830] | 0.0307 [−0.0274, 0.1041] | −0.784 | 0.284 [0.142, 0.569] | 0.323 |

(rad/N = °/kN × 1.745e-5. Uniform scaling of all rates is exactly ×2 / ×0.5 — property test; the bracket is the wider
per-role band, where signs can flip: multilink braking toe and drive toe change sign inside it.)

**Gates** (§7.5): camber ≤ 0.4 °/kN holds everywhere (whole band). Outside, REPORTED, not tuned:
- axle lateral compliance 0.06–0.28 mm/kN for all six corners (target 0.6–2.6): only chassis-side bushes are compliant
  (no subframe mounts, outer bushes, arm bending). Softening the shared table to reach 0.6 mm/kN would multiply every toe
  coefficient 3–10× past its sourced 0.01–0.05 °/kN, so the table was not recalibrated to it.
- fyToe on the gate: macpherson rear 0.0528, double-wishbone front 0.0518, double-wishbone rear 0.0532 °/kN (> 0.05).
- multilink rear: fyToe 0.147 °/kN toe-in (understeer) and loop gain 0.32 (> 0.2; < 1 over the whole band, asserted).
  Driven by the lateral (spring) link rate: lateral-link ×0.5 → 0.243, ×2 → 0.099; tie-rod ×0.5 → 0.187, ×2 → 0.127;
  trailing/upper links barely matter. It is this geometry's toe link vs the lateral links, not a tuned number.
The test pins this exact list, so a geometry/rate change that moves a type across a gate fails and must be re-reported.

## Deviations
1. **Travel locked in the compliance derivation** (§7.5 step 2 says a spring of the wheel rate at the wheel centre): the
   wheel-rate spring lets the travel DOF respond to the jacking component of the unit loads, which the plant's ride model
   (09-04 linkVertical + table camber/toe at the ride travel) already does — it was most of the camber (e.g. double-
   wishbone front 0.121 → 0.019 °/kN) and broke the exact "halve rates → double coefficients" property. `wheelRate` stays
   in the signature, is checked > 0, and is otherwise unused (test asserts coefficients independent of it).
2. **Camber thrust fades in with rolling** (§7.4 pseudo-code applies it at all speeds): at rest a steered, cambered wheel
   pushed the parked car sideways (S1 full-lock creep: spin sign changes 4 > 1). Weight 1 − lowSpeed(vx).
3. **Slide bound at 4 × peak slip** rather than "at the curve's peak" (08-02 hint): clamping at the peak removes the
   falling branch (stored state never passes the peak) and makes the lock-up force dt-dependent.
4. **Interface additions** (names/shapes kept): `TyreCoefficients.peakSlip`; exports `slipCurve`, `relax`, `SLIDE_BOUND`;
   `deriveCompliance(..., side = 1)` optional trailing arg (mirror test); `fxToeBrake`/`fxToeDrive` are d(toe)/d(Fx) so
   §7.5's runtime formula `coeff · Fx` is correct as written (toe-in under braking is a NEGATIVE fxToeBrake).
5. No `tests/fixtures/09-01-*` needed.

## What 09-04 must know
- The plant needs no change to use the new tyre (same calls). Camber thrust is live as soon as the plant sets
  `inclination` (it already does: side · γ). Plant skidpad drops to ≈ 0.98 g; recheck T5 (0.90–1.10 g) — inside.
- `relax(u, rate, vx, sigma, dt)` is the plant's step-8a formula; reuse it. Camber thrust has no relaxation lag (instant
  with γ); if a lag is wanted, feed −camberRatio·γ·|vx| into the uy rate instead and drop the evaluation term (a
  coordinated change of both files).
- Compliance runtime: toe_c = fyToe·Fy_in + (Fx < 0 ? fxToeBrake : fxToeDrive)·Fx, Fy_in signed toward the centre; the
  same left-corner coefficients serve the right corner. Multilink rear is the one with real authority (0.15 °/kN → ≈ 0.3°
  at 2 kN; maxAngle 0.5° clamps) and loop gain 0.32 — keep the 30 ms filter. Compliance camber is ≤ 0.026 °/kN except
  multilink rear 0.045.
- Plant-test baselines that legitimately moved with the curve (all still pass): skidpad 1.05 → 0.98 g, 0–100 5.05 →
  5.67 s (TCS thresholds were scaled for the v0 κ ≈ 0.05 saturation; peak κ is now ≈ 0.16 — 09-02's TCS should target the
  new curve), 100–0 36.8 → 39.9 m without ABS.

## Verification
- `npx vitest run tests/sim-core/tyre.test.ts tests/sim-core/compliance.test.ts tests/arch`: 47 passed.
- `npm run check` (shared tree incl. 09-02/09-03 WIP): typecheck clean; depcruise `✔ no dependency violations found (241
  modules, 795 dependencies cruised)`; vitest `Test Files 2 failed | 70 passed | 1 skipped (73)`, `Tests 2 failed | 809
  passed | 11 skipped (822)` — the 2 failures were 5 s timeouts (`teaching-overlays` draw no-alloc, `simulation` full lap)
  at load average 12 from parallel executors; re-run alone: `Test Files 3 passed`, `Tests 26 passed` (incl. golden.test).
  Auto goldens unchanged (no Auto file touched).

## Lifted code
None. Ideas only: Project Chrono ChPac02Tire (BSD-3-Clause) for the MF curve shape and the deflection form; the
Plücker-wrench stiffness method from the maths (research m2/23 §5.2).
